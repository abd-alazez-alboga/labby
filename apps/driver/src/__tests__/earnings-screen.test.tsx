/**
 * M8-T4 — UC-D-15 against money-v1.yaml mocks: the Earnings screen
 * (artboard "Driver Earnings") — weekly summary totals, the Week/Month
 * toggle, the period stepper (anchor stepping, future disabled), the
 * commission-tier card with next-tier progress math (COM-02), the per-trip
 * list (cash vs wallet nets; V1 conformance W43, board
 * V1FDriverEarningsTrips: day headings, the rider's name, cancelled-after-
 * accept trips, rows open the trip detail), paging, the empty state, and
 * Arabic with Western digits.
 */
import { fireEvent } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { todayIso } from "../onboarding/dates";
import { stepAnchor, weekStartIso } from "../money/periods";
import {
  BALANCE,
  balanceEntryFixture,
  cancelledNoFeeFixture,
  balanceViewFixture,
  blockedBalanceView,
  commissionFixture,
  EARNINGS,
  earningPage,
  feeOnlyEarningFixture,
  okBalanceView,
  summaryFixture,
  summaryRoute,
  tripDetailRoute,
  tripEarningFixture,
  walletEarningFixture,
} from "../test-utils/money";
import { renderMoneyScreens } from "../test-utils/money-harness";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import { screen } from "../test-utils/ride-harness";
import type { MockResponse } from "../test-utils/contract";
import * as regionModule from "../region/RegionProvider";
import type { RegionContextValue } from "../region/RegionProvider";

const ok = (body: unknown): MockResponse => ({ status: 200, body });
const WEEK_NOW = () => summaryRoute("weekly", todayIso());

function baseRoutes(): Record<string, MockResponse | MockResponse[]> {
  return {
    [WEEK_NOW()]: ok(summaryFixture()),
    [EARNINGS]: ok(
      earningPage([tripEarningFixture(), walletEarningFixture()]),
    ),
    [BALANCE]: ok(balanceViewFixture()),
  };
}

/** Two currencies: the operating SYP entry and a USD one. */
function twoCurrencyView(syp: "ok" | "blocked", usd: "ok" | "blocked") {
  return balanceViewFixture({
    balances: [
      balanceEntryFixture({
        currency: "USD",
        balance: usd === "blocked" ? -60 : -10,
        floor: -50,
        status: usd,
      }),
      balanceEntryFixture({
        balance: syp === "blocked" ? -520000 : -50000,
        status: syp,
      }),
    ],
  });
}

/** Resolves the operating region to SYP for the money facade. */
function resolveRegionSyp() {
  return jest.spyOn(regionModule, "useOptionalRegion").mockReturnValue({
    status: "resolved",
    config: { currency: "SYP" } as RegionContextValue["config"],
    retry: () => {},
    openLocationSettings: () => {},
  });
}

describe("earnings screen (UC-D-15)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("renders the weekly summary: range label, net, trips/fares/tips/commission", async () => {
    await renderMoneyScreens(baseRoutes(), { initialUrl: "/earnings" });

    expect(await screen.findByTestId("earnings-total-card")).toBeTruthy();
    // Label from the SERVER's resolved range (from/to), not the local guess.
    expect(screen.getByTestId("earnings-range")).toHaveTextContent(
      "Tue 6 – Mon 12 Oct",
      { exact: false },
    );
    expect(screen.getByTestId("earnings-net")).toHaveTextContent("SYP 846,000", { exact: false });
    expect(screen.getByTestId("earnings-meta")).toHaveTextContent(
      "38 trips · fares 1,064,000 · tips 48,000 · commission −266,000",
      { exact: false },
    );
  });

  it("shows the commission tier with next-tier progress (COM-02)", async () => {
    await renderMoneyScreens(baseRoutes(), { initialUrl: "/earnings" });

    expect(await screen.findByTestId("earnings-tier-heading")).toHaveTextContent(
      "Commission this week: 25%",
      { exact: false },
    );
    expect(screen.getByTestId("earnings-tier-body")).toHaveTextContent(
      "38 trips so far this week. Finish 101 trips and next week's commission drops to 20%.",
      { exact: false },
    );
    // 38 of the 101 needed (backend tier: strictly MORE than 100).
    expect(
      screen.getByTestId("earnings-tier-bar").props.accessibilityValue.now,
    ).toBe(38);
  });

  it("is not full at exactly weeklyTripsAbove trips — one more is needed (W14)", async () => {
    await renderMoneyScreens(
      {
        ...baseRoutes(),
        [BALANCE]: ok(
          balanceViewFixture({
            commission: commissionFixture({ currentWeekTrips: 100 }),
          }),
        ),
      },
      { initialUrl: "/earnings" },
    );
    const bar = await screen.findByTestId("earnings-tier-bar");
    expect(bar.props.accessibilityValue.now).toBeLessThan(100);
    expect(screen.getByTestId("earnings-tier-body")).toHaveTextContent(
      "100 trips so far this week. Finish 101 trips",
      { exact: false },
    );
  });

  it("says '1 trip', not '1 trips'", async () => {
    await renderMoneyScreens(
      {
        ...baseRoutes(),
        [WEEK_NOW()]: ok(summaryFixture({ trips: 1 })),
        [BALANCE]: ok(
          balanceViewFixture({
            commission: commissionFixture({ currentWeekTrips: 1 }),
          }),
        ),
      },
      { initialUrl: "/earnings" },
    );
    expect(await screen.findByTestId("earnings-meta")).toHaveTextContent(
      /^1 trip · fares/u,
    );
    expect(await screen.findByTestId("earnings-tier-body")).toHaveTextContent(
      "1 trip so far this week.",
      { exact: false },
    );
  });

  it("says so when the driver is already on the best rate", async () => {
    await renderMoneyScreens(
      {
        ...baseRoutes(),
        [BALANCE]: ok(
          balanceViewFixture({
            commission: commissionFixture({ percent: 15, nextTier: null }),
          }),
        ),
      },
      { initialUrl: "/earnings" },
    );
    expect(await screen.findByTestId("earnings-tier-body")).toHaveTextContent(
      "38 trips so far this week. You're on your best commission rate.",
      { exact: false },
    );
  });

  it("switches to the monthly summary (no tier card) and back", async () => {
    const monthly = summaryFixture({
      period: "monthly",
      from: "2026-10-01",
      to: "2026-10-31",
      trips: 160,
      net: 3400000,
    });
    const contract = await renderMoneyScreens(
      {
        ...baseRoutes(),
        [summaryRoute("monthly", todayIso())]: ok(monthly),
      },
      { initialUrl: "/earnings" },
    );
    expect(await screen.findByTestId("earnings-tier-card")).toBeTruthy();

    fireEvent.press(screen.getByTestId("earnings-period-monthly"));

    expect(await screen.findByTestId("earnings-range")).toHaveTextContent(
      "October 2026",
      { exact: false },
    );
    expect(screen.getByTestId("earnings-net")).toHaveTextContent(
      "SYP 3,400,000",
      { exact: false },
    );
    // The tier card is weekly — the artboard shows it on the Week view only.
    expect(screen.queryByTestId("earnings-tier-card")).toBeNull();
    expect(contract.requestsTo(summaryRoute("monthly", todayIso()))).toHaveLength(
      1,
    );
  });

  it("steps to the previous week and disables stepping into the future", async () => {
    const previousAnchor = stepAnchor("weekly", todayIso(), -1);
    const currentAnchor = weekStartIso(todayIso());
    const contract = await renderMoneyScreens(
      {
        ...baseRoutes(),
        [summaryRoute("weekly", previousAnchor)]: ok(
          summaryFixture({ from: "2026-09-29", to: "2026-10-05", net: 500000 }),
        ),
        [summaryRoute("weekly", currentAnchor)]: ok(summaryFixture()),
      },
      { initialUrl: "/earnings" },
    );
    await screen.findByTestId("earnings-total-card");

    // This period contains today → no stepping forward.
    expect(screen.getByTestId("earnings-next")).toBeDisabled();

    fireEvent.press(screen.getByTestId("earnings-prev"));
    expect(await screen.findByTestId("earnings-range")).toHaveTextContent(
      "Tue 29 Sept – Mon 5 Oct",
      { exact: false },
    );
    expect(screen.getByTestId("earnings-net")).toHaveTextContent("SYP 500,000", { exact: false });
    expect(screen.getByTestId("earnings-next")).not.toBeDisabled();

    // Forward returns to the current week (and the guard re-arms).
    fireEvent.press(screen.getByTestId("earnings-next"));
    expect(await screen.findByTestId("earnings-range")).toHaveTextContent(
      "Tue 6 – Mon 12 Oct",
      { exact: false },
    );
    expect(screen.getByTestId("earnings-next")).toBeDisabled();
    expect(
      contract.requestsTo(summaryRoute("weekly", previousAnchor)),
    ).toHaveLength(1);
  });

  it("lists per-trip earnings: the rider, place, items and signed net (board V1FDriverEarningsTrips)", async () => {
    await renderMoneyScreens(baseRoutes(), { initialUrl: "/earnings" });

    expect(await screen.findByTestId("earnings-trips-heading")).toHaveTextContent(
      "Trips · tap a trip for details",
    );
    const cashRow = await screen.findByTestId(
      `trip-row-${tripEarningFixture().rideId}`,
    );
    expect(cashRow).toHaveTextContent("· Umayyad Square", { exact: false });
    expect(cashRow).toHaveTextContent(
      "Rana · cash · fare 28,000 · tip +5,000",
      { exact: false },
    );
    // The board moves the commission to the trip detail.
    expect(cashRow).not.toHaveTextContent("commission", { exact: false });
    expect(cashRow).toHaveTextContent("−SYP 2,000", { exact: false });

    const walletRow = screen.getByTestId(
      `trip-row-${walletEarningFixture().rideId}`,
    );
    expect(walletRow).toHaveTextContent("Omar · wallet · fare 31,500", {
      exact: false,
    });
    expect(walletRow).toHaveTextContent("+SYP 23,625", { exact: false });
  });

  it("groups the trips under one heading per day", async () => {
    await renderMoneyScreens(
      {
        ...baseRoutes(),
        [EARNINGS]: ok(
          earningPage([
            tripEarningFixture(),
            walletEarningFixture(),
            cancelledNoFeeFixture(),
          ]),
        ),
      },
      { initialUrl: "/earnings" },
    );
    expect(await screen.findByTestId("earnings-day-2026-10-11")).toHaveTextContent(
      "Sun 11 Oct",
    );
    expect(screen.getByTestId("earnings-day-2026-10-10")).toHaveTextContent(
      "Sat 10 Oct",
    );
    expect(screen.getAllByText(/^(Sun 11|Sat 10) Oct$/u)).toHaveLength(2);
  });

  it("lists a trip cancelled after acceptance: no fee → a muted dash (W43)", async () => {
    const cancelled = cancelledNoFeeFixture();
    await renderMoneyScreens(
      { ...baseRoutes(), [EARNINGS]: ok(earningPage([cancelled])) },
      { initialUrl: "/earnings" },
    );
    const row = await screen.findByTestId(`trip-row-${cancelled.rideId}`);
    // A cancelled trip is told by its pickup.
    expect(row).toHaveTextContent("· Kafr Sousa", { exact: false });
    expect(row).toHaveTextContent(
      "Hadi · rider cancelled after you accepted · no fee",
      { exact: false },
    );
    expect(screen.getByTestId(`trip-net-${cancelled.rideId}`)).toHaveTextContent(
      "—",
    );
  });

  it("says how a driver cancellation or a no-show ended", async () => {
    const mine = cancelledNoFeeFixture({ rideState: "cancelled_by_driver" });
    const noShow = cancelledNoFeeFixture({
      rideId: "5b1d3f0e-1111-4c4c-9a9a-000000000006",
      rideState: "cancelled_by_driver",
      cancellationReason: "rider_no_show",
    });
    await renderMoneyScreens(
      { ...baseRoutes(), [EARNINGS]: ok(earningPage([mine, noShow])) },
      { initialUrl: "/earnings" },
    );
    const row = await screen.findByTestId(`trip-row-${mine.rideId}`);
    expect(row).toHaveTextContent("Hadi · you cancelled after accepting", {
      exact: false,
    });
    expect(row).not.toHaveTextContent("no fee", { exact: false });
    expect(screen.getByTestId(`trip-row-${noShow.rideId}`)).toHaveTextContent(
      "Hadi · rider no-show",
      { exact: false },
    );
  });

  it("a trip row opens its trip detail (W43)", async () => {
    const earning = tripEarningFixture();
    const contract = await renderMoneyScreens(
      {
        ...baseRoutes(),
        [tripDetailRoute(earning.rideId)]: ok(earning),
      },
      { initialUrl: "/earnings" },
    );

    fireEvent.press(await screen.findByTestId(`trip-row-${earning.rideId}`));

    expect(await screen.findByTestId("trip-detail-screen")).toBeTruthy();
    expect(await screen.findByTestId("trip-line-commission")).toHaveTextContent(
      "−SYP 7,000",
      { exact: false },
    );
    expect(contract.requestsTo(tripDetailRoute(earning.rideId))).toHaveLength(1);
  });

  it("a shared member's row opens that member's trip detail", async () => {
    const memberId = "8a000000-0000-4000-8000-000000000001";
    const earning = tripEarningFixture({ kind: "shared", memberId });
    const contract = await renderMoneyScreens(
      {
        ...baseRoutes(),
        [EARNINGS]: ok(earningPage([earning])),
        [tripDetailRoute(earning.rideId, memberId)]: ok(earning),
      },
      { initialUrl: "/earnings" },
    );
    fireEvent.press(await screen.findByTestId(`trip-row-${earning.rideId}`));
    expect(await screen.findByTestId("trip-detail-screen")).toBeTruthy();
    expect(
      contract.requestsTo(tripDetailRoute(earning.rideId, memberId)),
    ).toHaveLength(1);
  });

  it("pages the trip list with Show more", async () => {
    const more = tripEarningFixture({
      rideId: "5b1d3f0e-1111-4c4c-9a9a-000000000009",
    });
    const contract = await renderMoneyScreens(
      {
        ...baseRoutes(),
        [EARNINGS]: ok(
          earningPage([tripEarningFixture()], { totalItems: 2, totalPages: 2 }),
        ),
        "GET /api/v1/driver/earnings?page=1&size=20": ok(
          earningPage([more], { page: 1, totalItems: 2, totalPages: 2 }),
        ),
      },
      { initialUrl: "/earnings" },
    );

    fireEvent.press(await screen.findByTestId("earnings-load-more"));
    expect(await screen.findByTestId(`trip-row-${more.rideId}`)).toBeTruthy();
    expect(screen.queryByTestId("earnings-load-more")).toBeNull();
    expect(
      contract.requestsTo("GET /api/v1/driver/earnings?page=1&size=20"),
    ).toHaveLength(1);
  });

  it("shows an empty state, not a server error, when the driver has no operating region (404, W15)", async () => {
    await renderMoneyScreens(
      {
        ...baseRoutes(),
        [WEEK_NOW()]: { status: 404, body: { status: 404 } },
        [EARNINGS]: ok(earningPage([])),
      },
      { initialUrl: "/earnings" },
    );
    expect(
      await screen.findByTestId("earnings-summary-empty"),
    ).toHaveTextContent("No earnings to show yet", { exact: false });
    expect(screen.queryByTestId("earnings-summary-error")).toBeNull();
    expect(screen.queryByTestId("earnings-total-card")).toBeNull();
  });

  it("renders a cancelled ride's credited fee as how it ended, no fare items (W17, board V1FDriverEarningsTrips)", async () => {
    const fee = feeOnlyEarningFixture();
    await renderMoneyScreens(
      { ...baseRoutes(), [EARNINGS]: ok(earningPage([fee])) },
      { initialUrl: "/earnings" },
    );
    const row = await screen.findByTestId(`trip-row-${fee.rideId}`);
    expect(row).toHaveTextContent("Nour · rider cancelled after you accepted", {
      exact: false,
    });
    expect(row).not.toHaveTextContent("no fee", { exact: false });
    expect(row).not.toHaveTextContent("fare", { exact: false });
    expect(row).not.toHaveTextContent("commission", { exact: false });
    expect(screen.getByTestId(`trip-net-${fee.rideId}`)).toHaveTextContent(
      "+SYP 10,000",
    );
  });

  it("keeps 'Cancellation fee · all yours' for a fee row on a completed ride (W17)", async () => {
    // A shared member's collected fee: the ride itself completed.
    const fee = feeOnlyEarningFixture({ rideState: "completed" });
    await renderMoneyScreens(
      { ...baseRoutes(), [EARNINGS]: ok(earningPage([fee])) },
      { initialUrl: "/earnings" },
    );
    const row = await screen.findByTestId(`trip-row-${fee.rideId}`);
    expect(row).toHaveTextContent("Nour · Cancellation fee · all yours", {
      exact: false,
    });
    expect(row).not.toHaveTextContent("commission", { exact: false });
  });

  it("shows a promo ride's platform top-up on the row and inside its net (M13 ruling 1)", async () => {
    // Fare 28,000 cash, 25% → −7,000, tip +5,000, promo top-up +2,800 → net +800.
    const promo = tripEarningFixture({ promoCompensation: 2800, net: 800 });
    await renderMoneyScreens(
      { ...baseRoutes(), [EARNINGS]: ok(earningPage([promo])) },
      { initialUrl: "/earnings" },
    );
    const row = await screen.findByTestId(`trip-row-${promo.rideId}`);
    expect(row).toHaveTextContent("promo top-up +2,800", { exact: false });
    expect(screen.getByTestId(`trip-net-${promo.rideId}`)).toHaveTextContent(
      "+SYP 800",
    );
  });

  it("shows the empty state when there are no earnings", async () => {
    await renderMoneyScreens(
      {
        ...baseRoutes(),
        [WEEK_NOW()]: ok(
          summaryFixture({ trips: 0, fares: 0, tips: 0, commission: 0, net: 0 }),
        ),
        [EARNINGS]: ok(earningPage([])),
      },
      { initialUrl: "/earnings" },
    );
    expect(await screen.findByTestId("earnings-empty")).toHaveTextContent(
      "No earnings yet",
      { exact: false },
    );
    expect(screen.getByTestId("earnings-net")).toHaveTextContent("SYP 0", { exact: false });
  });

  it("links to the balance screen, flagging a blocked floor", async () => {
    await renderMoneyScreens(
      { ...baseRoutes(), [BALANCE]: ok(blockedBalanceView()) },
      { initialUrl: "/earnings" },
    );
    const chip = await screen.findByTestId("earnings-balance-chip");
    expect(chip).toHaveTextContent("−SYP 520,000", { exact: false });
    fireEvent.press(screen.getByTestId("earnings-balance-link"));
    expect(await screen.findByTestId("balance-screen")).toBeTruthy();
  });

  it("flags no floor for a non-operating currency while the region is unresolved (R-W4)", async () => {
    await renderMoneyScreens(
      { ...baseRoutes(), [BALANCE]: ok(twoCurrencyView("ok", "blocked")) },
      { initialUrl: "/earnings" },
    );
    expect(
      await screen.findByTestId("earnings-balance-amount"),
    ).toHaveTextContent("USD 60", { exact: false });
    expect(screen.queryByTestId("earnings-balance-chip")).toBeNull();
  });

  it("flags the operating currency's blocked floor (R-W4)", async () => {
    const spy = resolveRegionSyp();
    try {
      await renderMoneyScreens(
        { ...baseRoutes(), [BALANCE]: ok(twoCurrencyView("blocked", "ok")) },
        { initialUrl: "/earnings" },
      );
      expect(
        await screen.findByTestId("earnings-balance-chip"),
      ).toHaveTextContent("−SYP 520,000", { exact: false });
    } finally {
      spy.mockRestore();
    }
  });

  it("renders in Arabic with Western digits and ل.س", async () => {
    await setAppLanguage("ar");
    await renderMoneyScreens(
      { ...baseRoutes(), [BALANCE]: ok(okBalanceView()) },
      { initialUrl: "/earnings", language: "ar" },
    );

    expect(await screen.findByTestId("earnings-title")).toHaveTextContent(
      "الأرباح",
      { exact: false },
    );
    const net = screen.getByTestId("earnings-net");
    expect(net).toHaveTextContent("ل.س", { exact: false });
    expect(net).toHaveTextContent("846,000", { exact: false });
    expect(net).not.toHaveTextContent(/[٠-٩]/u);
    // Amounts travel inside LTR isolates in the Arabic meta line.
    expect(screen.getByTestId("earnings-meta")).toHaveTextContent(
      "⁦38⁩ رحلة",
      { exact: false },
    );
    expect(screen.getByTestId("earnings-meta")).toHaveTextContent("1,064,000", {
      exact: false,
    });
    expect(screen.getByTestId("earnings-tier-body")).toHaveTextContent(
      "أكمل ⁦101⁩ رحلة",
      { exact: false },
    );
  });

  it("keeps Western digits on the whole screen even where plain 'ar' would not (W18)", async () => {
    const restore = simulateArabicIndicIcu();
    try {
      await setAppLanguage("ar");
      await renderMoneyScreens(
        { ...baseRoutes(), [BALANCE]: ok(okBalanceView()) },
        { initialUrl: "/earnings", language: "ar" },
      );
      expect(await screen.findByTestId("earnings-trips")).toBeTruthy();
      expect(await screen.findByTestId("earnings-total-card")).toBeTruthy();
      expect(screen.getByTestId("earnings-screen")).not.toHaveTextContent(
        NON_WESTERN_DIGITS,
      );
    } finally {
      restore();
    }
  });
});

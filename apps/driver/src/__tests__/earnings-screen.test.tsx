/**
 * M8-T4 — UC-D-15 against money-v1.yaml mocks: the Earnings screen
 * (artboard "Driver Earnings") — weekly summary totals, the Week/Month
 * toggle, the period stepper (anchor stepping, future disabled), the
 * commission-tier card with next-tier progress math (COM-02), the per-trip
 * list (cash vs wallet nets), paging, the empty state, and Arabic with
 * Western digits.
 */
import { fireEvent } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { todayIso } from "../onboarding/dates";
import { stepAnchor, weekStartIso } from "../money/periods";
import {
  BALANCE,
  balanceViewFixture,
  blockedBalanceView,
  commissionFixture,
  EARNINGS,
  earningPage,
  feeOnlyEarningFixture,
  okBalanceView,
  summaryFixture,
  summaryRoute,
  tripEarningFixture,
  walletEarningFixture,
} from "../test-utils/money";
import { renderMoneyScreens } from "../test-utils/money-harness";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import { screen } from "../test-utils/ride-harness";
import type { MockResponse } from "../test-utils/contract";

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

  it("lists per-trip earnings: itemized cash debit and wallet credit", async () => {
    await renderMoneyScreens(baseRoutes(), { initialUrl: "/earnings" });

    const cashRow = await screen.findByTestId(
      `trip-row-${tripEarningFixture().rideId}`,
    );
    expect(cashRow).toHaveTextContent(
      "cash · fare 28,000 · commission −7,000 · tip +5,000",
      { exact: false },
    );
    expect(cashRow).toHaveTextContent("−SYP 2,000", { exact: false });

    const walletRow = screen.getByTestId(
      `trip-row-${walletEarningFixture().rideId}`,
    );
    expect(walletRow).toHaveTextContent(
      "wallet · fare 31,500 · commission −7,875",
      { exact: false },
    );
    expect(walletRow).toHaveTextContent("+SYP 23,625", { exact: false });
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

  it("renders a fee-only row as one 'Cancellation fee · all yours' item (W17)", async () => {
    const fee = feeOnlyEarningFixture();
    await renderMoneyScreens(
      { ...baseRoutes(), [EARNINGS]: ok(earningPage([fee])) },
      { initialUrl: "/earnings" },
    );
    const row = await screen.findByTestId(`trip-row-${fee.rideId}`);
    expect(row).toHaveTextContent("Cancellation fee · all yours", {
      exact: false,
    });
    expect(row).not.toHaveTextContent("fare", { exact: false });
    expect(row).not.toHaveTextContent("commission", { exact: false });
    expect(screen.getByTestId(`trip-net-${fee.rideId}`)).toHaveTextContent(
      "+SYP 10,000",
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

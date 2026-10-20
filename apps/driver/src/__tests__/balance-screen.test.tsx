/**
 * M8-T4 — UC-D-16 against money-v1.yaml mocks: the Balance screen (artboard
 * "Driver Balance") — the debt card with its explanation, the three floor
 * states (ok / warning with progress / blocked with settle instructions),
 * the typed recent activity derived from the per-trip itemization, the
 * "How to settle" instructions, and Arabic with Western digits and ل.س.
 */
import { fireEvent } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import {
  BALANCE,
  balanceEntryFixture,
  balanceViewFixture,
  blockedBalanceView,
  EARNINGS,
  earningPage,
  feeOnlyEarningFixture,
  mixedWalletEarningFixture,
  okBalanceView,
  tripEarningFixture,
  walletEarningFixture,
} from "../test-utils/money";
import { renderMoneyScreens } from "../test-utils/money-harness";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import { screen } from "../test-utils/ride-harness";
import { colors } from "../theme/tokens";
import * as regionModule from "../region/RegionProvider";
import type { RegionContextValue } from "../region/RegionProvider";
import type { MockResponse } from "../test-utils/contract";

const ok = (body: unknown): MockResponse => ({ status: 200, body });

function baseRoutes(): Record<string, MockResponse | MockResponse[]> {
  return {
    [BALANCE]: ok(okBalanceView()),
    [EARNINGS]: ok(
      earningPage([
        tripEarningFixture(),
        walletEarningFixture(),
        feeOnlyEarningFixture(),
      ]),
    ),
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

describe("balance screen (UC-D-16)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("shows the debt card with the explanation; no banner while status is ok", async () => {
    await renderMoneyScreens(baseRoutes(), { initialUrl: "/balance" });

    expect(await screen.findByTestId("balance-card")).toHaveTextContent(
      "You owe Labby",
      { exact: false },
    );
    expect(screen.getByTestId("balance-amount")).toHaveTextContent(
      "SYP 50,000",
      { exact: false },
    );
    expect(screen.getByTestId("balance-card")).toHaveTextContent(
      "Commission from cash rides adds up as debt and is settled at the office.",
      { exact: false },
    );
    expect(screen.queryByTestId("floor-warning")).toBeNull();
    expect(screen.queryByTestId("floor-blocked")).toBeNull();
  });

  it("shows a positive balance as credit", async () => {
    await renderMoneyScreens(
      {
        ...baseRoutes(),
        [BALANCE]: ok(
          balanceViewFixture({
            balances: [balanceEntryFixture({ balance: 120000, status: "ok" })],
          }),
        ),
      },
      { initialUrl: "/balance" },
    );
    expect(await screen.findByTestId("balance-card")).toHaveTextContent(
      "Your balance",
      { exact: false },
    );
    expect(screen.getByTestId("balance-amount")).toHaveTextContent(
      "SYP 120,000",
      { exact: false },
    );
  });

  it("warning: the amber near-floor banner with the limit and the gap (artboard math)", async () => {
    await renderMoneyScreens(
      { ...baseRoutes(), [BALANCE]: ok(balanceViewFixture()) },
      { initialUrl: "/balance" },
    );

    const warning = await screen.findByTestId("floor-warning");
    expect(warning).toHaveTextContent("You're close to the limit", { exact: false });
    expect(screen.getByTestId("floor-warning-body")).toHaveTextContent(
      "Ride offers stop when your debt reaches SYP 500,000. Settle at the office to keep driving — SYP 70,000 to go.",
      { exact: false },
    );
    expect(screen.getByTestId("floor-warning-bar")).toBeTruthy();
    // I61: the bar inside the amber warning fills amber, not purple.
    expect(screen.getByTestId("floor-warning-bar-fill")).toHaveStyle({
      backgroundColor: colors.warning,
    });
  });

  it("blocked: the red offers-paused card with the settle steps", async () => {
    await renderMoneyScreens(
      { ...baseRoutes(), [BALANCE]: ok(blockedBalanceView()) },
      { initialUrl: "/balance" },
    );

    const blocked = await screen.findByTestId("floor-blocked");
    expect(blocked).toHaveTextContent("Ride offers are paused", { exact: false });
    expect(screen.getByTestId("floor-blocked-body")).toHaveTextContent(
      "Your debt reached SYP 520,000 — past the SYP 500,000 limit. You won't get new offers until you settle.",
      { exact: false },
    );
    expect(screen.getByTestId("floor-blocked-debt")).toHaveTextContent(
      "SYP 520,000",
      { exact: false },
    );
    expect(screen.getByTestId("settle-steps")).toHaveTextContent(
      "How to get back on the road",
      { exact: false },
    );
    // The card never links to itself and carries the steps already.
    expect(screen.queryByTestId("floor-blocked-see-balance")).toBeNull();
    expect(screen.queryByTestId("balance-how-to-settle")).toBeNull();
  });

  it("never shows floor UI for a non-operating currency while the region is unresolved (R-W4)", async () => {
    await renderMoneyScreens(
      { ...baseRoutes(), [BALANCE]: ok(twoCurrencyView("ok", "blocked")) },
      { initialUrl: "/balance" },
    );
    // The balances[0] fallback (USD) shows as a neutral amount.
    expect(await screen.findByTestId("balance-amount")).toHaveTextContent(
      "USD 60",
      { exact: false },
    );
    expect(screen.queryByTestId("floor-blocked")).toBeNull();
    expect(screen.queryByTestId("floor-warning")).toBeNull();
    expect(screen.getByTestId("balance-how-to-settle")).toBeTruthy();
  });

  it("shows the red card for the operating currency's blocked floor (R-W4)", async () => {
    const spy = resolveRegionSyp();
    try {
      await renderMoneyScreens(
        { ...baseRoutes(), [BALANCE]: ok(twoCurrencyView("blocked", "ok")) },
        { initialUrl: "/balance" },
      );
      expect(await screen.findByTestId("floor-blocked")).toHaveTextContent(
        "SYP 520,000",
        { exact: false },
      );
      expect(screen.getByTestId("balance-amount")).toHaveTextContent(
        "SYP 520,000",
        { exact: false },
      );
      expect(screen.getByTestId("balance-entry-USD")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("derives the typed recent activity from the per-trip itemization", async () => {
    const cashId = tripEarningFixture().rideId;
    const walletId = walletEarningFixture().rideId;
    const feeId = feeOnlyEarningFixture().rideId;
    await renderMoneyScreens(baseRoutes(), { initialUrl: "/balance" });

    // Cash ride → commission debit.
    const commission = await screen.findByTestId(`${cashId}-commission`);
    expect(commission).toHaveTextContent("Commission · cash ride", { exact: false });
    expect(commission).toHaveTextContent("fare 28,000 · 25%", { exact: false });
    expect(commission).toHaveTextContent("−SYP 7,000", { exact: false });
    // Its tip → commission-free credit.
    const tip = screen.getByTestId(`${cashId}-tip`);
    expect(tip).toHaveTextContent("Tip", { exact: false });
    expect(tip).toHaveTextContent("commission-free", { exact: false });
    expect(tip).toHaveTextContent("+SYP 5,000", { exact: false });
    // Wallet ride → fare − commission credit (COM-01).
    const earning = screen.getByTestId(`${walletId}-earning`);
    expect(earning).toHaveTextContent("Ride earnings · wallet ride", { exact: false });
    expect(earning).toHaveTextContent("+SYP 23,625", { exact: false });
    // Fee-only row → ONE "all yours" credit, no phantom fare/commission (W17).
    const fee = screen.getByTestId(`${feeId}-fee`);
    expect(fee).toHaveTextContent("Cancellation fee", { exact: false });
    expect(fee).toHaveTextContent("all yours", { exact: false });
    expect(fee).toHaveTextContent("+SYP 10,000", { exact: false });
    expect(screen.queryByTestId(`${feeId}-commission`)).toBeNull();
    expect(screen.queryByTestId(`${feeId}-earning`)).toBeNull();
    expect(screen.getByTestId("balance-activity")).not.toHaveTextContent(
      "fare 0",
      { exact: false },
    );
  });

  it("renders a mixed wallet ride's fare entry as the server's net − tip (H5)", async () => {
    // fare 28,000, wallet 10,000, commission 7,000, tip 2,000: net 5,000.
    const positive = mixedWalletEarningFixture({ tip: 2000, net: 5000 });
    // wallet 5,000 < commission 7,000: the ledger DEBITS 2,000.
    const negative = mixedWalletEarningFixture({
      rideId: "5b1d3f0e-1111-4c4c-9a9a-000000000005",
      net: -2000,
    });
    await renderMoneyScreens(
      { ...baseRoutes(), [EARNINGS]: ok(earningPage([positive, negative])) },
      { initialUrl: "/balance" },
    );

    const credit = await screen.findByTestId(`${positive.rideId}-earning`);
    // Never fare − commission (+21,000): the netted ledger amount.
    expect(credit).toHaveTextContent("+SYP 3,000", { exact: false });
    expect(credit).not.toHaveTextContent("21,000", { exact: false });
    expect(screen.getByTestId(`${positive.rideId}-tip`)).toHaveTextContent(
      "+SYP 2,000",
      { exact: false },
    );
    const debit = screen.getByTestId(`${negative.rideId}-earning`);
    expect(debit).toHaveTextContent("−SYP 2,000", { exact: false });
    // Coloured by sign: credit in the accent, debit not.
    const amountColor = (testID: string) =>
      screen.getByTestId(testID).findAll(
        (node) =>
          typeof node.type === "string" &&
          /SYP/u.test(String(node.props.children)),
      )[0]?.props.style;
    expect(JSON.stringify(amountColor(`${positive.rideId}-earning`))).toContain(
      colors.accent,
    );
    expect(JSON.stringify(amountColor(`${negative.rideId}-earning`))).not.toContain(
      colors.accent,
    );
  });

  it("shows the empty-activity state", async () => {
    await renderMoneyScreens(
      { ...baseRoutes(), [EARNINGS]: ok(earningPage([])) },
      { initialUrl: "/balance" },
    );
    expect(
      await screen.findByTestId("balance-activity-empty"),
    ).toHaveTextContent("Nothing here yet", { exact: false });
  });

  it("'How to settle' toggles the settle instructions", async () => {
    await renderMoneyScreens(baseRoutes(), { initialUrl: "/balance" });

    expect(screen.queryByTestId("balance-settle-steps")).toBeNull();
    fireEvent.press(await screen.findByTestId("balance-how-to-settle"));
    expect(await screen.findByTestId("balance-settle-steps")).toHaveTextContent(
      "Visit the Labby office",
      { exact: false },
    );
    fireEvent.press(screen.getByTestId("balance-how-to-settle"));
    expect(screen.queryByTestId("balance-settle-steps")).toBeNull();
  });

  it("renders in Arabic: Western digits, ل.س and the RTL copy", async () => {
    await setAppLanguage("ar");
    await renderMoneyScreens(
      { ...baseRoutes(), [BALANCE]: ok(balanceViewFixture()) },
      { initialUrl: "/balance", language: "ar" },
    );

    expect(await screen.findByTestId("balance-card")).toHaveTextContent(
      "أنت مدين لِلبي",
      { exact: false },
    );
    const amount = screen.getByTestId("balance-amount");
    expect(amount).toHaveTextContent("ل.س", { exact: false });
    expect(amount).toHaveTextContent("430,000", { exact: false });
    expect(amount).not.toHaveTextContent(/[٠-٩]/u);
    expect(screen.getByTestId("floor-warning-body")).toHaveTextContent(
      "500,000",
      { exact: false },
    );
    expect(screen.getByTestId("floor-warning-body")).toHaveTextContent(
      "70,000",
      { exact: false },
    );
  });

  it("keeps Western digits on the whole screen even where plain 'ar' would not (W18)", async () => {
    const restore = simulateArabicIndicIcu();
    try {
      expect(new Intl.NumberFormat("ar").format(5)).toBe("٥");
      await setAppLanguage("ar");
      await renderMoneyScreens(
        { ...baseRoutes(), [BALANCE]: ok(balanceViewFixture()) },
        { initialUrl: "/balance", language: "ar" },
      );
      const activity = await screen.findByTestId("balance-activity");
      // Times and dates of every row, amounts, the floor banner.
      expect(activity).toHaveTextContent("28,000", { exact: false });
      expect(screen.getByTestId("balance-screen")).not.toHaveTextContent(
        NON_WESTERN_DIGITS,
      );
    } finally {
      restore();
    }
  });
});

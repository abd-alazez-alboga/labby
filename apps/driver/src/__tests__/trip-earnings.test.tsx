/**
 * M8-T4 — UC-D-15 against money-v1.yaml mocks: the per-trip earnings
 * breakdown after the payment settles (artboard "Driver Trip earnings") —
 * cash ride (collected cash, commission line, tip, signed balance change,
 * running balance, debt explainer), wallet ride (credited net, wallet
 * wording), mixed payment (cash remainder collected on the complete screen,
 * then the breakdown), Done → home, the earnings deep link, and the
 * missing-entry fallback.
 */
import { fireEvent } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
  goLive,
  mockLocationGranted,
  receive,
  renderDriverApp,
  screen,
  waitForResync,
} from "../test-utils/ride-harness";
import {
  BALANCE,
  balanceEntryFixture,
  balanceViewFixture,
  EARNINGS,
  earningPage,
  tripEarningFixture,
  walletEarningFixture,
} from "../test-utils/money";
import { completedRide, RIDE_ID, rideFrame } from "../test-utils/rides";
import type { MockResponse } from "../test-utils/contract";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";

const RIDE = `/api/v1/driver/rides/${RIDE_ID}`;
const CASH = `POST ${RIDE}/cash-confirm`;
const originalWebSocket = globalThis.WebSocket;

const ok = (body: unknown): MockResponse => ({ status: 200, body });

describe("per-trip earnings breakdown (UC-D-15)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
    mockLocationGranted();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("cash ride: collected cash, fare/commission/tip lines, balance change and balance now", async () => {
    const contract = await renderDriverApp(
      {
        [ACTIVE_RIDE]: ok(completedRide()),
        [CASH]: ok(completedRide({ paymentStatus: "paid_cash" })),
        [EARNINGS]: ok(earningPage([tripEarningFixture()])),
        [BALANCE]: ok(balanceViewFixture()),
      },
      { money: true },
    );
    await goLive();
    await waitForResync(contract);

    fireEvent.press(await screen.findByTestId("cash-received"));

    expect(await screen.findByTestId("trip-earnings-screen")).toBeTruthy();
    expect(screen.getByTestId("trip-earnings-title")).toHaveTextContent(
      "Ride complete · Rana",
    );
    // The dark card: the full fare was collected in cash.
    expect(screen.getByTestId("trip-earnings-card")).toHaveTextContent(
      "You collected in cash",
      { exact: false },
    );
    expect(screen.getByTestId("trip-earnings-card")).toHaveTextContent(
      "cash ride",
      { exact: false },
    );
    // COM-01 itemization straight from GET /driver/earnings.
    expect(await screen.findByTestId("earning-line-fare")).toHaveTextContent(
      "Fare · you keep the cashSYP 28,000",
    );
    // The dark card: the ride's cashDue — what the driver collected.
    expect(screen.getByTestId("trip-earnings-total")).toHaveTextContent(
      "SYP 27,250",
    );
    expect(screen.getByTestId("earning-line-commission")).toHaveTextContent(
      "Commission · 25%−SYP 7,000",
    );
    expect(screen.getByTestId("earning-line-tip")).toHaveTextContent(
      "Tip from Rana · all yours+SYP 5,000",
    );
    expect(screen.getByTestId("earning-line-net")).toHaveTextContent(
      "Balance change−SYP 2,000",
    );
    // Balance now from GET /driver/balance (refreshed alongside).
    expect(screen.getByTestId("earning-line-balance")).toHaveTextContent(
      "Balance now−SYP 430,000",
    );
    expect(screen.getByTestId("trip-earnings-explainer")).toHaveTextContent(
      "On cash rides you keep the fare and owe Labby the commission.",
      { exact: false },
    );

    // Done → back to the online home.
    fireEvent.press(screen.getByTestId("trip-earnings-done"));
    expect(await screen.findByTestId("availability-online")).toBeTruthy();
  });

  it("wallet ride: completion settles instantly and the net is credited", async () => {
    const walletRide = completedRide({
      paymentMethod: "wallet",
      paymentStatus: "paid_wallet",
      walletApplied: 27250,
      cashDue: null,
    });
    const contract = await renderDriverApp(
      {
        [EARNINGS]: ok(
          earningPage([
            walletEarningFixture({ rideId: RIDE_ID, net: 20437.5 }),
          ]),
        ),
        [BALANCE]: ok(
          balanceViewFixture({
            balances: [balanceEntryFixture({ balance: -50000, status: "ok" })],
          }),
        ),
        [ACTIVE_RIDE]: ok(completedRide({ paymentMethod: "wallet" })),
      },
      { money: true },
    );
    const socket = await goLive();
    await waitForResync(contract);
    expect(await screen.findByTestId("ride-complete-screen")).toBeTruthy();

    // The payment settles server-side (wallet covers it) — a frame arrives.
    receive(socket, rideFrame("ride.state", walletRide));

    expect(await screen.findByTestId("trip-earnings-screen")).toBeTruthy();
    expect(screen.getByTestId("trip-earnings-card")).toHaveTextContent(
      "Credited to you",
      { exact: false },
    );
    expect(await screen.findByTestId("trip-earnings-total")).toHaveTextContent(
      "+SYP 20,437.5",
    );
    expect(screen.getByTestId("trip-earnings-card")).toHaveTextContent(
      "wallet ride",
      { exact: false },
    );
    expect(await screen.findByTestId("earning-line-fare")).toHaveTextContent(
      "Fare · paid from walletSYP 31,500",
    );
    expect(screen.getByTestId("earning-line-commission")).toHaveTextContent(
      "Commission · 25%−SYP 7,875",
    );
    expect(screen.queryByTestId("earning-line-tip")).toBeNull();
    expect(screen.getByTestId("trip-earnings-explainer")).toHaveTextContent(
      "On wallet rides Labby collects the fare",
      { exact: false },
    );
  });

  it("mixed payment: the complete screen collects the CASH REMAINDER, then the breakdown", async () => {
    const pendingMixed = completedRide({
      paymentMethod: "wallet",
      walletApplied: 20000,
      cashDue: 7250,
    });
    const contract = await renderDriverApp(
      {
        [ACTIVE_RIDE]: ok(pendingMixed),
        [CASH]: ok(
          completedRide({
            paymentMethod: "wallet",
            paymentStatus: "paid_mixed",
            walletApplied: 20000,
            cashDue: 7250,
          }),
        ),
        [EARNINGS]: ok(
          earningPage([
            tripEarningFixture({ paymentMethod: "wallet", tip: null, net: -7000 }),
          ]),
        ),
        [BALANCE]: ok(balanceViewFixture()),
      },
      { money: true },
    );
    await goLive();
    await waitForResync(contract);

    // UC-D-09 + PAY-02: collect only the remainder; the wallet part is a line.
    expect(await screen.findByTestId("collect-total")).toHaveTextContent(
      "SYP 7,250",
    );
    expect(screen.getByTestId("fare-line-wallet-applied")).toHaveTextContent(
      "Paid from wallet−SYP 20,000",
    );
    expect(screen.getByTestId("fare-line-cash-due")).toHaveTextContent(
      "Cash to collectSYP 7,250",
    );

    fireEvent.press(screen.getByTestId("cash-received"));
    expect(await screen.findByTestId("trip-earnings-screen")).toBeTruthy();
    // The dark card shows what was collected in cash (the remainder).
    expect(screen.getByTestId("trip-earnings-card")).toHaveTextContent(
      "You collected in cash",
      { exact: false },
    );
    expect(await screen.findByTestId("trip-earnings-total")).toHaveTextContent(
      "SYP 7,250",
    );
    expect(await screen.findByTestId("earning-line-fare")).toHaveTextContent(
      "Fare · wallet + cash",
      { exact: false },
    );
    expect(screen.getByTestId("earning-line-wallet")).toHaveTextContent(
      "Paid from walletSYP 20,000",
    );
  });

  it("'See this week's earnings' dismisses the breakdown and opens the earnings screen", async () => {
    const contract = await renderDriverApp(
      {
        [ACTIVE_RIDE]: ok(completedRide()),
        [CASH]: ok(completedRide({ paymentStatus: "paid_cash" })),
        [EARNINGS]: ok(earningPage([tripEarningFixture()])),
        [BALANCE]: ok(balanceViewFixture()),
      },
      { money: true },
    );
    await goLive();
    await waitForResync(contract);
    fireEvent.press(await screen.findByTestId("cash-received"));
    fireEvent.press(await screen.findByTestId("trip-earnings-see-week"));
    expect(await screen.findByTestId("earnings-route")).toBeTruthy();
  });

  it("explains when the ride's entry is not posted yet and retries", async () => {
    const contract = await renderDriverApp(
      {
        [ACTIVE_RIDE]: ok(completedRide()),
        [CASH]: ok(completedRide({ paymentStatus: "paid_cash" })),
        [EARNINGS]: [
          ok(earningPage([])),
          ok(earningPage([tripEarningFixture()])),
        ],
        [BALANCE]: ok(balanceViewFixture()),
      },
      { money: true },
    );
    await goLive();
    await waitForResync(contract);
    fireEvent.press(await screen.findByTestId("cash-received"));

    expect(await screen.findByTestId("trip-earnings-missing")).toBeTruthy();
    // The card still shows the collected cash from the ride itself.
    expect(screen.getByTestId("trip-earnings-total")).toHaveTextContent(
      "SYP 27,250",
    );
    // Done is never blocked by the fetch.
    expect(screen.getByTestId("trip-earnings-done")).toBeTruthy();

    // Retry re-reads the earnings; the posted entry now shows.
    fireEvent.press(screen.getByTestId("trip-earnings-retry"));
    expect(await screen.findByTestId("earning-line-fare")).toHaveTextContent(
      "SYP 28,000",
      { exact: false },
    );
    expect(screen.queryByTestId("trip-earnings-missing")).toBeNull();
    expect(contract.requestsTo(EARNINGS)).toHaveLength(2);
  });

  it("renders the breakdown in Arabic with Western digits and ل.س", async () => {
    await setAppLanguage("ar");
    const contract = await renderDriverApp(
      {
        [ACTIVE_RIDE]: ok(completedRide()),
        [CASH]: ok(completedRide({ paymentStatus: "paid_cash" })),
        [EARNINGS]: ok(earningPage([tripEarningFixture()])),
        [BALANCE]: ok(balanceViewFixture()),
      },
      { money: true, language: "ar" },
    );
    await goLive();
    await waitForResync(contract);
    fireEvent.press(await screen.findByTestId("cash-received"));

    expect(await screen.findByTestId("trip-earnings-screen")).toBeTruthy();
    expect(screen.getByTestId("trip-earnings-card")).toHaveTextContent(
      "حصّلت نقداً",
      { exact: false },
    );
    expect(await screen.findByTestId("earning-line-commission")).toHaveTextContent(
      "25%",
      { exact: false },
    );
    const total = screen.getByTestId("trip-earnings-total");
    expect(total).toHaveTextContent("ل.س", { exact: false });
    expect(total).toHaveTextContent("27,250", { exact: false });
    expect(total).not.toHaveTextContent(/[٠-٩]/u);
    expect(screen.getByTestId("earning-line-net")).toHaveTextContent("2,000", {
      exact: false,
    });
  });

  it("cash ride with a carried fee: itemized on Complete, the card shows cashDue (W6)", async () => {
    const due = {
      dueId: "d0000000-0000-4000-8000-000000000001",
      sourceRideId: "5b1d3f0e-1111-4c4c-9a9a-0000000000aa",
      amount: 10000,
      currency: "SYP",
      method: "cash" as const,
      status: "earmarked" as const,
    };
    const contract = await renderDriverApp(
      {
        [ACTIVE_RIDE]: ok(completedRide({ cashDue: 37250, carriedDues: [due] })),
        [CASH]: ok(
          completedRide({
            paymentStatus: "paid_cash",
            cashDue: 37250,
            carriedDues: [{ ...due, status: "collected" }],
          }),
        ),
        [EARNINGS]: ok(earningPage([tripEarningFixture()])),
        [BALANCE]: ok(balanceViewFixture()),
      },
      { money: true },
    );
    await goLive();
    await waitForResync(contract);

    // Fare 27,250 + carried fee 10,000 = Collect 37,250.
    expect(await screen.findByTestId("collect-total")).toHaveTextContent(
      "SYP 37,250",
    );
    expect(
      screen.getByTestId(`fare-line-carried-${due.dueId}`),
    ).toHaveTextContent("Carried fee from an earlier rideSYP 10,000");
    expect(screen.getByTestId("fare-line-cash-due")).toHaveTextContent(
      "Cash to collectSYP 37,250",
    );
    expect(screen.queryByTestId("fare-line-wallet-applied")).toBeNull();

    fireEvent.press(screen.getByTestId("cash-received"));
    expect(await screen.findByTestId("trip-earnings-screen")).toBeTruthy();
    // "Collected in cash" is the ride's cashDue, not the fare total.
    expect(screen.getByTestId("trip-earnings-total")).toHaveTextContent(
      "SYP 37,250",
    );
    // …and the carried fee inside it is itemized under the fare.
    expect(
      await screen.findByTestId(`earning-line-carried-${due.dueId}`),
    ).toHaveTextContent("Carried fee from an earlier rideSYP 10,000");
  });

  it("wallet covered the whole fare but a cash fee is owed: collect just the fee (rides-v1 B)", async () => {
    const due = {
      dueId: "d0000000-0000-4000-8000-000000000002",
      sourceRideId: "5b1d3f0e-1111-4c4c-9a9a-0000000000bb",
      amount: 5000,
      currency: "SYP",
      method: "cash" as const,
      status: "earmarked" as const,
    };
    // A wallet-taken due is not the driver's to collect — never a cash line.
    const walletDue = {
      ...due,
      dueId: "d0000000-0000-4000-8000-000000000003",
      method: "wallet" as const,
      status: "collected" as const,
    };
    const pending = completedRide({
      paymentMethod: "wallet",
      walletApplied: 27250,
      cashDue: 5000,
      carriedDues: [due, walletDue],
    });
    const contract = await renderDriverApp(
      {
        [ACTIVE_RIDE]: ok(pending),
        [CASH]: ok({
          ...pending,
          paymentStatus: "paid_mixed",
          carriedDues: [{ ...due, status: "collected" }, walletDue],
        }),
        [EARNINGS]: ok(
          earningPage([walletEarningFixture({ rideId: RIDE_ID, fareTotal: 27250 })]),
        ),
        [BALANCE]: ok(balanceViewFixture()),
      },
      { money: true },
    );
    await goLive();
    await waitForResync(contract);

    // The normal cash-confirm / mark-unpaid flow, collecting only the fee.
    expect(await screen.findByTestId("collect-total")).toHaveTextContent(
      "SYP 5,000",
    );
    expect(screen.getByTestId("fare-line-wallet-applied")).toHaveTextContent(
      "Paid from wallet−SYP 27,250",
    );
    expect(
      screen.getByTestId(`fare-line-carried-${due.dueId}`),
    ).toHaveTextContent("Carried fee from an earlier rideSYP 5,000");
    expect(
      screen.queryByTestId(`fare-line-carried-${walletDue.dueId}`),
    ).toBeNull();
    expect(screen.getByTestId("fare-line-cash-due")).toHaveTextContent(
      "Cash to collectSYP 5,000",
    );
    expect(screen.getByTestId("mark-unpaid")).toBeTruthy();

    fireEvent.press(screen.getByTestId("cash-received"));
    expect(await screen.findByTestId("trip-earnings-screen")).toBeTruthy();
    expect(screen.getByTestId("trip-earnings-total")).toHaveTextContent(
      "SYP 5,000",
    );
    expect(
      await screen.findByTestId(`earning-line-carried-${due.dueId}`),
    ).toHaveTextContent("Carried fee from an earlier rideSYP 5,000");
    expect(
      screen.queryByTestId(`earning-line-carried-${walletDue.dueId}`),
    ).toBeNull();
  });

  it("keeps Western digits on Complete and the breakdown where plain 'ar' would not (W18)", async () => {
    const restore = simulateArabicIndicIcu();
    try {
      await setAppLanguage("ar");
      const contract = await renderDriverApp(
        {
          [ACTIVE_RIDE]: ok(completedRide()),
          [CASH]: ok(completedRide({ paymentStatus: "paid_cash" })),
          [EARNINGS]: ok(earningPage([tripEarningFixture()])),
          [BALANCE]: ok(balanceViewFixture()),
        },
        { money: true, language: "ar" },
      );
      await goLive();
      await waitForResync(contract);
      // Complete: distance, minutes, every fare line.
      expect(
        await screen.findByTestId("ride-complete-screen"),
      ).not.toHaveTextContent(NON_WESTERN_DIGITS);
      fireEvent.press(screen.getByTestId("cash-received"));
      expect(await screen.findByTestId("earning-line-net")).toBeTruthy();
      expect(
        screen.getByTestId("trip-earnings-screen"),
      ).not.toHaveTextContent(NON_WESTERN_DIGITS);
    } finally {
      restore();
    }
  });
});

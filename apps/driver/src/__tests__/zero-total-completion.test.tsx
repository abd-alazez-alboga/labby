/**
 * V1 audit W29 (money-v1 "Zero total"): a promo covering the whole fare with
 * nothing carried in cash settles AT COMPLETION (`paid_cash` /
 * `paid_wallet`, `cashDue` null). The driver never sees "Collect SYP 0" or
 * a cash-confirm: a short "Nothing to collect" completion with one Done,
 * which moves on to the trip's earnings breakdown (the promo compensation
 * is still paid — owner decision 2026-10-21); that screen's Done finishes.
 * Per shared member, a 0 share with nothing due reads as settled.
 */
import { fireEvent, waitFor } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import type { MockResponse } from "../test-utils/contract";
import { EARNINGS, earningPage, tripEarningFixture } from "../test-utils/money";
import { MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
  goLive,
  mockLocationGranted,
  renderDriverApp,
  screen,
  waitForResync,
} from "../test-utils/ride-harness";
import {
  completedRide,
  componentsFixture,
  inProgressRide,
  RIDE_ID,
} from "../test-utils/rides";
import {
  completedShared,
  LINA,
  OMAR,
  RANA,
  withSplit,
} from "../test-utils/scheduled";

const RIDE = `/api/v1/driver/rides/${RIDE_ID}`;
const COMPLETE = `POST ${RIDE}/complete`;
const originalWebSocket = globalThis.WebSocket;
const ok = (body: unknown): MockResponse => ({ status: 200, body });

/** Stored fare 27,250 fully discounted by a promo — total 0. */
const ZERO_FARE = {
  distanceMeters: 4200,
  durationSeconds: 840,
  components: componentsFixture({
    surchargePercent: 25,
    surchargeAmount: 5450,
    discount: 27250,
    total: 0,
  }),
};

async function endRide(
  completed: unknown,
  language: "en" | "ar" = "en",
  extra: Record<string, MockResponse> = {},
) {
  const contract = await renderDriverApp(
    { [ACTIVE_RIDE]: ok(inProgressRide()), [COMPLETE]: ok(completed), ...extra },
    { language },
  );
  await goLive();
  await waitForResync(contract);
  fireEvent.press(await screen.findByTestId("ride-end"));
  return contract;
}

describe("zero-total completion (W29)", () => {
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

  it("a cash ride settled at 0 shows 'Nothing to collect', no cash-confirm; Done → its earnings → Done finishes", async () => {
    // The promo covered the fare: commission −6,812.5, promo top-up +27,250.
    const earning = tripEarningFixture({
      fareTotal: 27250,
      commissionAmount: 6812.5,
      tip: null,
      promoCompensation: 27250,
      net: 20437.5,
    });
    const contract = await endRide(
      completedRide({
        paymentStatus: "paid_cash",
        cashDue: null,
        fare: ZERO_FARE,
      }),
      "en",
      { [EARNINGS]: ok(earningPage([earning])) },
    );
    expect(await screen.findByTestId("nothing-to-collect-screen")).toBeTruthy();
    expect(screen.getByTestId("complete-title")).toHaveTextContent(
      "Ride complete · Rana",
    );
    expect(screen.getByTestId("nothing-to-collect-title")).toHaveTextContent(
      "Nothing to collect",
    );
    expect(screen.getByTestId("nothing-to-collect-card")).toHaveTextContent(
      /Already settled/,
    );
    expect(screen.getByTestId("nothing-to-collect-body")).toHaveTextContent(
      "A promo covered the whole fare — the rider pays nothing and there's no cash to confirm.",
    );
    // The stored lines, the discount bringing them to 0 (server amounts).
    expect(screen.getByTestId("fare-line-discount")).toHaveTextContent(
      "−SYP 27,250",
      { exact: false },
    );
    // Never "Collect SYP 0" or a cash-confirm, never the earnings breakdown.
    expect(screen.queryByTestId("ride-complete-screen")).toBeNull();
    expect(screen.queryByTestId("collect-total")).toBeNull();
    expect(screen.queryByTestId("cash-received")).toBeNull();
    expect(screen.queryByTestId("mark-unpaid")).toBeNull();
    expect(screen.queryByTestId("trip-earnings-screen")).toBeNull();
    expect(contract.requestsTo(`POST ${RIDE}/cash-confirm`)).toHaveLength(0);

    // Owner decision 2026-10-21: Done moves on to the earnings breakdown.
    fireEvent.press(screen.getByTestId("nothing-to-collect-done"));
    expect(await screen.findByTestId("trip-earnings-screen")).toBeTruthy();
    expect(screen.queryByTestId("nothing-to-collect-screen")).toBeNull();
    expect(await screen.findByTestId("earning-line-promo")).toHaveTextContent(
      "+SYP 27,250",
      { exact: false },
    );
    expect(contract.requestsTo(`POST ${RIDE}/cash-confirm`)).toHaveLength(0);

    fireEvent.press(screen.getByTestId("trip-earnings-done"));
    await waitFor(() =>
      expect(screen.queryByTestId("trip-earnings-screen")).toBeNull(),
    );
    expect(screen.queryByTestId("nothing-to-collect-screen")).toBeNull();
  });

  it("a wallet ride settled at 0 (paid_wallet) also has nothing to collect", async () => {
    await endRide(
      completedRide({
        paymentMethod: "wallet",
        paymentStatus: "paid_wallet",
        walletApplied: null,
        cashDue: null,
        fare: ZERO_FARE,
      }),
    );
    expect(await screen.findByTestId("nothing-to-collect-screen")).toBeTruthy();
    expect(screen.queryByTestId("trip-earnings-screen")).toBeNull();
  });

  it("a 0 total that still carries a cash due stays pending: collect just the due", async () => {
    await endRide(
      completedRide({
        paymentStatus: "pending",
        cashDue: 3000,
        fare: ZERO_FARE,
        carriedDues: [
          {
            dueId: "d-1",
            sourceRideId: "5b1d3f0e-1111-4c4c-9a9a-000000000009",
            amount: 3000,
            currency: "SYP",
            method: "cash",
            status: "earmarked",
          },
        ],
      }),
    );
    expect(await screen.findByTestId("ride-complete-screen")).toBeTruthy();
    expect(screen.getByTestId("collect-total")).toHaveTextContent("SYP 3,000");
    expect(screen.queryByTestId("nothing-to-collect-screen")).toBeNull();
  });

  it("Arabic: nothing to collect, Done", async () => {
    await setAppLanguage("ar");
    await endRide(
      completedRide({
        paymentStatus: "paid_cash",
        cashDue: null,
        fare: ZERO_FARE,
      }),
      "ar",
    );
    expect(await screen.findByTestId("nothing-to-collect-title")).toHaveTextContent(
      "لا شيء لتحصيله",
    );
    expect(screen.getByTestId("nothing-to-collect-done")).toHaveTextContent("تم", {
      exact: false,
    });
  });

  it("shared: a member with a 0 share and nothing due shows as settled, no amount or cash buttons", async () => {
    const ride = withSplit(completedShared());
    const members = ride.shared!.members.map((member) =>
      member.memberId === OMAR.memberId
        ? {
            ...member,
            paymentMethod: "cash" as const,
            shareAmount: 0,
            walletApplied: null,
            cashDue: null,
            paymentStatus: "paid_cash" as const,
          }
        : member,
    );
    const contract = await renderDriverApp({
      [ACTIVE_RIDE]: ok({ ...ride, shared: { ...ride.shared!, members } }),
    });
    await goLive();
    await waitForResync(contract);
    expect(await screen.findByTestId("shared-collect-screen")).toBeTruthy();
    const omar = screen.getByTestId(`collect-${OMAR.memberId}`);
    expect(omar).toHaveTextContent(/Nothing to pay · covered in full/);
    expect(screen.getByTestId(`collect-status-${OMAR.memberId}`)).toHaveTextContent(
      "Settled",
    );
    expect(omar).not.toHaveTextContent(/Cash received/);
    expect(screen.queryByTestId(`collect-amount-${OMAR.memberId}`)).toBeNull();
    expect(screen.queryByTestId(`collect-cash-${OMAR.memberId}`)).toBeNull();
    // The paying party still collects as before.
    expect(screen.getByTestId(`collect-amount-${RANA.memberId}`)).toHaveTextContent(
      "SYP 19,000",
    );
    expect(screen.getByTestId(`collect-cash-${RANA.memberId}`)).toBeTruthy();
    expect(screen.getByTestId(`collect-${LINA.memberId}`)).toBeTruthy();
  });
});

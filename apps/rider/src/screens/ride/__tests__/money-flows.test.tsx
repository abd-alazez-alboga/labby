/**
 * M8-T3 money on the ride screens, against rides-v1/money-v1 mocks:
 * - the wait-charge notice on the driver-arrived sheet (PRC-03): free
 *   countdown before the grace ends, accruing amber card after (rate from
 *   the region config, authoritative value with the fare);
 * - the completed screen's wallet/cash/carried-due split (PAY-02) and the
 *   tip entry (UC-R-08) incl. the window;
 * - the receipt's "How you paid" box, tip line and tip entry/window.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { RegionProvider } from "../../../region/region-context";
import { RideProvider } from "../../../ride/ride-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  carriedDue,
  DUE_ID,
  tipResponse,
  walletView,
} from "../../../test-utils/money-fixtures";
import {
  acceptedRide,
  components,
  FakeSocket,
  fakeSocketFactory,
  receiptFixture,
  RIDE_ID,
  sampleDriver,
} from "../../../test-utils/ride-fixtures";
import ReceiptScreen from "../receipt-screen";
import RideScreen from "../ride-screen";

// The real icon component re-renders after its async font load, which this
// jest env cannot flush safely — icons render as their name instead (same
// pattern as booking-screen.test).
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: MockText } = require("react-native");
  return {
    Ionicons: ({ name }: { name: string }) => (
      <MockText testID={`icon-${name}`}>{name}</MockText>
    ),
  };
});

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => false,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const locationMock = Location as jest.Mocked<typeof Location>;

function grantLocation() {
  const permission = {
    granted: true,
    status: "granted" as Location.PermissionStatus,
    canAskAgain: true,
    expires: "never" as const,
  };
  locationMock.requestForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 33.5138, longitude: 36.2765 },
  } as Location.LocationObject);
  locationMock.watchPositionAsync.mockResolvedValue({
    remove: jest.fn(),
  } as unknown as Location.LocationSubscription);
}

/** Damascus-realistic region config with the M8 pricing values. */
const REGION_CONFIG = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Damascus",
  currency: "SYP",
  emergencyNumber: "112",
  serviceTypes: [],
  waitGraceMin: 5,
  waitPerMinRate: 500,
};

const REGION_ROUTE = {
  "GET /api/v1/regions/resolve": { status: 200, body: REGION_CONFIG },
};

function withProviders(ui: React.ReactElement) {
  return render(
    <LocaleProvider>
      <RegionProvider>
        <RideProvider socketFactory={fakeSocketFactory}>{ui}</RideProvider>
      </RegionProvider>
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  grantLocation();
});

/** A fixed "now" for the clock-dependent wait-charge amount (R-W5). */
const FROZEN_NOW = Date.parse("2026-10-11T09:40:00Z");
/** Everything but Date stays real, so only the clock is frozen. */
const REAL_TIMER_APIS: FakeableAPI[] = [
  "cancelAnimationFrame",
  "cancelIdleCallback",
  "clearImmediate",
  "clearInterval",
  "clearTimeout",
  "hrtime",
  "nextTick",
  "performance",
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
  "setImmediate",
  "setInterval",
  "setTimeout",
];

describe("wait charge on the driver-arrived sheet (PRC-03)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the free countdown while the grace is running", async () => {
    const arrived = acceptedRide({
      state: "driver_arrived",
      waitGraceEndsAt: new Date(Date.now() + 240_000).toISOString(),
    });
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 200, body: arrived },
      [`GET /api/v1/rides/${RIDE_ID}`]: { status: 200, body: arrived },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);

    expect(await screen.findByText("Free waiting time")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-wait-countdown")).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-wait-charge")).toBeNull();
  });

  it("shows the accruing charge once the grace ended (rate from region config)", async () => {
    // Freeze the clock (Date only — the real timers keep driving the render
    // and waitFor) so the per-second proration is deterministic.
    jest.useFakeTimers({ now: FROZEN_NOW, doNotFake: REAL_TIMER_APIS });
    const graceEnded = new Date(FROZEN_NOW - 210_000); // 3.5 min ago
    const arrived = acceptedRide({
      state: "driver_arrived",
      waitGraceEndsAt: graceEnded.toISOString(),
      timeline: {
        requestedAt: "2026-10-11T09:29:00Z",
        acceptedAt: "2026-10-11T09:29:20Z",
        // Arrived 5 minutes before the grace end (the region's grace).
        driverArrivedAt: new Date(
          graceEnded.getTime() - 5 * 60_000,
        ).toISOString(),
      },
    });
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 200, body: arrived },
      [`GET /api/v1/rides/${RIDE_ID}`]: { status: 200, body: arrived },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);

    const card = await screen.findByTestId("ride-wait-charge");
    expect(card).toHaveTextContent(/Waiting charge has started/);
    // 3.5 min × SYP 500/min, prorated per second like the backend.
    expect(screen.getByTestId("ride-wait-charge-amount")).toHaveTextContent(
      /^SYP 1,750$/,
    );
    expect(card).toHaveTextContent(
      /Your 5 free minutes ended at .*\. Waiting now adds SYP 500 per minute to your fare\./,
    );
    expect(screen.queryByTestId("ride-wait-countdown")).toBeNull();
  });
});

describe("completed screen split + tip (PAY-02, UC-R-08)", () => {
  const completedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const completed = acceptedRide({
    state: "completed",
    paymentMethod: "wallet",
    paymentStatus: "paid_mixed",
    walletApplied: 15000,
    cashDue: 24750,
    carriedDues: [carriedDue()],
    driver: sampleDriver,
    timeline: {
      requestedAt: "2026-10-11T09:29:00Z",
      completedAt,
    },
    fare: {
      distanceMeters: 4200,
      durationSeconds: 840,
      components: components({
        surchargePercent: 25,
        surchargeAmount: 5450,
        waitFare: 1500,
        pickupFee: 1000,
        total: 29750,
      }),
    },
  });

  it("itemizes wallet / cash / carried due / cash handed and sends a tip", async () => {
    const api = mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}`]: { status: 200, body: completed },
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      [`POST /api/v1/rides/${RIDE_ID}/tip`]: {
        status: 201,
        body: tipResponse({ amount: 5000 }),
      },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);

    expect(await screen.findByText("You've arrived")).toBeOnTheScreen();
    expect(screen.getByText("Paid · wallet + cash")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-total")).toHaveTextContent("SYP 29,750");
    expect(screen.getByTestId("ride-paid-wallet")).toHaveTextContent(
      "WalletSYP 15,000",
    );
    expect(screen.getByTestId("ride-paid-cash")).toHaveTextContent(
      "Cash · rest of the fareSYP 14,750",
    );
    // The itemized cash due (carriedDues), never derived by subtraction.
    expect(screen.getByTestId(`ride-paid-due-${DUE_ID}`)).toHaveTextContent(
      "Cancellation fee from an earlier ride · to pay in cashSYP 10,000",
    );
    expect(screen.getByTestId("ride-paid-handed")).toHaveTextContent(
      "Cash handed to driverSYP 24,750",
    );
    // Wait and pickup extras appear itemized in the stored breakdown.
    expect(screen.getByTestId("fare-breakdown-wait")).toHaveTextContent(
      "Waiting timeSYP 1,500",
    );
    expect(screen.getByTestId("fare-breakdown-pickupFee")).toHaveTextContent(
      "Pickup feeSYP 1,000",
    );

    // Tip within the window: entry on the ride-complete screen.
    await fireEvent.press(screen.getByTestId("ride-tip"));
    expect(await screen.findByTestId("tip-title")).toHaveTextContent(
      "Tip Samer",
    );
    await fireEvent.press(screen.getByTestId("tip-send"));
    await waitFor(() =>
      expect(
        api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/tip`),
      ).toHaveLength(1),
    );
    expect(await screen.findByTestId("ride-tip-sent")).toHaveTextContent(
      "Tip sent — thank you!",
    );
    expect(screen.getByTestId("ride-paid-tip")).toHaveTextContent(
      "TipSYP 5,000",
    );
    expect(screen.queryByTestId("ride-tip")).toBeNull();
  });

  it("shows the recorded tip instead of the entry when the ride was tipped", async () => {
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}`]: {
        status: 200,
        body: { ...completed, tip: 2000 },
      },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);

    expect(await screen.findByTestId("ride-paid-tip")).toHaveTextContent(
      "TipSYP 2,000",
    );
    expect(screen.queryByTestId("ride-tip")).toBeNull();
  });
});

describe("receipt split + tip (UC-R-07/08)", () => {
  const recentCompletion = new Date(Date.now() - 60 * 60_000).toISOString();

  function splitReceipt(overrides = {}) {
    return receiptFixture({
      paymentMethod: "wallet",
      paymentStatus: "paid_mixed",
      walletApplied: 15000,
      cashDue: 24750,
      carriedDues: [carriedDue()],
      timeline: {
        requestedAt: "2026-10-11T09:29:00Z",
        startedAt: "2026-10-11T09:35:00Z",
        completedAt: recentCompletion,
      },
      fare: {
        distanceMeters: 4200,
        durationSeconds: 840,
        components: components({
          surchargePercent: 25,
          surchargeAmount: 5450,
          waitFare: 1500,
          pickupFee: 1000,
          total: 29750,
        }),
      },
      ...overrides,
    });
  }

  it("renders the How-you-paid box and tips from the receipt", async () => {
    const api = mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}/receipt`]: {
        status: 200,
        body: splitReceipt(),
      },
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      [`POST /api/v1/rides/${RIDE_ID}/tip`]: {
        status: 201,
        body: tipResponse({ amount: 5000 }),
      },
    });
    await withProviders(<ReceiptScreen rideId={RIDE_ID} />);

    expect(await screen.findByTestId("receipt-paid-box")).toHaveTextContent(
      /How you paid/,
    );
    expect(screen.getByTestId("receipt-paid-wallet")).toHaveTextContent(
      /WalletSYP 15,000/,
    );
    expect(screen.getByTestId("receipt-paid-cash")).toHaveTextContent(
      "Cash · rest of the fareSYP 14,750",
    );
    expect(screen.getByTestId(`receipt-paid-due-${DUE_ID}`)).toHaveTextContent(
      "Cancellation fee from an earlier ride · to pay in cashSYP 10,000",
    );
    expect(screen.getByTestId("receipt-paid-handed")).toHaveTextContent(
      "Cash handed to driverSYP 24,750",
    );
    expect(screen.getByTestId("receipt-payment")).toHaveTextContent(
      /Paid · wallet \+ cash/,
    );
    // Wallet-method ride: the payment row carries the wallet icon.
    expect(
      within(screen.getByTestId("receipt-payment-row")).getByTestId(
        "icon-wallet-outline",
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("receipt-tip"));
    expect(await screen.findByTestId("tip-title")).toHaveTextContent(
      "Tip Samer",
    );
    await fireEvent.press(screen.getByTestId("tip-send"));
    await waitFor(() =>
      expect(
        api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/tip`),
      ).toHaveLength(1),
    );
    expect(await screen.findByTestId("receipt-paid-tip")).toHaveTextContent(
      /TipSYP 5,000/,
    );
    expect(screen.queryByTestId("receipt-tip")).toBeNull();
  });

  it("hides the tip entry once the 24 h window expired", async () => {
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}/receipt`]: {
        status: 200,
        // Fixture completion is 2026-10-08 — outside the 24 h window.
        body: receiptFixture({ paymentStatus: "paid_mixed", walletApplied: 15000, cashDue: 12250 }),
      },
    });
    await withProviders(<ReceiptScreen rideId={RIDE_ID} />);

    expect(await screen.findByTestId("receipt-paid-box")).toBeOnTheScreen();
    expect(screen.queryByTestId("receipt-tip")).toBeNull();
  });

  it("shows the recorded tip line and no entry when already tipped", async () => {
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}/receipt`]: {
        status: 200,
        body: splitReceipt({ tip: 2000 }),
      },
    });
    await withProviders(<ReceiptScreen rideId={RIDE_ID} />);

    expect(await screen.findByTestId("receipt-paid-tip")).toHaveTextContent(
      /TipSYP 2,000/,
    );
    expect(screen.queryByTestId("receipt-tip")).toBeNull();
  });

  it("keeps the plain cash receipt unchanged (no split box)", async () => {
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}/receipt`]: {
        status: 200,
        body: receiptFixture(),
      },
    });
    await withProviders(<ReceiptScreen rideId={RIDE_ID} />);

    expect(await screen.findByTestId("receipt-payment")).toHaveTextContent(
      /Paid in cash/,
    );
    expect(screen.queryByTestId("receipt-paid-box")).toBeNull();
    expect(
      within(screen.getByTestId("receipt-payment-row")).getByTestId(
        "icon-cash-outline",
      ),
    ).toBeOnTheScreen();
  });
});

describe("itemized carried dues with 2-dp amounts (W11)", () => {
  const completedAt = new Date(Date.now() - 5 * 60_000).toISOString();

  it("renders no phantom carried-fee line on a 2-dp mixed ride", async () => {
    const mixed = acceptedRide({
      state: "completed",
      paymentMethod: "wallet",
      paymentStatus: "pending",
      walletApplied: 0.3,
      cashDue: 9.8,
      carriedDues: [],
      tip: 1,
      timeline: { requestedAt: "2026-10-11T09:29:00Z", completedAt },
      fare: {
        distanceMeters: 4200,
        durationSeconds: 840,
        components: components({ total: 10.1 }),
      },
    });
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}`]: { status: 200, body: mixed },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);

    expect(await screen.findByTestId("ride-paid-wallet")).toHaveTextContent(
      "WalletSYP 0.3",
    );
    expect(screen.getByTestId("ride-paid-cash")).toHaveTextContent(
      "Cash · rest of the fareSYP 9.8",
    );
    expect(screen.getByTestId("ride-paid-handed")).toHaveTextContent(
      "Cash handed to driverSYP 9.8",
    );
    expect(screen.queryByTestId(/^ride-paid-due/)).toBeNull();
  });

  const dues = [
    carriedDue({ dueId: "due-cash", amount: 2.1, method: "cash", status: "earmarked" }),
    carriedDue({ dueId: "due-wallet", amount: 1.55, method: "wallet" }),
  ];
  const duesMoney = {
    paymentMethod: "wallet" as const,
    paymentStatus: "pending" as const,
    walletApplied: 4.1,
    cashDue: 8.3, // 6.2 fare cash + 2.10 cash due
    carriedDues: dues,
  };
  const duesFare = {
    distanceMeters: 4200,
    durationSeconds: 840,
    components: components({ total: 10.3 }),
  };
  // Identical rows (and row conditions) on the ride view and the receipt.
  const expectations: [string, string][] = [
    ["wallet", "WalletSYP 4.1"],
    ["cash", "Cash · rest of the fareSYP 6.2"],
    ["due-due-cash", "Cancellation fee from an earlier ride · to pay in cashSYP 2.1"],
    ["due-due-wallet", "Cancellation fee from an earlier ride · taken from walletSYP 1.55"],
    ["handed", "Cash handed to driverSYP 8.3"],
  ];
  const ending = (text: string) =>
    new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

  it("labels wallet and cash carried dues by method on the ride view", async () => {
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}`]: {
        status: 200,
        body: acceptedRide({
          state: "completed",
          ...duesMoney,
          timeline: { requestedAt: "2026-10-11T09:29:00Z", completedAt },
          fare: duesFare,
        }),
      },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);

    expect(await screen.findByText("Pay the rest in cash")).toBeOnTheScreen();
    for (const [key, text] of expectations) {
      expect(screen.getByTestId(`ride-paid-${key}`)).toHaveTextContent(text);
    }
  });

  it("labels wallet and cash carried dues by method on the receipt", async () => {
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}/receipt`]: {
        status: 200,
        body: receiptFixture({
          ...duesMoney,
          timeline: {
            requestedAt: "2026-10-11T09:29:00Z",
            startedAt: "2026-10-11T09:35:00Z",
            completedAt,
          },
          fare: duesFare,
        }),
      },
    });
    await withProviders(<ReceiptScreen rideId={RIDE_ID} />);

    expect(await screen.findByTestId("receipt-paid-box")).toBeOnTheScreen();
    // (The receipt's wallet row also carries its icon.)
    for (const [key, text] of expectations) {
      expect(screen.getByTestId(`receipt-paid-${key}`)).toHaveTextContent(
        ending(text),
      );
    }
  });
});

describe("tipping during the ride (PAY-04, UC-R-08)", () => {
  it("offers Tip <driver> on the in-progress sheet and hides it once tipped", async () => {
    const inRide = acceptedRide({ state: "in_progress" });
    const api = mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 200, body: inRide },
      [`GET /api/v1/rides/${RIDE_ID}`]: { status: 200, body: inRide },
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      [`POST /api/v1/rides/${RIDE_ID}/tip`]: {
        status: 201,
        body: tipResponse({ amount: 5000 }),
      },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);

    const entry = await screen.findByTestId("ride-tip-in-progress");
    expect(entry).toHaveTextContent("Tip Samer");
    await fireEvent.press(entry);
    expect(await screen.findByTestId("tip-window")).toHaveTextContent(
      "You can tip during the ride and up to 24 hours after",
    );
    await fireEvent.press(screen.getByTestId("tip-send"));
    await waitFor(() =>
      expect(
        api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/tip`),
      ).toHaveLength(1),
    );
    expect(await screen.findByTestId("ride-tip-sent")).toHaveTextContent(
      "Tip sent — thank you!",
    );
    expect(screen.queryByTestId("ride-tip-in-progress")).toBeNull();
  });

  it("hides the entry and closes the sheet on a 409 already_tipped", async () => {
    const inRide = acceptedRide({ state: "in_progress" });
    const api = mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 200, body: inRide },
      [`GET /api/v1/rides/${RIDE_ID}`]: { status: 200, body: inRide },
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      // RideMoneyServiceImpl.tip's exact code/message pair.
      [`POST /api/v1/rides/${RIDE_ID}/tip`]: {
        status: 409,
        body: {
          status: 409,
          code: "already_tipped",
          message: "This ride already has a tip",
        },
      },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);

    await fireEvent.press(await screen.findByTestId("ride-tip-in-progress"));
    await screen.findByTestId("tip-balance");
    await fireEvent.press(screen.getByTestId("tip-send"));
    await waitFor(() =>
      expect(
        api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/tip`),
      ).toHaveLength(1),
    );
    expect(await screen.findByTestId("ride-tip-already")).toHaveTextContent(
      "You already tipped for this ride.",
    );
    expect(screen.queryByTestId("tip-sheet")).toBeNull();
    expect(screen.queryByTestId("tip-error")).toBeNull();
    expect(screen.queryByTestId("ride-tip-in-progress")).toBeNull();
    expect(screen.queryByTestId("ride-tip-sent")).toBeNull();
  });

  it("hides the entry when the ride already carries a tip", async () => {
    const tipped = acceptedRide({ state: "in_progress", tip: 2000 });
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/rides/active": { status: 200, body: tipped },
      [`GET /api/v1/rides/${RIDE_ID}`]: { status: 200, body: tipped },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);

    expect(await screen.findByTestId("ride-in-progress")).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-tip-in-progress")).toBeNull();
  });
});

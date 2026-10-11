/**
 * M7-T4 — ride push deep links (rides-v1.yaml "Push"): `ride_offer`
 * {offerId} opens the offer after a resync (gone → a notice, nothing else),
 * `ride` {rideId} opens the active ride; both map to the home route, which
 * is the ride flow. Plus the catalog mapping itself.
 */
import * as Notifications from "expo-notifications";
import { act } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { hrefForLink, isRideLink } from "../notifications/deep-links";
import { MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
  mockLocationGranted,
  NONE,
  OPEN_OFFER,
  renderDriverApp,
  screen,
} from "../test-utils/ride-harness";
import { OFFER_ID, offerFixture, RIDE_ID, rideFixture } from "../test-utils/rides";

jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  isRunningInExpoGo: jest.fn(() => false),
}));

const notificationsMock = Notifications as jest.Mocked<typeof Notifications>;
type TapListener = (response: Notifications.NotificationResponse) => void;
let tapListener: TapListener | null = null;
const originalWebSocket = globalThis.WebSocket;

function tap(data: Record<string, unknown>) {
  return act(async () => {
    tapListener?.({
      actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
      notification: {
        date: 0,
        request: {
          identifier: "push-1",
          content: { title: "t", body: "b", data },
          trigger: null,
        },
      },
    } as unknown as Notifications.NotificationResponse);
  });
}

async function flush() {
  await act(async () => {});
  await act(async () => {});
}

describe("ride deep links", () => {
  it("maps ride / ride_offer to the home route for a driver, the center otherwise", () => {
    expect(
      hrefForLink({ screen: "ride", params: { rideId: RIDE_ID } }, { isDriver: true }),
    ).toBe("/");
    expect(
      hrefForLink(
        { screen: "ride_offer", params: { offerId: OFFER_ID } },
        { isDriver: true },
      ),
    ).toBe("/");
    expect(
      hrefForLink({ screen: "ride", params: { rideId: RIDE_ID } }, { isDriver: false }),
    ).toBe("/notifications");
    expect(isRideLink({ screen: "ride_offer" })).toBe(true);
    expect(isRideLink({ screen: "driver_documents" })).toBe(false);
    expect(isRideLink(null)).toBe(false);
  });
});

describe("ride push taps", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    tapListener = null;
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    notificationsMock.addNotificationResponseReceivedListener.mockImplementation(
      (listener) => {
        tapListener = listener;
        return { remove: jest.fn() };
      },
    );
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue(null);
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
    mockLocationGranted();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  const offerPush = {
    notificationId: "n-1",
    category: "ride",
    event: "ride.offer",
    screen: "ride_offer",
    params: JSON.stringify({ offerId: OFFER_ID }),
  };

  it("ride_offer tap resyncs and opens the open offer", async () => {
    const contract = await renderDriverApp({
      [OPEN_OFFER]: [NONE, { status: 200, body: offerFixture() }],
      "POST /api/v1/notifications/n-1/read": { status: 204 },
    });
    await flush();
    expect(screen.queryByTestId("offer-card")).toBeNull();

    await tap(offerPush);

    expect(await screen.findByTestId("offer-card")).toBeTruthy();
    expect(contract.requestsTo(OPEN_OFFER).length).toBeGreaterThanOrEqual(2);
  });

  it("ride_offer tap on an offer that is gone shows a notice, nothing else", async () => {
    await renderDriverApp({
      "POST /api/v1/notifications/n-1/read": { status: 204 },
    });
    await flush();

    await tap(offerPush);

    expect(await screen.findByTestId("ride-notice-offerGone")).toBeTruthy();
    expect(screen.queryByTestId("offer-card")).toBeNull();
    expect(screen.getByTestId("home-screen")).toBeTruthy();
  });

  it("ride tap resyncs and opens the active ride", async () => {
    const contract = await renderDriverApp({
      [ACTIVE_RIDE]: [NONE, { status: 200, body: rideFixture() }],
      "POST /api/v1/notifications/n-2/read": { status: 204 },
    });
    await flush();

    await tap({
      notificationId: "n-2",
      category: "ride",
      event: "ride.started",
      screen: "ride",
      params: JSON.stringify({ rideId: RIDE_ID }),
    });

    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
    expect(contract.requestsTo(ACTIVE_RIDE).length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * W22 (board D12Notices): the scheduled release / rider-busy notices are
 * titled with the ride's time (and the rider's name) when known, and say
 * what the event costs. Payload fields are optional: a push that names only
 * the ride falls back to the ride read, then to a generic title.
 */
import { act, render, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import { clearSession } from "../auth/session";
import { RideNoticeBanner } from "../components/ride/ride-parts";
import { initI18n, setAppLanguage } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { scheduledNoticeDetail } from "../notifications/deep-links";
import type { MockResponse } from "../test-utils/contract";
import { MockSocket } from "../test-utils/realtime";
import { mockLocationGranted, renderDriverApp } from "../test-utils/ride-harness";
import { rideFixture, RIDE_ID } from "../test-utils/rides";

// A dev/production build (not Expo Go) so foreground pushes are delivered.
jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  isRunningInExpoGo: jest.fn(() => false),
}));

const ok = (body: unknown): MockResponse => ({ status: 200, body });
const LTR = (text: string) => `⁦${text}⁩`;

function banner(
  notice: "scheduledReleased" | "scheduledRiderBusy",
  detail: Parameters<typeof RideNoticeBanner>[0]["detail"],
  language: "en" | "ar" = "en",
) {
  render(
    <LocaleProvider initialLanguage={language}>
      <RideNoticeBanner notice={notice} detail={detail} onDismiss={() => {}} />
    </LocaleProvider>,
  );
}

describe("scheduled notices (W22)", () => {
  beforeEach(async () => {
    await initI18n();
    await setAppLanguage("en");
  });

  it("reads the time and rider from the push params, tolerating missing ones", () => {
    expect(
      scheduledNoticeDetail({
        rideId: "r-1",
        pickupDate: "2026-10-17",
        pickupTime: "09:00",
        riderName: "Omar",
      }),
    ).toEqual({
      rideId: "r-1",
      scheduledAt: null,
      pickupDate: "2026-10-17",
      pickupTime: "09:00",
      riderName: "Omar",
      liveAt: null,
    });
    expect(scheduledNoticeDetail({ rideId: "r-1" })?.pickupTime).toBeNull();
    expect(scheduledNoticeDetail(null)).toBeNull();
  });

  it("titles a release with its time and states that it counts", () => {
    banner("scheduledReleased", { pickupTime: "09:00", liveAt: "08:45" });
    expect(screen.getByText("Your 09:00 claim was released")).toBeTruthy();
    expect(
      screen.getByText(
        "It went live at 08:45 while you were unavailable, so it went to live dispatch. It counts as a release.",
      ),
    ).toBeTruthy();
  });

  it("falls back to a generic title, still with the consequence", () => {
    banner("scheduledReleased", null);
    expect(screen.getByText("Your scheduled ride claim was released")).toBeTruthy();
    expect(
      screen.getByText(
        "It went back to the board or to live dispatch. It counts as a release.",
      ),
    ).toBeTruthy();
  });

  it("names the rider and the day/time of a rider-busy cancellation", () => {
    banner("scheduledRiderBusy", {
      riderName: "Omar",
      pickupDate: "2026-10-17",
      pickupTime: "07:30",
    });
    expect(screen.getByText("Omar's Sat 07:30 ride was cancelled")).toBeTruthy();
    expect(
      screen.getByText(
        "The rider was still on another trip. Nothing counts against you.",
      ),
    ).toBeTruthy();
  });

  it("Arabic: the time sits in an LTR isolate", async () => {
    await setAppLanguage("ar");
    banner("scheduledReleased", { pickupTime: "09:00" }, "ar");
    expect(
      screen.getByText(`تم التخلي عن حجزك لرحلة الساعة ${LTR("09:00")}`),
    ).toBeTruthy();
    expect(
      screen.getByText("عادت إلى اللوحة أو إلى التوزيع الفوري. يُحتسب ذلك ضمن مرات التخلي."),
    ).toBeTruthy();
  });
});

describe("scheduled notice from a foreground push (W22)", () => {
  const originalWebSocket = globalThis.WebSocket;

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

  it("a push naming only the ride fills the title from the ride read", async () => {
    let received: ((notification: Notifications.Notification) => void) | null =
      null;
    jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mockImplementation((listener) => {
        received = listener;
        return { remove: jest.fn() } as unknown as Notifications.EventSubscription;
      });
    const scheduledAt = new Date(2026, 9, 17, 7, 30).toISOString();
    const contract = await renderDriverApp({
      [`GET /api/v1/driver/rides/${RIDE_ID}`]: ok(
        rideFixture({
          state: "cancelled_by_rider",
          kind: "scheduled",
          scheduled: {
            scheduledAt,
            claimState: "claimed",
            pricedAtRideTime: false,
          },
          rider: { firstName: "Omar", rating: null, comfort: null },
        }),
      ),
    });
    await waitFor(() => expect(received).not.toBeNull());

    await act(async () => {
      received?.({
        request: {
          content: {
            data: {
              event: "scheduled.cancelled_rider_busy",
              category: "ride",
              screen: "ride",
              params: JSON.stringify({ rideId: RIDE_ID }),
            },
          },
        },
      } as unknown as Notifications.Notification);
    });

    expect(
      await screen.findByText("Omar's Sat 07:30 ride was cancelled"),
    ).toBeTruthy();
    expect(screen.getByTestId("ride-notice-scheduledRiderBusy")).toBeTruthy();
    expect(
      contract.requestsTo(`GET /api/v1/driver/rides/${RIDE_ID}`),
    ).toHaveLength(1);
  });
});

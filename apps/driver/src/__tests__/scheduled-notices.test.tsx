/**
 * W22 (board D12Notices): the scheduled release / rider-busy notices are
 * titled with the ride's time (and the rider's name) when known, and say
 * what the event costs. Payload fields are optional: a push that names only
 * the ride falls back to the ride read, then to a generic title.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import { clearSession } from "../auth/session";
import { RideNoticeBanner } from "../components/ride/ride-parts";
import { initI18n, setAppLanguage } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import {
  scheduledNoticeDetail,
  scheduledNoticeFor,
} from "../notifications/deep-links";
import type { MockResponse } from "../test-utils/contract";
import { MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
  CLAIM_BOARD_SUMMARY,
  mockLocationGranted,
  NONE,
  renderDriverApp,
} from "../test-utils/ride-harness";
import { rideFixture, RIDE_ID } from "../test-utils/rides";
import {
  BOARD,
  boardPage,
  CLAIMS,
  claimedRide,
  inHours,
  WINDOWS_GET,
} from "../test-utils/scheduled";

// A dev/production build (not Expo Go) so foreground pushes are delivered.
jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  isRunningInExpoGo: jest.fn(() => false),
}));

const ok = (body: unknown): MockResponse => ({ status: 200, body });
const LTR = (text: string) => `⁦${text}⁩`;

function banner(
  notice: "scheduledReleased" | "scheduledClaimLost" | "scheduledRiderBusy",
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
      reason: null,
      countsAsRelease: null,
    });
    expect(scheduledNoticeDetail({ rideId: "r-1" })?.pickupTime).toBeNull();
    expect(scheduledNoticeDetail(null)).toBeNull();
  });

  it("titles a release with its time and states that it counts", () => {
    banner("scheduledReleased", {
      pickupTime: "09:00",
      liveAt: "08:45",
      countsAsRelease: true,
    });
    expect(screen.getByText("Your 09:00 claim was released")).toBeTruthy();
    expect(
      screen.getByText(
        "It went live at 08:45 while you were unavailable, so it went to live dispatch. It counts as a release.",
      ),
    ).toBeTruthy();
  });

  it("falls back to a generic title; without countsAsRelease it claims no consequence", () => {
    banner("scheduledReleased", null);
    expect(screen.getByText("Your scheduled ride claim was released")).toBeTruthy();
    expect(
      screen.getByText("It went back to the board or to live dispatch."),
    ).toBeTruthy();
  });

  it("reads the contract params: riderFirstName, pickupDate + pickupTime, reason, countsAsRelease", () => {
    expect(
      scheduledNoticeDetail({
        rideId: "r-1",
        pickupDate: "2026-10-17",
        pickupTime: "09:00",
        riderFirstName: "Rana",
        reason: "unavailable",
        countsAsRelease: "true",
      }),
    ).toEqual({
      rideId: "r-1",
      scheduledAt: null,
      pickupDate: "2026-10-17",
      pickupTime: "09:00",
      riderName: "Rana",
      liveAt: null,
      reason: "unavailable",
      countsAsRelease: true,
    });
    expect(scheduledNoticeDetail({ countsAsRelease: "false" })?.countsAsRelease).toBe(false);
    expect(scheduledNoticeDetail({ countsAsRelease: "yes" })?.countsAsRelease).toBeNull();
    expect(scheduledNoticeFor("scheduled.claim_lost")).toBe("scheduledClaimLost");
  });

  it("an 'unavailable' release counts as a release", () => {
    banner("scheduledReleased", {
      pickupTime: "09:00",
      reason: "unavailable",
      countsAsRelease: true,
    });
    expect(screen.getByText("Your 09:00 claim was released")).toBeTruthy();
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "You were offline or on another ride when it went live, so it went to live dispatch. It counts as a release.",
    );
  });

  it("a balance-floor release says why and does not count", () => {
    banner("scheduledReleased", {
      pickupTime: "09:00",
      reason: "balance_below_floor",
      countsAsRelease: false,
    });
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "Your balance is below the limit, so it went to live dispatch. Settle your balance to claim scheduled rides again. It doesn't count against you.",
    );
    expect(screen.getByTestId("ride-notice-text")).not.toHaveTextContent(
      /counts as a release/,
    );
  });

  it("a suspension release says why and does not count", () => {
    banner("scheduledReleased", {
      reason: "account_suspended",
      countsAsRelease: false,
    });
    expect(screen.getByText("Your scheduled ride claim was released")).toBeTruthy();
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "Your driver account was suspended, so it went to live dispatch. It doesn't count against you.",
    );
  });

  it("a lost claim (vehicle changed) explains it and does not count", () => {
    banner("scheduledClaimLost", {
      pickupTime: "07:30",
      reason: "vehicle_changed",
      countsAsRelease: false,
    });
    expect(screen.getByTestId("ride-notice-scheduledClaimLost")).toBeTruthy();
    expect(screen.getByText("You lost your 07:30 claim")).toBeTruthy();
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "Your active vehicle no longer offers this ride's service, so it went to live dispatch. It doesn't count against you.",
    );
  });

  it("a lost claim with no params keeps a generic title and the vehicle reason", () => {
    banner("scheduledClaimLost", null);
    expect(screen.getByText("You lost a scheduled ride claim")).toBeTruthy();
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "Your active vehicle no longer offers this ride's service, so it went to live dispatch.",
    );
  });

  it("Arabic: a balance-floor release says why and does not count", async () => {
    await setAppLanguage("ar");
    banner(
      "scheduledReleased",
      { reason: "balance_below_floor", countsAsRelease: false },
      "ar",
    );
    expect(
      screen.getByText(
        "رصيدك تحت الحد، فذهبت إلى التوزيع الفوري. سوِّ رصيدك لتعود إلى حجز الرحلات المجدولة. لا يُحتسب ذلك عليك.",
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
    banner("scheduledReleased", { pickupTime: "09:00", countsAsRelease: true }, "ar");
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

  it("a scheduled.released push with the contract params titles and explains it, no ride read", async () => {
    let received: ((notification: Notifications.Notification) => void) | null =
      null;
    jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mockImplementation((listener) => {
        received = listener;
        return { remove: jest.fn() } as unknown as Notifications.EventSubscription;
      });
    const contract = await renderDriverApp();
    await waitFor(() => expect(received).not.toBeNull());

    await act(async () => {
      received?.({
        request: {
          content: {
            data: {
              event: "scheduled.released",
              category: "scheduled",
              screen: "ride",
              params: JSON.stringify({
                rideId: RIDE_ID,
                pickupDate: "2026-10-17",
                pickupTime: "09:00",
                riderFirstName: "Rana",
                reason: "unavailable",
                countsAsRelease: "true",
              }),
            },
          },
        },
      } as unknown as Notifications.Notification);
    });

    expect(await screen.findByText("Your 09:00 claim was released")).toBeTruthy();
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "You were offline or on another ride when it went live, so it went to live dispatch. It counts as a release.",
    );
    expect(
      contract.requestsTo(`GET /api/v1/driver/rides/${RIDE_ID}`),
    ).toHaveLength(0);
  });

  it("a scheduled.converted push takes a driver on the Scheduled board to the live ride (L-W6)", async () => {
    let received: ((notification: Notifications.Notification) => void) | null =
      null;
    jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mockImplementation((listener) => {
        received = listener;
        return { remove: jest.fn() } as unknown as Notifications.EventSubscription;
      });
    const live = rideFixture({
      kind: "scheduled",
      scheduled: {
        scheduledAt: inHours(0.25),
        claimState: "converted",
        pricedAtRideTime: false,
      },
    });
    const contract = await renderDriverApp(
      {
        // No live ride until the claim converts.
        [ACTIVE_RIDE]: [NONE, ok(live)],
        [BOARD]: ok(boardPage([])),
        [CLAIMS]: ok([claimedRide()]),
        [CLAIM_BOARD_SUMMARY]: ok({ items: [], page: 0, size: 1, totalItems: 0 }),
        [WINDOWS_GET]: ok({ windows: [] }),
      },
    );
    await waitFor(() =>
      expect(contract.requestsTo(ACTIVE_RIDE).length).toBeGreaterThanOrEqual(1),
    );
    // The driver opens the Scheduled board (a stack route above home).
    fireEvent.press(await screen.findByTestId("scheduled-entry"));
    expect(await screen.findByTestId("scheduled-rides-screen")).toBeTruthy();
    await waitFor(() => expect(received).not.toBeNull());

    await act(async () => {
      received?.({
        request: {
          content: {
            data: {
              event: "scheduled.converted",
              category: "scheduled",
              screen: "ride",
              params: JSON.stringify({ rideId: RIDE_ID }),
            },
          },
        },
      } as unknown as Notifications.Notification);
    });

    // Resync picks the converted ride up, then the driver lands on it.
    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
    expect(screen.getByTestId("ride-notice-scheduledLive")).toBeTruthy();
    expect(screen.queryByTestId("scheduled-rides-screen")).toBeNull();
    expect(contract.requestsTo(ACTIVE_RIDE).length).toBeGreaterThanOrEqual(2);
  });

  it("a scheduled.claim_lost push shows the vehicle-changed notice", async () => {
    let received: ((notification: Notifications.Notification) => void) | null =
      null;
    jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mockImplementation((listener) => {
        received = listener;
        return { remove: jest.fn() } as unknown as Notifications.EventSubscription;
      });
    await renderDriverApp();
    await waitFor(() => expect(received).not.toBeNull());

    await act(async () => {
      received?.({
        request: {
          content: {
            data: {
              event: "scheduled.claim_lost",
              category: "scheduled",
              screen: "ride",
              params: JSON.stringify({
                rideId: RIDE_ID,
                pickupDate: "2026-10-17",
                pickupTime: "07:30",
                riderFirstName: "Omar",
                reason: "vehicle_changed",
                countsAsRelease: "false",
              }),
            },
          },
        },
      } as unknown as Notifications.Notification);
    });

    expect(await screen.findByTestId("ride-notice-scheduledClaimLost")).toBeTruthy();
    expect(screen.getByText("You lost your 07:30 claim")).toBeTruthy();
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "Your active vehicle no longer offers this ride's service, so it went to live dispatch. It doesn't count against you.",
    );
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
          rider: {
            firstName: "Omar",
            rating: null,
            comfort: {
              temperature: "no_preference",
              conversation: "no_preference",
              music: "no_preference",
            },
          },
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

/**
 * M10-T5 walkthrough fixes — chat pushes (comms-v1.yaml "Chat push", owner
 * ruling 2026-10-14: EVERY chat message is pushed, even while the app is
 * open):
 * - a foreground chat push shows NO banner only while that same ride's chat
 *   screen is on screen; any other screen / ride still shows it;
 * - a cold-start tap on a chat push (app not running, active ride) lands on
 *   that ride's chat, with the ride screen underneath.
 */
import * as Notifications from "expo-notifications";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
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
  CHAT_MESSAGES,
  CHAT_READ,
  CHAT_THREAD,
  chatMessageFixture,
  messagePage,
  QUICK_REPLIES_ROUTE,
  quickRepliesFixture,
  threadFixture,
} from "../test-utils/comms";
import { RIDE_ID, rideFixture } from "../test-utils/rides";
import type { MockResponse } from "../test-utils/contract";

jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  isRunningInExpoGo: jest.fn(() => false),
}));

const notificationsMock = Notifications as jest.Mocked<typeof Notifications>;
const originalWebSocket = globalThis.WebSocket;
const ok = (body: unknown): MockResponse => ({ status: 200, body });
const RIDER_MSG = chatMessageFixture();
const OTHER_RIDE_ID = "99999999-0000-4000-8000-000000000009";

function chatRoutes(): Record<string, MockResponse | MockResponse[]> {
  return {
    [ACTIVE_RIDE]: ok(rideFixture()),
    [QUICK_REPLIES_ROUTE]: ok(quickRepliesFixture()),
    [CHAT_THREAD]: ok(threadFixture({ unreadCount: 1 })),
    [CHAT_MESSAGES]: ok(messagePage([RIDER_MSG])),
    [CHAT_READ]: { status: 204 },
    "POST /api/v1/notifications/n-chat/read": { status: 204 },
  };
}

/** The push data the backend sends for a chat message. */
function chatPushData(rideId = RIDE_ID): Record<string, unknown> {
  return {
    notificationId: "n-chat",
    category: "chat",
    event: "chat.message",
    screen: "chat",
    params: JSON.stringify({ rideId }),
  };
}

function notification(
  data: Record<string, unknown>,
  trigger: unknown = null,
): Notifications.Notification {
  return {
    date: 0,
    request: {
      identifier: "push-chat",
      content: { title: "Rana", body: "I'm here", data },
      trigger,
    },
  } as unknown as Notifications.Notification;
}

/** What the foreground handler decides for a push with this data. */
async function presentation(data: Record<string, unknown>) {
  const calls = notificationsMock.setNotificationHandler.mock.calls;
  const handler = calls[calls.length - 1]?.[0];
  if (!handler) throw new Error("no notification handler configured");
  return handler.handleNotification(notification(data));
}

async function flush() {
  await act(async () => {});
  await act(async () => {});
}

describe("chat pushes (owner ruling 2026-10-14)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue(null);
    // Push permission settled (denied), so the shared permission queue is
    // free for the location prompt going live needs.
    notificationsMock.getPermissionsAsync.mockResolvedValue({
      status: "denied",
      granted: false,
      canAskAgain: false,
    } as Notifications.NotificationPermissionsStatus);
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
    mockLocationGranted();
    // The handler only runs for a foregrounded app.
    Object.defineProperty(AppState, "currentState", {
      value: "active",
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("hides the foreground banner only while that ride's chat is on screen", async () => {
    const contract = await renderDriverApp(chatRoutes(), { chat: true });
    await goLive();
    await waitForResync(contract);
    await waitFor(() => expect(screen.getByTestId("safety-chat")).toBeTruthy());

    // On the ride screen the banner is useful while driving.
    expect(await presentation(chatPushData())).toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
    });

    fireEvent.press(screen.getByTestId("safety-chat"));
    await waitFor(() => expect(screen.getByTestId("chat-screen")).toBeTruthy());

    // Same ride's chat open: no banner, no list entry, no sound.
    expect(await presentation(chatPushData())).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
    // Backgrounded with the chat still mounted: the OS shows it as usual.
    Object.defineProperty(AppState, "currentState", {
      value: "background",
      configurable: true,
    });
    expect(await presentation(chatPushData())).toMatchObject({
      shouldShowBanner: true,
    });
    Object.defineProperty(AppState, "currentState", {
      value: "active",
      configurable: true,
    });
    // Another ride's chat push, or any non-chat push, still shows.
    expect(await presentation(chatPushData(OTHER_RIDE_ID))).toMatchObject({
      shouldShowBanner: true,
    });
    expect(
      await presentation({
        category: "ride",
        event: "ride.started",
        screen: "ride",
        params: JSON.stringify({ rideId: RIDE_ID }),
      }),
    ).toMatchObject({ shouldShowBanner: true });

    // Leaving the chat clears the registry: the banner is back.
    fireEvent.press(screen.getByTestId("chat-back"));
    await waitFor(() => expect(screen.queryByTestId("chat-screen")).toBeNull());
    await flush();
    expect(await presentation(chatPushData())).toMatchObject({
      shouldShowBanner: true,
    });
  });

  it("cold start: a tapped chat push opens that ride's chat over the ride screen", async () => {
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue({
      actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
      notification: notification(chatPushData()),
    } as unknown as Notifications.NotificationResponse);

    const contract = await renderDriverApp(chatRoutes(), { chat: true });

    expect(await screen.findByTestId("chat-screen")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByTestId(`chat-message-${RIDER_MSG.messageId}`),
      ).toBeTruthy(),
    );
    expect(
      contract.requestsTo("POST /api/v1/notifications/n-chat/read"),
    ).toHaveLength(1);
    expect(notificationsMock.clearLastNotificationResponseAsync).toHaveBeenCalled();

    // The active-ride resync does not pull the driver off the chat.
    await goLive();
    await waitForResync(contract);
    expect(screen.getByTestId("chat-screen")).toBeTruthy();

    // The ride screen is underneath.
    fireEvent.press(screen.getByTestId("chat-back"));
    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
  });

  it("cold start: reads the data off the FCM trigger when the content carries none", async () => {
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue({
      actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
      notification: notification(
        {},
        { type: "push", remoteMessage: { data: chatPushData() } },
      ),
    } as unknown as Notifications.NotificationResponse);

    await renderDriverApp(chatRoutes(), { chat: true });

    expect(await screen.findByTestId("chat-screen")).toBeTruthy();
  });
});

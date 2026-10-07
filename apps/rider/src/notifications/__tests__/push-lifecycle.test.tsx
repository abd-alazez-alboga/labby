/**
 * Push lifecycle (ES-03, realtime-v1.yaml `Devices`): register the native
 * FCM token after sign-in, follow token rotation, unregister on logout,
 * degrade silently where push is unsupported (Expo Go) — and open the right
 * screen when a push is tapped (UC-S-11 deep links).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { AppState, type AppStateStatus } from "react-native";

import { emitSessionExpired } from "../../auth/session-store";
import SettingsScreen from "../../screens/settings-screen";
import { mockApi, seedSignedInSession } from "../../test-utils/mock-api";
import { renderWithProviders } from "../../test-utils/render";
import {
  NotificationsProvider,
  resetHandledNotificationResponses,
} from "../notifications-context";
import { PUSH_TOKEN_KEY } from "../push-registration";
import { isRemotePushSupported } from "../push-support";

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("../push-support", () => ({
  isRemotePushSupported: jest.fn(() => true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const notificationsMock = Notifications as jest.Mocked<typeof Notifications>;
const supportMock = isRemotePushSupported as jest.Mock;

const DEVICES = "/api/v1/devices";
const UNREAD = "GET /api/v1/notifications/unread-count";

function grantPush(token = "fcm-token-1") {
  notificationsMock.getPermissionsAsync.mockResolvedValue({
    granted: true,
    canAskAgain: true,
  } as unknown as Notifications.NotificationPermissionsStatus);
  notificationsMock.getDevicePushTokenAsync.mockResolvedValue({
    type: "ios",
    data: token,
  });
}

function renderSignedIn() {
  return renderWithProviders(
    <NotificationsProvider>
      <SettingsScreen />
    </NotificationsProvider>,
  );
}

/**
 * Captures every AppState listener so a test can background/foreground the
 * app. Swapped in by assignment (not `jest.spyOn`): the preset's AppState
 * method may already be a mock, which `mockRestore` would strip.
 */
function captureAppState() {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  const original = AppState.addEventListener;
  AppState.addEventListener = ((
    _type: string,
    listener: (state: AppStateStatus) => void,
  ) => {
    listeners.push(listener);
    return { remove: () => {} };
  }) as unknown as typeof AppState.addEventListener;
  return {
    restore() {
      AppState.addEventListener = original;
    },
    async reenterForeground() {
      await act(async () => {
        listeners.forEach((listener) => listener("background"));
      });
      await act(async () => {
        listeners.forEach((listener) => listener("active"));
      });
    },
  };
}

function tapResponse(identifier: string, data: Record<string, unknown>) {
  return {
    actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
    notification: {
      date: 0,
      request: { identifier, content: { data }, trigger: null },
    },
  } as unknown as Notifications.NotificationResponse;
}

describe("push registration lifecycle", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    resetHandledNotificationResponses();
    supportMock.mockReturnValue(true);
    notificationsMock.getPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    } as unknown as Notifications.NotificationPermissionsStatus);
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue(null);
    await seedSignedInSession();
  });

  it("registers the native FCM token for the rider app after sign-in", async () => {
    grantPush();
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [`PUT ${DEVICES}`]: { status: 204 },
    });

    await renderSignedIn();

    await waitFor(() => expect(api.callsTo("PUT", DEVICES)).toHaveLength(1));
    expect(api.callsTo("PUT", DEVICES)[0].body).toEqual({
      token: "fcm-token-1",
      platform: "ios",
      app: "rider",
    });
    expect(api.callsTo("PUT", DEVICES)[0].headers.Authorization).toBe(
      "Bearer seed-access",
    );
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBe("fcm-token-1"),
    );
  });

  it("asks for the permission first and registers nothing when it is refused", async () => {
    notificationsMock.getPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    } as unknown as Notifications.NotificationPermissionsStatus);
    notificationsMock.requestPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    } as unknown as Notifications.NotificationPermissionsStatus);
    const api = mockApi({ [UNREAD]: { status: 200, body: { unread: 0 } } });

    await renderSignedIn();

    await waitFor(() =>
      expect(notificationsMock.requestPermissionsAsync).toHaveBeenCalled(),
    );
    expect(notificationsMock.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(api.callsTo("PUT", DEVICES)).toHaveLength(0);
  });

  it('treats Android 13+ "denied" before ever asking (canAskAgain: true) as not yet asked', async () => {
    notificationsMock.getPermissionsAsync.mockResolvedValue({
      status: "denied",
      granted: false,
      canAskAgain: true,
    } as unknown as Notifications.NotificationPermissionsStatus);
    notificationsMock.requestPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    } as unknown as Notifications.NotificationPermissionsStatus);
    notificationsMock.getDevicePushTokenAsync.mockResolvedValue({
      type: "ios",
      data: "fcm-a13",
    });
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [`PUT ${DEVICES}`]: { status: 204 },
    });

    await renderSignedIn();

    await waitFor(() => expect(api.callsTo("PUT", DEVICES)).toHaveLength(1));
    expect(notificationsMock.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("registers on foreground re-entry once the permission was granted in Settings, without prompting again", async () => {
    const appState = captureAppState();
    try {
      // Sign-in prompt dismissed: still askable, nothing registered.
      notificationsMock.getPermissionsAsync.mockResolvedValue({
        granted: false,
        canAskAgain: true,
      } as unknown as Notifications.NotificationPermissionsStatus);
      notificationsMock.requestPermissionsAsync.mockResolvedValue({
        granted: false,
        canAskAgain: true,
      } as unknown as Notifications.NotificationPermissionsStatus);
      const api = mockApi({
        [UNREAD]: { status: 200, body: { unread: 0 } },
        [`PUT ${DEVICES}`]: { status: 204 },
      });

      await renderSignedIn();
      await waitFor(() =>
        expect(notificationsMock.requestPermissionsAsync).toHaveBeenCalledTimes(
          1,
        ),
      );
      expect(api.callsTo("PUT", DEVICES)).toHaveLength(0);

      // The rider enables notifications in Settings and comes back.
      grantPush("fcm-later");
      await appState.reenterForeground();

      await waitFor(() => expect(api.callsTo("PUT", DEVICES)).toHaveLength(1));
      expect(api.callsTo("PUT", DEVICES)[0].body).toEqual({
        token: "fcm-later",
        platform: "ios",
        app: "rider",
      });
      expect(notificationsMock.requestPermissionsAsync).toHaveBeenCalledTimes(
        1,
      );

      // Registered: later foregrounds do not register again.
      await appState.reenterForeground();
      await act(async () => {});
      expect(api.callsTo("PUT", DEVICES)).toHaveLength(1);
    } finally {
      appState.restore();
    }
  });

  it("never prompts on foreground re-entry while the permission is still askable (no dialog loop)", async () => {
    const appState = captureAppState();
    try {
      notificationsMock.getPermissionsAsync.mockResolvedValue({
        status: "denied",
        granted: false,
        canAskAgain: true,
      } as unknown as Notifications.NotificationPermissionsStatus);
      notificationsMock.requestPermissionsAsync.mockResolvedValue({
        granted: false,
        canAskAgain: true,
      } as unknown as Notifications.NotificationPermissionsStatus);
      const api = mockApi({ [UNREAD]: { status: 200, body: { unread: 0 } } });

      await renderSignedIn();
      await waitFor(() =>
        expect(notificationsMock.requestPermissionsAsync).toHaveBeenCalledTimes(
          1,
        ),
      );
      const readsAfterSignIn =
        notificationsMock.getPermissionsAsync.mock.calls.length;

      await appState.reenterForeground();
      await appState.reenterForeground();

      // Each foreground re-checks the permission, but never shows the dialog.
      await waitFor(() =>
        expect(
          notificationsMock.getPermissionsAsync.mock.calls.length,
        ).toBeGreaterThanOrEqual(readsAfterSignIn + 2),
      );
      expect(notificationsMock.requestPermissionsAsync).toHaveBeenCalledTimes(
        1,
      );
      expect(notificationsMock.getDevicePushTokenAsync).not.toHaveBeenCalled();
      expect(api.callsTo("PUT", DEVICES)).toHaveLength(0);
    } finally {
      appState.restore();
    }
  });

  it("skips push entirely where it is unsupported (Expo Go) without breaking the app", async () => {
    supportMock.mockReturnValue(false);
    grantPush();
    const api = mockApi({ [UNREAD]: { status: 200, body: { unread: 0 } } });

    await renderSignedIn();
    await waitFor(() =>
      expect(
        api.callsTo("GET", "/api/v1/notifications/unread-count"),
      ).toHaveLength(1),
    );

    expect(notificationsMock.getPermissionsAsync).not.toHaveBeenCalled();
    expect(notificationsMock.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(notificationsMock.addPushTokenListener).not.toHaveBeenCalled();
    expect(api.callsTo("PUT", DEVICES)).toHaveLength(0);
    expect(screen.getByTestId("settings-screen")).toBeOnTheScreen();
  });

  it("re-registers when FCM rotates the token", async () => {
    grantPush();
    let rotate: ((token: Notifications.DevicePushToken) => void) | null = null;
    notificationsMock.addPushTokenListener.mockImplementation((listener) => {
      rotate = listener;
      return { remove: jest.fn() } as unknown as ReturnType<
        typeof Notifications.addPushTokenListener
      >;
    });
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [`PUT ${DEVICES}`]: { status: 204 },
    });

    await renderSignedIn();
    await waitFor(() => expect(api.callsTo("PUT", DEVICES)).toHaveLength(1));

    await act(async () => {
      rotate?.({ type: "ios", data: "fcm-token-2" });
    });

    await waitFor(() => expect(api.callsTo("PUT", DEVICES)).toHaveLength(2));
    expect(api.callsTo("PUT", DEVICES)[1].body).toEqual({
      token: "fcm-token-2",
      platform: "ios",
      app: "rider",
    });
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBe("fcm-token-2"),
    );
  });

  it("does not remember a token the backend refused", async () => {
    grantPush();
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [`PUT ${DEVICES}`]: { status: 500, body: { status: 500 } },
    });

    await renderSignedIn();

    await waitFor(() => expect(api.callsTo("PUT", DEVICES)).toHaveLength(1));
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });

  it("unregisters the token on logout before revoking the session", async () => {
    grantPush();
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [`PUT ${DEVICES}`]: { status: 204 },
      [`DELETE ${DEVICES}/fcm-token-1`]: { status: 204 },
      "POST /api/v1/auth/logout": { status: 204 },
    });

    await renderSignedIn();
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBe("fcm-token-1"),
    );

    await fireEvent.press(screen.getByTestId("settings-logout"));

    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "signedOut:manual",
      ),
    );
    const order = api.calls.map((call) => `${call.method} ${call.path}`);
    expect(order.indexOf(`DELETE ${DEVICES}/fcm-token-1`)).toBeGreaterThan(-1);
    expect(order.indexOf(`DELETE ${DEVICES}/fcm-token-1`)).toBeLessThan(
      order.indexOf("POST /api/v1/auth/logout"),
    );
    expect(
      api.callsTo("DELETE", `${DEVICES}/fcm-token-1`)[0].headers.Authorization,
    ).toBe("Bearer seed-access");
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });

  it("forgets the token locally when the session expires (no API call possible)", async () => {
    grantPush();
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [`PUT ${DEVICES}`]: { status: 204 },
    });

    await renderSignedIn();
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBe("fcm-token-1"),
    );

    await act(async () => {
      emitSessionExpired();
    });

    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "signedOut:expired",
      ),
    );
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
    expect(api.calls.filter((call) => call.method === "DELETE")).toHaveLength(
      0,
    );
  });
});

describe("push taps → deep links", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    resetHandledNotificationResponses();
    supportMock.mockReturnValue(false);
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue(null);
    await seedSignedInSession();
  });

  it("opens the mapped screen and marks the notification read when a push is tapped", async () => {
    let onTap: ((response: Notifications.NotificationResponse) => void) | null =
      null;
    notificationsMock.addNotificationResponseReceivedListener.mockImplementation(
      (listener) => {
        onTap = listener;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof Notifications.addNotificationResponseReceivedListener
        >;
      },
    );
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 1 } },
      "POST /api/v1/notifications/n-7/read": { status: 204 },
    });

    await renderSignedIn();
    await waitFor(() => expect(onTap).not.toBeNull());

    await act(async () => {
      onTap?.(
        tapResponse("push-1", {
          notificationId: "n-7",
          link: JSON.stringify({ screen: "ride", params: { rideId: "r-1" } }),
        }),
      );
    });

    // `ride` has no rider screen before M7 → the center (placeholder-safe).
    expect(mockPush).toHaveBeenCalledWith("/notifications");
    await waitFor(() =>
      expect(
        api.callsTo("POST", "/api/v1/notifications/n-7/read"),
      ).toHaveLength(1),
    );

    // The same tap delivered twice (listener + cold-start overlap) opens once.
    await act(async () => {
      onTap?.(tapResponse("push-1", { notificationId: "n-7" }));
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("handles the tap that cold-started the app", async () => {
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue(
      tapResponse("push-cold", { screen: "some_future_screen" }),
    );
    mockApi({ [UNREAD]: { status: 200, body: { unread: 0 } } });

    await renderSignedIn();

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/notifications"),
    );
  });

  it("refreshes the badge when a push arrives while the app is open", async () => {
    let onReceive: (() => void) | null = null;
    notificationsMock.addNotificationReceivedListener.mockImplementation(
      (listener) => {
        onReceive = listener as () => void;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof Notifications.addNotificationReceivedListener
        >;
      },
    );
    const api = mockApi({
      [UNREAD]: [
        { status: 200, body: { unread: 0 } },
        { status: 200, body: { unread: 1 } },
      ],
    });

    await renderSignedIn();
    await waitFor(() =>
      expect(
        api.callsTo("GET", "/api/v1/notifications/unread-count"),
      ).toHaveLength(1),
    );

    await act(async () => {
      onReceive?.();
    });

    await waitFor(() =>
      expect(
        api.callsTo("GET", "/api/v1/notifications/unread-count"),
      ).toHaveLength(2),
    );
    expect(
      await screen.findByTestId("settings-notifications-badge"),
    ).toHaveTextContent("1");
  });
});

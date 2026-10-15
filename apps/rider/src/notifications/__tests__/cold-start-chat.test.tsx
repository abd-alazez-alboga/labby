/**
 * Cold start from a chat push (M10-T5 walkthrough bug): with the app not
 * running, tapping a chat push must land on that ride's chat — over home
 * (which, with an active ride, is the ride view) so Back returns to it.
 * Runs the real signed-in layout and routes on the real router.
 */
import * as Notifications from "expo-notifications";
import { Stack } from "expo-router";
import { renderRouter, screen, waitFor } from "expo-router/testing-library";
import React from "react";

import AppLayout from "../../app/(app)/_layout";
import ChatRoute from "../../app/(app)/chat/[rideId]";
import HomeRoute from "../../app/(app)/index";
import { AuthProvider } from "../../auth/auth-context";
import { LocaleProvider } from "../../i18n/locale-context";
import {
  chatThread,
  messagePage,
  quickReplies,
} from "../../test-utils/comms-fixtures";
import { mockApi, seedSignedInSession } from "../../test-utils/mock-api";
import { acceptedRide, RIDE_ID } from "../../test-utils/ride-fixtures";
import { resetHandledNotificationResponses } from "../notifications-context";

jest.mock("../push-support", () => ({
  isRemotePushSupported: jest.fn(() => true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const notificationsMock = Notifications as jest.Mocked<typeof Notifications>;

function RootLayout() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </LocaleProvider>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  resetHandledNotificationResponses();
  await seedSignedInSession();
});

it("lands a cold-start chat tap on /chat/<rideId> with home underneath", async () => {
  mockApi({
    "GET /api/v1/notifications/unread-count": { status: 200, body: { unread: 1 } },
    "POST /api/v1/notifications/n-1/read": { status: 204 },
    "GET /api/v1/rides/active": { status: 200, body: acceptedRide() },
    [`GET /api/v1/rides/${RIDE_ID}/chat`]: { status: 200, body: chatThread() },
    [`GET /api/v1/rides/${RIDE_ID}/chat/messages`]: {
      status: 200,
      body: messagePage([]),
    },
    [`POST /api/v1/rides/${RIDE_ID}/chat/read`]: { status: 204 },
    "GET /api/v1/chat/quick-replies": { status: 200, body: quickReplies },
  });
  notificationsMock.getLastNotificationResponseAsync.mockResolvedValue({
    actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
    notification: {
      date: 0,
      request: {
        identifier: "cold-chat",
        content: {
          data: {
            notificationId: "n-1",
            category: "chat",
            event: "chat.message",
            screen: "chat",
            params: JSON.stringify({ rideId: RIDE_ID }),
          },
        },
        trigger: null,
      },
    },
  } as unknown as Notifications.NotificationResponse);

  const view = renderRouter(
    {
      _layout: RootLayout,
      "(app)/_layout": AppLayout,
      "(app)/index": HomeRoute,
      "(app)/chat/[rideId]": ChatRoute,
    },
    { initialUrl: "/" },
  );

  await waitFor(() => expect(screen.getByTestId("chat-screen")).toBeTruthy());
  expect(view.getPathname()).toBe(`/chat/${RIDE_ID}`);
  // Home (the ride view) sits underneath: Back returns to it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { router } = require("expo-router") as typeof import("expo-router");
  expect(router.canGoBack()).toBe(true);
});

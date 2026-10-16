import * as Location from "expo-location";
import { renderRouter, screen } from "expo-router/testing-library";
import { act, waitFor } from "@testing-library/react-native";
import React from "react";
import { View } from "react-native";

import { AuthProvider } from "../auth/AuthProvider";
import { ChatProvider } from "../chat/ChatProvider";
import ScheduledRidesRoute from "../app/scheduled-rides";
import { ChatScreen } from "../components/chat/chat-screen";
import { SharedChatsScreen } from "../components/chat/shared-chats-screen";
import { AvailabilityScreen } from "../components/scheduled/availability-screen";
import { HomeScreen } from "../components/home-screen";
import { NotificationCenterScreen } from "../components/notifications/notification-center-screen";
import { HeatmapProvider } from "../heatmap/HeatmapProvider";
import { RegionProvider } from "../region/RegionProvider";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { DriverMoneyProvider } from "../money/DriverMoneyProvider";
import { PushBridge } from "../notifications/PushBridge";
import { AvailabilityProvider } from "../realtime/AvailabilityProvider";
import { DriverRideProvider } from "../rides/DriverRideProvider";
import { driverUser, installContractFetch, seedSession } from "./contract";
import type { ContractFetch, MockResponse } from "./contract";
import { availabilityFixture, MockSocket } from "./realtime";

/**
 * The driver app's ride loop under test: the real providers (auth,
 * availability + its socket, the ride facade, push bridge) around the real
 * home route, the API mocked at the fetch boundary (contract-shaped) and the
 * socket scripted frame by frame (MockSocket).
 */

export const OPEN_OFFER = "GET /api/v1/driver/offers/open";
export const ACTIVE_RIDE = "GET /api/v1/driver/rides/active";
export const AVAILABILITY = "GET /api/v1/driver/availability";
export const SET_AVAILABILITY = "PUT /api/v1/driver/availability";
export const HEATMAP = "GET /api/v1/driver/heatmap";
/** M12: the home sheet's "Scheduled rides" row reads both on focus. */
export const CLAIMED_RIDES = "GET /api/v1/driver/scheduled-rides";
export const CLAIM_BOARD_SUMMARY = "GET /api/v1/driver/claim-board?page=0&size=1";

export const NONE: MockResponse = { status: 204 };

type WatchCallback = (position: Location.LocationObject) => void;
const locationMock = Location as jest.Mocked<typeof Location>;
/** Every position watch (streamer + optional region watch) gets each fix. */
let watchCallbacks: WatchCallback[] = [];

export function mockLocationGranted(position = { lat: 33.5, lng: 36.28 }) {
  watchCallbacks = [];
  locationMock.requestForegroundPermissionsAsync.mockResolvedValue({
    granted: true,
    status: "granted" as Location.PermissionStatus,
    canAskAgain: true,
    expires: "never",
  });
  locationMock.getForegroundPermissionsAsync.mockResolvedValue({
    granted: true,
    status: "granted" as Location.PermissionStatus,
    canAskAgain: true,
    expires: "never",
  });
  // Region resolution (opt-in RegionProvider) reads one fix at boot.
  locationMock.getCurrentPositionAsync.mockResolvedValue({
    coords: {
      latitude: position.lat,
      longitude: position.lng,
      altitude: null,
      accuracy: 5,
      altitudeAccuracy: null,
      heading: 0,
      speed: 0,
    },
    timestamp: Date.now(),
  } as Location.LocationObject);
  locationMock.watchPositionAsync.mockImplementation(
    async (_options, callback) => {
      watchCallbacks.push(callback as WatchCallback);
      return { remove: jest.fn() } as unknown as Location.LocationSubscription;
    },
  );
}

export function emitPosition(lat: number, lng: number) {
  act(() => {
    for (const callback of [...watchCallbacks]) {
      callback({
        coords: {
          latitude: lat,
          longitude: lng,
          altitude: null,
          accuracy: 5,
          altitudeAccuracy: null,
          heading: 0,
          speed: 0,
        },
        timestamp: Date.now(),
      });
    }
  });
}

export function baseRoutes(): Record<string, MockResponse | MockResponse[]> {
  return {
    "GET /api/v1/meta": {
      status: 200,
      body: { name: "labby-backend", version: "0.1.0" },
    },
    "GET /api/v1/notifications/unread-count?app=driver": {
      status: 200,
      body: { unread: 0 },
    },
    [AVAILABILITY]: {
      status: 200,
      body: availabilityFixture({
        online: true,
        onlineSince: "2026-10-08T08:00:00Z",
      }),
    },
    [OPEN_OFFER]: NONE,
    [ACTIVE_RIDE]: NONE,
    [CLAIMED_RIDES]: { status: 200, body: [] },
    [CLAIM_BOARD_SUMMARY]: {
      status: 200,
      body: { items: [], page: 0, size: 1, totalItems: 0 },
    },
  };
}

function Layout({
  language,
  money,
  heatmap,
  chat,
  region,
}: {
  language: "en" | "ar";
  money: boolean;
  heatmap: boolean;
  chat: boolean;
  region: boolean;
}) {
  const { Slot } = jest.requireActual("expo-router");
  const slot = <Slot />;
  const withHeatmap = heatmap ? <HeatmapProvider>{slot}</HeatmapProvider> : slot;
  const app = (
    <DriverRideProvider>
      {/* M10: opt-in — the provider fetches /chat/quick-replies + the thread. */}
      {chat ? (
        <ChatProvider>
          {withHeatmap}
          <PushBridge />
        </ChatProvider>
      ) : (
        <>
          {withHeatmap}
          <PushBridge />
        </>
      )}
    </DriverRideProvider>
  );
  const withMoney = money ? <DriverMoneyProvider>{app}</DriverMoneyProvider> : app;
  return (
    <LocaleProvider initialLanguage={language}>
      <AuthProvider>
        {/* M4: opt-in — the provider resolves GET /regions/resolve from GPS. */}
        {region ? (
          <RegionProvider>
            <AvailabilityProvider>{withMoney}</AvailabilityProvider>
          </RegionProvider>
        ) : (
          <AvailabilityProvider>{withMoney}</AvailabilityProvider>
        )}
      </AuthProvider>
    </LocaleProvider>
  );
}

/** Signs a driver in, mocks the contract and renders the app on the home route. */
export async function renderDriverApp(
  routes: Record<string, MockResponse | MockResponse[]> = {},
  options: {
    language?: "en" | "ar";
    initialUrl?: string;
    /** Mounts the DriverMoneyProvider (M8) — mock GET /driver/balance. */
    money?: boolean;
    /** Mounts the HeatmapProvider (M9) — mock GET /driver/heatmap. */
    heatmap?: boolean;
    /** Mounts the ChatProvider (M10) — mock GET /chat/quick-replies (+ thread). */
    chat?: boolean;
    /** Mounts the RegionProvider (M4) — mock GET /regions/resolve + GPS. */
    region?: boolean;
  } = {},
): Promise<ContractFetch> {
  await seedSession(driverUser());
  const contract = installContractFetch({ ...baseRoutes(), ...routes });
  const language = options.language ?? "en";
  renderRouter(
    {
      _layout: () => (
        <Layout
          language={language}
          money={!!options.money}
          heatmap={!!options.heatmap}
          chat={!!options.chat}
          region={!!options.region}
        />
      ),
      index: () => <HomeScreen />,
      chat: () => <ChatScreen />,
      // M12: the scheduled-ride screens and the per-member chat list.
      "scheduled-rides": () => <ScheduledRidesRoute />,
      "availability-windows": () => <AvailabilityScreen />,
      "shared-chats": () => <SharedChatsScreen />,
      notifications: () => <NotificationCenterScreen />,
      settings: () => <View testID="settings-route" />,
      earnings: () => <View testID="earnings-route" />,
      balance: () => <View testID="balance-route" />,
    },
    { initialUrl: options.initialUrl ?? "/" },
  );
  return contract;
}

/** Online driver: the socket opens, GPS reports, `ready` arrives → resync. */
export async function goLive(position = { lat: 33.49, lng: 36.27 }) {
  await waitFor(() => expect(MockSocket.instances.length).toBeGreaterThan(0));
  const socket = MockSocket.latest();
  act(() => socket.open());
  await waitFor(() => expect(watchCallbacks.length).toBeGreaterThan(0));
  emitPosition(position.lat, position.lng);
  act(() => socket.ready());
  return socket;
}

/** Delivers a server frame on the socket. */
export function receive(socket: MockSocket, frame: unknown) {
  act(() => socket.receive(frame));
}

/** Waits until the facade's resync after `ready` has hit both endpoints. */
export async function waitForResync(contract: ContractFetch, times = 1) {
  await waitFor(() => {
    expect(contract.requestsTo(OPEN_OFFER).length).toBeGreaterThanOrEqual(
      times,
    );
    expect(contract.requestsTo(ACTIVE_RIDE).length).toBeGreaterThanOrEqual(
      times,
    );
  });
  await act(async () => {});
}

export { screen };

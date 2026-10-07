/**
 * M6-T4 rider home: the map with the rider's own position and every
 * location state (granted, denied, no fix), plus the notification-center
 * entry with its unread badge.
 */
import * as Location from "expo-location";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { Linking } from "react-native";

import { LocaleProvider } from "../../i18n/locale-context";
import { NotificationsProvider } from "../../notifications/notifications-context";
import { mockApi, seedSignedInSession } from "../../test-utils/mock-api";
import HomeScreen from "../home-screen";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webviewMock = require("react-native-webview") as {
  __injectJavaScript: jest.Mock;
};
const locationMock = Location as jest.Mocked<typeof Location>;

type WatchCallback = (position: {
  coords: { latitude: number; longitude: number };
}) => void;
let watchCallbacks: WatchCallback[] = [];

function mockLocation({
  granted,
  at,
  fixFails = false,
}: {
  granted: boolean;
  at?: { lat: number; lng: number };
  fixFails?: boolean;
}) {
  locationMock.requestForegroundPermissionsAsync.mockResolvedValue({
    granted,
    status: (granted ? "granted" : "denied") as Location.PermissionStatus,
    canAskAgain: true,
    expires: "never",
  });
  locationMock.getForegroundPermissionsAsync.mockResolvedValue({
    granted,
    status: (granted ? "granted" : "denied") as Location.PermissionStatus,
    canAskAgain: true,
    expires: "never",
  });
  if (fixFails) {
    locationMock.getCurrentPositionAsync.mockRejectedValue(
      new Error("Location unavailable"),
    );
  } else if (at) {
    locationMock.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: at.lat, longitude: at.lng },
    } as Location.LocationObject);
  }
  locationMock.watchPositionAsync.mockImplementation(
    async (_options, callback) => {
      watchCallbacks.push(callback as WatchCallback);
      return { remove: jest.fn() } as unknown as Location.LocationSubscription;
    },
  );
}

function renderHome({ withNotifications = false } = {}) {
  return render(
    <LocaleProvider>
      {withNotifications ? (
        <NotificationsProvider>
          <HomeScreen />
        </NotificationsProvider>
      ) : (
        <HomeScreen />
      )}
    </LocaleProvider>,
  );
}

describe("home map (M6-T4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    watchCallbacks = [];
  });

  it("shows the rider on the map once the location is granted", async () => {
    mockLocation({ granted: true, at: { lat: 33.5138, lng: 36.2765 } });
    mockApi({});

    await renderHome();

    const webView = await screen.findByTestId("home-map-webview");
    const html = webView.props.source.html as string;
    expect(html).toContain('"center":[33.5138,36.2765]');
    expect(html).toContain(
      '"markers":[{"id":"self","latlng":[33.5138,36.2765],"kind":"self"}]',
    );
    expect(html).toContain('"followMe":true');
    expect(screen.getByTestId("home-map-attribution")).toHaveTextContent(
      "© OpenStreetMap contributors",
    );
  });

  it("follows the rider as the position updates", async () => {
    mockLocation({ granted: true, at: { lat: 33.5138, lng: 36.2765 } });
    mockApi({});

    await renderHome();
    await screen.findByTestId("home-map-webview");
    await act(async () => {
      fireEvent(screen.getByTestId("home-map-webview"), "message", {
        nativeEvent: { data: '{"type":"ready"}' },
      });
    });
    webviewMock.__injectJavaScript.mockClear();

    await waitFor(() => expect(watchCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      for (const callback of watchCallbacks) {
        callback({ coords: { latitude: 33.52, longitude: 36.29 } });
      }
    });

    expect(webviewMock.__injectJavaScript).toHaveBeenCalled();
    const script = webviewMock.__injectJavaScript.mock.calls.at(
      -1,
    )?.[0] as string;
    expect(script).toContain('"center":[33.52,36.29]');
    expect(script).toContain('"latlng":[33.52,36.29]');
  });

  it("explains a denied location permission with retry and open-settings", async () => {
    mockLocation({ granted: false });
    mockApi({});
    const openSettings = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue();

    await renderHome();

    expect(
      await screen.findByTestId("map-permission-denied"),
    ).toBeOnTheScreen();
    expect(screen.getByText("Location is off")).toBeOnTheScreen();
    expect(screen.queryByTestId("home-map")).toBeNull();

    await fireEvent.press(screen.getByTestId("map-open-settings"));
    expect(openSettings).toHaveBeenCalled();

    // Granted in the meantime → retry shows the map.
    mockLocation({ granted: true, at: { lat: 33.5, lng: 36.3 } });
    await fireEvent.press(screen.getByTestId("map-retry"));
    expect(await screen.findByTestId("home-map-webview")).toBeOnTheScreen();
  });

  it('shows an honest "no location" state when the GPS fix fails', async () => {
    mockLocation({ granted: true, fixFails: true });
    mockApi({});

    await renderHome();

    expect(await screen.findByTestId("map-unavailable")).toBeOnTheScreen();
    expect(screen.getByText("Couldn't find your location")).toBeOnTheScreen();
    expect(screen.getByTestId("map-retry")).toBeOnTheScreen();
  });

  it("shows the unread badge on the notifications entry and opens the center", async () => {
    await seedSignedInSession();
    mockLocation({ granted: false });
    const api = mockApi({
      "GET /api/v1/notifications/unread-count": {
        status: 200,
        body: { unread: 3 },
      },
    });

    await renderHome({ withNotifications: true });

    expect(await screen.findByTestId("home-unread-badge")).toHaveTextContent(
      "3",
    );
    expect(
      api.callsTo("GET", "/api/v1/notifications/unread-count")[0].query,
    ).toEqual({
      app: "rider",
    });
    await fireEvent.press(screen.getByTestId("home-notifications"));
    expect(mockPush).toHaveBeenCalledWith("/notifications");
  });

  it("hides the badge when nothing is unread", async () => {
    await seedSignedInSession();
    mockLocation({ granted: false });
    const api = mockApi({
      "GET /api/v1/notifications/unread-count": {
        status: 200,
        body: { unread: 0 },
      },
    });

    await renderHome({ withNotifications: true });

    await waitFor(() =>
      expect(
        api.callsTo("GET", "/api/v1/notifications/unread-count"),
      ).toHaveLength(1),
    );
    expect(screen.queryByTestId("home-unread-badge")).toBeNull();
  });

  // Kept last: the never-settling permission request stays in flight in the
  // shared single-flight module for the rest of this file.
  it("shows a locating state while the permission / first fix is pending", async () => {
    locationMock.requestForegroundPermissionsAsync.mockImplementation(
      () => new Promise(() => {}),
    );
    mockApi({});

    await renderHome();

    expect(await screen.findByTestId("map-locating")).toBeOnTheScreen();
    expect(screen.getByText("Finding your location…")).toBeOnTheScreen();
  });
});

/**
 * M6-T4 — the driver home's online/offline toggle (UC-D-04, DRV-05,
 * TRK-01) against realtime-v1.yaml: every blocked reason (E1), the GPS
 * permission gate (E3), going online starts the stream (+ own position on
 * the map), going offline stops it, 409 handling, failure states, the M8
 * offers-blocked banner, the stream-health indicator, and going offline on
 * sign-out.
 */
import * as Location from "expo-location";
import { renderRouter, screen } from "expo-router/testing-library";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { Linking, Pressable, Text, View } from "react-native";

import type { DriverAvailability } from "../api/realtime-types";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { clearSession } from "../auth/session";
import { HomeScreen } from "../components/home-screen";
import { initI18n, setAppLanguage } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { AvailabilityProvider } from "../realtime/AvailabilityProvider";
import {
  driverUser,
  installContractFetch,
  seedSession,
} from "../test-utils/contract";
import type { MockResponse } from "../test-utils/contract";
import { availabilityFixture, MockSocket } from "../test-utils/realtime";

const GET = "GET /api/v1/driver/availability";
const PUT = "PUT /api/v1/driver/availability";
const BASE_ROUTES = {
  "GET /api/v1/meta": {
    status: 200,
    body: { name: "labby-backend", version: "0.1.0" },
  },
  "GET /api/v1/notifications/unread-count?app=driver": {
    status: 200,
    body: { unread: 0 },
  },
};

type WatchCallback = (position: Location.LocationObject) => void;
const locationMock = Location as jest.Mocked<typeof Location>;
let watchCallback: WatchCallback | null = null;
let watchRemove: jest.Mock;
const originalWebSocket = globalThis.WebSocket;

function mockLocation(granted: boolean, canAskAgain = true) {
  locationMock.requestForegroundPermissionsAsync.mockResolvedValue({
    granted,
    status: (granted ? "granted" : "denied") as Location.PermissionStatus,
    canAskAgain,
    expires: "never",
  });
  watchRemove = jest.fn();
  locationMock.watchPositionAsync.mockImplementation(
    async (_options, callback) => {
      watchCallback = callback as WatchCallback;
      return {
        remove: watchRemove,
      } as unknown as Location.LocationSubscription;
    },
  );
}

function emitPosition(lat: number, lng: number) {
  act(() => {
    watchCallback?.({
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
  });
}

function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <Pressable testID="test-sign-out" onPress={() => void signOut()}>
      <Text>sign out</Text>
    </Pressable>
  );
}

function renderHome(language: "en" | "ar" = "en") {
  renderRouter(
    {
      _layout: () => {
        const { Slot } = jest.requireActual("expo-router");
        return (
          <LocaleProvider initialLanguage={language}>
            <AuthProvider>
              <AvailabilityProvider>
                <Slot />
                <SignOutButton />
              </AvailabilityProvider>
            </AuthProvider>
          </LocaleProvider>
        );
      },
      index: () => <HomeScreen />,
      documents: () => <View testID="documents-route" />,
      vehicles: () => <View testID="vehicles-route" />,
      notifications: () => <View testID="notifications-route" />,
    },
    { initialUrl: "/" },
  );
}

async function setupHome(
  availability: MockResponse | MockResponse[],
  extra: Record<string, MockResponse | MockResponse[]> = {},
) {
  await seedSession(driverUser());
  const contract = installContractFetch({
    ...BASE_ROUTES,
    [GET]: availability,
    ...extra,
  });
  renderHome();
  return contract;
}

const ok = (data: DriverAvailability): MockResponse => ({
  status: 200,
  body: data,
});

describe("online/offline toggle (UC-D-04)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    watchCallback = null;
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("goes online (permission first), streams, shows the own position, and goes offline", async () => {
    mockLocation(true);
    const contract = await setupHome(ok(availabilityFixture()), {
      [PUT]: [
        ok(
          availabilityFixture({
            online: true,
            onlineSince: "2026-10-06T10:00:00Z",
          }),
        ),
        ok(availabilityFixture({ online: false })),
      ],
    });

    expect(await screen.findByTestId("availability-offline")).toBeTruthy();
    expect(screen.getByTestId("availability-status")).toHaveTextContent(
      "You're offline",
    );
    // I62: the top-bar "Online" pill only while online; I70: no offline hint.
    expect(screen.queryByTestId("home-online-pill")).toBeNull();
    expect(
      screen.queryByText("Go online to share your location and receive ride requests."),
    ).toBeNull();

    fireEvent.press(screen.getByTestId("availability-toggle"));

    expect(await screen.findByTestId("availability-online")).toBeTruthy();
    expect(screen.getByTestId("home-online-pill")).toHaveTextContent("Online", {
      exact: false,
    });
    expect(locationMock.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(contract.requestsTo(PUT)[0].body).toEqual({ online: true });

    // Streaming started: first-frame auth over ws(s) derived from the API base.
    await waitFor(() => expect(MockSocket.instances).toHaveLength(1));
    const socket = MockSocket.latest();
    expect(socket.url).toBe("ws://localhost:8080/api/v1/realtime");
    act(() => socket.open());
    expect(socket.frames()[0]).toEqual({ type: "auth", token: "access-1" });
    expect(await screen.findByTestId("stream-connecting")).toBeTruthy();

    // Waiting for GPS, then the own-position map appears.
    expect(screen.getByTestId("waiting-for-gps")).toBeTruthy();
    await waitFor(() => expect(watchCallback).not.toBeNull());
    emitPosition(33.5138, 36.2765);
    act(() => socket.ready());
    expect(await screen.findByTestId("own-position-map")).toBeTruthy();
    expect(screen.getByTestId("stream-live")).toBeTruthy();
    expect(socket.framesOfType("location")[0]).toMatchObject({
      lat: 33.5138,
      lng: 36.2765,
    });

    // Going offline stops the stream.
    fireEvent.press(screen.getByTestId("availability-toggle"));
    expect(await screen.findByTestId("availability-offline")).toBeTruthy();
    expect(contract.requestsTo(PUT)[1].body).toEqual({ online: false });
    expect(socket.closedWith).toBe(1000);
    expect(watchRemove).toHaveBeenCalled();
    expect(screen.queryByTestId("own-position-map")).toBeNull();
  });

  it.each([
    [
      "role_suspended",
      null,
      "Your driver access is suspended. Contact support for details.",
    ],
    [
      "role_suspended",
      "document_expired",
      "One of your documents has expired. Renew it to go online again.",
    ],
    [
      "not_approved",
      null,
      "Your driver application isn't approved, so you can't go online yet.",
    ],
    [
      "no_active_vehicle",
      null,
      "You need an approved, active vehicle to go online.",
    ],
  ] as const)(
    "blocks going online for %s (%s) with its reason",
    async (reason, suspension, copy) => {
      mockLocation(true);
      const contract = await setupHome(
        ok(
          availabilityFixture({
            canGoOnline: false,
            cannotGoOnlineReason: reason,
            suspensionReason: suspension,
          }),
        ),
      );

      expect(
        await screen.findByTestId(`availability-blocked-${reason}`),
      ).toBeTruthy();
      expect(
        screen.getByTestId("availability-blocked-reason"),
      ).toHaveTextContent(copy);
      fireEvent.press(screen.getByTestId("availability-toggle"));
      expect(contract.requestsTo(PUT)).toHaveLength(0);
      expect(screen.getByTestId("availability-toggle")).toBeDisabled();

      if (suspension === "document_expired") {
        fireEvent.press(screen.getByTestId("availability-renew-documents"));
        expect(await screen.findByTestId("documents-route")).toBeTruthy();
      } else if (reason === "no_active_vehicle") {
        fireEvent.press(screen.getByTestId("availability-manage-vehicle"));
        expect(await screen.findByTestId("vehicles-route")).toBeTruthy();
      } else {
        expect(screen.queryByTestId("availability-renew-documents")).toBeNull();
        expect(screen.queryByTestId("availability-manage-vehicle")).toBeNull();
      }
    },
  );

  it("cannot go online with location denied (E3): explains and links to settings", async () => {
    mockLocation(false, false);
    const openSettings = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue();
    const contract = await setupHome(ok(availabilityFixture()));

    fireEvent.press(await screen.findByTestId("availability-toggle"));

    expect(await screen.findByTestId("gps-denied")).toHaveTextContent(
      "Labby needs your location to put you online",
      { exact: false },
    );
    expect(screen.getByTestId("gps-denied")).toHaveTextContent(
      "Turn it on in your phone settings",
      { exact: false },
    );
    expect(contract.requestsTo(PUT)).toHaveLength(0);
    expect(MockSocket.instances).toHaveLength(0);
    fireEvent.press(screen.getByTestId("gps-open-settings"));
    expect(openSettings).toHaveBeenCalled();
  });

  it("a refused PUT (409) re-reads the GET and shows the machine-readable reason", async () => {
    mockLocation(true);
    const contract = await setupHome(
      [
        ok(availabilityFixture()),
        ok(
          availabilityFixture({
            canGoOnline: false,
            cannotGoOnlineReason: "no_active_vehicle",
          }),
        ),
      ],
      {
        [PUT]: {
          status: 409,
          body: { status: 409, message: "No active vehicle" },
        },
      },
    );

    fireEvent.press(await screen.findByTestId("availability-toggle"));

    expect(
      await screen.findByTestId("availability-blocked-no_active_vehicle"),
    ).toBeTruthy();
    expect(contract.requestsTo(GET)).toHaveLength(2);
  });

  it("explains a refused offline (409 — active ride, M7) and keeps streaming", async () => {
    mockLocation(true);
    await setupHome(ok(availabilityFixture({ online: true })), {
      [PUT]: { status: 409, body: { status: 409 } },
    });

    expect(await screen.findByTestId("availability-online")).toBeTruthy();
    await waitFor(() => expect(MockSocket.instances).toHaveLength(1));
    fireEvent.press(screen.getByTestId("availability-toggle"));

    expect(
      await screen.findByTestId("availability-action-error-offlineConflict"),
    ).toHaveTextContent("finish your active ride first", { exact: false });
    expect(screen.getByTestId("availability-online")).toBeTruthy();
    expect(MockSocket.latest().closedWith).toBeNull();
  });

  it("distinguishes a network failure from a server failure, both retryable", async () => {
    mockLocation(true);
    await seedSession(driverUser());
    let fail: "network" | "server" | null = "network";
    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.endsWith("/api/v1/driver/availability")) {
        if (fail === "network") throw new TypeError("Network request failed");
        if (fail === "server") {
          return { ok: false, status: 503, text: async () => '{"status":503}' };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(availabilityFixture()),
        };
      }
      return new Promise(() => {});
    }) as unknown as typeof fetch;
    renderHome();

    expect(
      await screen.findByTestId("availability-error-network"),
    ).toBeTruthy();
    fail = "server";
    fireEvent.press(screen.getByTestId("failure-retry"));
    expect(await screen.findByTestId("availability-error-server")).toBeTruthy();
    fail = null;
    fireEvent.press(screen.getByTestId("failure-retry"));
    expect(await screen.findByTestId("availability-offline")).toBeTruthy();
  });

  it("shows the M8 offers-blocked banner while online", async () => {
    mockLocation(true);
    await setupHome(
      ok(
        availabilityFixture({
          online: true,
          offersBlockedReason: "balance_below_floor",
        }),
      ),
    );
    expect(await screen.findByTestId("offers-blocked")).toHaveTextContent(
      "won't receive ride offers",
      { exact: false },
    );
  });

  it("shows reconnecting when the socket drops and stale when the server stops seeing samples", async () => {
    mockLocation(true);
    await setupHome([
      ok(availabilityFixture({ online: true })),
      ok(availabilityFixture({ online: true, streamHealthy: false })),
    ]);
    await waitFor(() => expect(MockSocket.instances).toHaveLength(1));
    const socket = MockSocket.latest();
    act(() => {
      socket.open();
      socket.ready();
    });
    expect(await screen.findByTestId("stream-live")).toBeTruthy();

    // One interval (+2 s) after going live the server's health is confirmed.
    expect(
      await screen.findByTestId("stream-stale", {}, { timeout: 9000 }),
    ).toHaveTextContent("isn't reaching Labby", { exact: false });

    act(() => socket.serverClose(1001));
    expect(await screen.findByTestId("stream-reconnecting")).toBeTruthy();
  }, 15000);

  it("pull-to-refresh while online re-reads the state without dropping the stream", async () => {
    mockLocation(true);
    const contract = await setupHome(ok(availabilityFixture({ online: true })));
    await waitFor(() => expect(MockSocket.instances).toHaveLength(1));

    await act(async () => {
      screen.getByTestId("home-sheet").props.refreshControl.props.onRefresh();
    });

    expect(contract.requestsTo(GET)).toHaveLength(2);
    expect(MockSocket.instances).toHaveLength(1);
    expect(MockSocket.latest().closedWith).toBeNull();
    expect(screen.getByTestId("availability-online")).toBeTruthy();
  });

  it("asks for location when the server says online at start, and explains when denied", async () => {
    mockLocation(false);
    await setupHome(ok(availabilityFixture({ online: true })));
    expect(await screen.findByTestId("gps-denied")).toHaveTextContent(
      "You're online, but location access is off",
      { exact: false },
    );
    expect(MockSocket.instances).toHaveLength(0);
  });

  it("takes an online driver offline before signing out", async () => {
    mockLocation(true);
    const contract = await setupHome(
      ok(availabilityFixture({ online: true })),
      {
        [PUT]: ok(availabilityFixture({ online: false })),
        "POST /api/v1/auth/logout": { status: 204 },
      },
    );
    expect(await screen.findByTestId("availability-online")).toBeTruthy();

    fireEvent.press(screen.getByTestId("test-sign-out"));

    await waitFor(() =>
      expect(contract.requestsTo("POST /api/v1/auth/logout")).toHaveLength(1),
    );
    const order = contract.requests.map((r) => `${r.method} ${r.path}`);
    expect(order.indexOf(PUT)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(PUT)).toBeLessThan(
      order.indexOf("POST /api/v1/auth/logout"),
    );
    expect(contract.requestsTo(PUT)[0].body).toEqual({ online: false });
  });

  it("renders the toggle and blocked reasons in Arabic", async () => {
    mockLocation(true);
    await setAppLanguage("ar");
    await seedSession(driverUser({ language: "ar" }));
    installContractFetch({
      ...BASE_ROUTES,
      [GET]: ok(
        availabilityFixture({
          canGoOnline: false,
          cannotGoOnlineReason: "no_active_vehicle",
        }),
      ),
    });
    renderHome("ar");

    expect(await screen.findByTestId("availability-status")).toHaveTextContent(
      "أنت غير متصل",
    );
    expect(screen.getByTestId("availability-blocked-reason")).toHaveTextContent(
      "تحتاج إلى مركبة نشطة وموافق عليها لتتمكن من الاتصال.",
    );
    // The GO button's label is the short "GO"; its accessible name stays "go online".
    expect(screen.getByTestId("availability-toggle")).toHaveTextContent(
      "انطلق",
    );
    expect(screen.getByTestId("availability-toggle")).toHaveProp(
      "accessibilityLabel",
      "ابدأ الاتصال",
    );
    expect(screen.getByTestId("availability-blocked-reason")).toHaveStyle({
      textAlign: "right",
    });
  });
});

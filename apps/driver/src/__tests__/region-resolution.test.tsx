/**
 * M4-T4 — region resolution (SD-01) against the regions-v1 contract:
 * boot resolve + cache, the significant-move threshold, boundary crossing,
 * the outside-operating-area state, network-failure fallback to the cache,
 * and the location-permission-denied state.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { renderRouter, screen } from "expo-router/testing-library";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { Linking } from "react-native";

import type { RegionConfig } from "../api/regions";
import { AuthProvider } from "../auth/AuthProvider";
import { clearSession } from "../auth/session";
import { HomeScreen } from "../components/home-screen";
import { initI18n, setAppLanguage } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { REGION_CACHE_KEY, RegionProvider } from "../region/RegionProvider";
import {
  driverUser,
  installContractFetch,
  seedSession,
} from "../test-utils/contract";

const regionA: RegionConfig = {
  id: "0b54f3a8-9a90-4a62-8f10-aaaaaaaaaaaa",
  name: "Damascus",
  currency: "SYP",
  emergencyNumber: "112",
  serviceTypes: [
    {
      id: "3f1c5b1e-6d7a-4f00-9e1a-bbbbbbbbbbbb",
      regionId: "0b54f3a8-9a90-4a62-8f10-aaaaaaaaaaaa",
      nameEn: "Economy",
      nameAr: "اقتصادي",
      baseFare: 1,
      perKmRate: 0.5,
      perMinRate: 0.1,
      minimumFare: 1.5,
      enabled: true,
    },
  ],
};

const regionB: RegionConfig = {
  ...regionA,
  id: "0b54f3a8-9a90-4a62-8f10-cccccccccccc",
  name: "Homs",
  currency: "SYP",
};

// Inside region A, inside region B (~145 km away), and a <1.5 km nudge.
const pointA = { lat: 33.5, lng: 36.3 };
const pointB = { lat: 34.8, lng: 36.6 };
const nearPointA = { lat: 33.505, lng: 36.3 };

const RESOLVE_AT_A = "GET /api/v1/regions/resolve?lat=33.5&lng=36.3";
const RESOLVE_AT_B = "GET /api/v1/regions/resolve?lat=34.8&lng=36.6";
const META = "GET /api/v1/meta";
const metaOk = {
  status: 200,
  body: { name: "labby-backend", version: "0.1.0" },
};

type WatchCallback = (position: {
  coords: { latitude: number; longitude: number };
}) => void;

const locationMock = Location as jest.Mocked<typeof Location>;
let watchCallback: WatchCallback | null = null;

function mockLocation({
  granted,
  at,
}: {
  granted: boolean;
  at?: { lat: number; lng: number };
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
  if (at) {
    locationMock.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: at.lat, longitude: at.lng },
    } as Location.LocationObject);
  }
  locationMock.watchPositionAsync.mockImplementation(
    async (_options, callback) => {
      watchCallback = callback as WatchCallback;
      return { remove: jest.fn() } as unknown as Location.LocationSubscription;
    },
  );
}

function renderHome() {
  renderRouter(
    {
      index: () => (
        <LocaleProvider initialLanguage="en">
          <AuthProvider>
            <RegionProvider>
              <HomeScreen />
            </RegionProvider>
          </AuthProvider>
        </LocaleProvider>
      ),
    },
    { initialUrl: "/" },
  );
}

async function moveTo(point: { lat: number; lng: number }) {
  await waitFor(() => expect(watchCallback).not.toBeNull());
  await act(async () => {
    watchCallback?.({ coords: { latitude: point.lat, longitude: point.lng } });
  });
}

describe("region resolution (M4-T4, SD-01)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    watchCallback = null;
    await clearSession();
    await AsyncStorage.clear();
    await initI18n();
    await setAppLanguage("en");
  });

  it("resolves the region on boot, shows it on home, and caches the config", async () => {
    await seedSession(driverUser());
    mockLocation({ granted: true, at: pointA });
    const contract = installContractFetch({
      [META]: metaOk,
      [RESOLVE_AT_A]: { status: 200, body: regionA },
    });

    renderHome();

    expect(await screen.findByTestId("region-badge")).toHaveTextContent(
      "Damascus · SYP",
    );
    expect(contract.requestsTo(RESOLVE_AT_A)).toHaveLength(1);
    expect(contract.requestsTo(RESOLVE_AT_A)[0].headers.Authorization).toBe(
      "Bearer access-1",
    );
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(REGION_CACHE_KEY);
      expect(JSON.parse(raw ?? "null")).toMatchObject({
        config: { id: regionA.id, currency: "SYP" },
        lat: pointA.lat,
        lng: pointA.lng,
      });
    });
  });

  it("re-resolves only past the significant-move threshold and switches config across a boundary", async () => {
    await seedSession(driverUser());
    mockLocation({ granted: true, at: pointA });
    const contract = installContractFetch({
      [META]: metaOk,
      [RESOLVE_AT_A]: { status: 200, body: regionA },
      [RESOLVE_AT_B]: { status: 200, body: regionB },
    });

    renderHome();
    expect(await screen.findByTestId("region-badge")).toHaveTextContent(
      "Damascus · SYP",
    );

    // A < 1.5 km nudge is not significant — no second resolve call.
    await moveTo(nearPointA);
    expect(
      contract.requests.filter((r) =>
        r.path.startsWith("/api/v1/regions/resolve"),
      ),
    ).toHaveLength(1);
    expect(screen.getByTestId("region-badge")).toHaveTextContent(
      "Damascus · SYP",
    );

    // Crossing into region B re-resolves and switches the stored config.
    await moveTo(pointB);
    await waitFor(() => {
      expect(screen.getByTestId("region-badge")).toHaveTextContent(
        "Homs · SYP",
      );
    });
    expect(contract.requestsTo(RESOLVE_AT_B)).toHaveLength(1);
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(REGION_CACHE_KEY);
      expect(JSON.parse(raw ?? "null")).toMatchObject({
        config: { id: regionB.id },
      });
    });
  });

  it("renders the outside-operating-area state on a 404 and recovers via retry", async () => {
    await seedSession(driverUser());
    mockLocation({ granted: true, at: pointA });
    installContractFetch({
      [META]: metaOk,
      [RESOLVE_AT_A]: [
        {
          status: 404,
          body: { status: 404, message: "Outside every operating region" },
        },
        { status: 200, body: regionA },
      ],
    });

    renderHome();

    expect(await screen.findByTestId("region-outside")).toBeTruthy();
    expect(screen.getByText("Outside our service area")).toBeTruthy();
    expect(screen.queryByTestId("region-badge")).toBeNull();

    fireEvent.press(screen.getByTestId("region-retry"));
    expect(await screen.findByTestId("region-badge")).toHaveTextContent(
      "Damascus · SYP",
    );
  });

  it("keeps the cached config when the resolve call fails on the network", async () => {
    await seedSession(driverUser());
    await AsyncStorage.setItem(
      REGION_CACHE_KEY,
      JSON.stringify({ config: regionA, lat: pointA.lat, lng: pointA.lng }),
    );
    mockLocation({ granted: true, at: pointB });
    installContractFetch({ [META]: metaOk }); // resolve unmocked → network-style failure

    renderHome();

    // Server trouble is NOT "outside the area": the last config stays usable.
    expect(await screen.findByTestId("region-badge")).toHaveTextContent(
      "Damascus · SYP",
    );
    expect(screen.queryByTestId("region-outside")).toBeNull();
    expect(screen.queryByTestId("region-error")).toBeNull();
  });

  it("shows the error/retry state when resolution fails with no cached config", async () => {
    await seedSession(driverUser());
    mockLocation({ granted: true, at: pointA });
    installContractFetch({ [META]: metaOk });

    renderHome();

    expect(await screen.findByTestId("region-error")).toBeTruthy();
    expect(screen.getByText("Couldn't check your area")).toBeTruthy();
    expect(screen.getByTestId("region-retry")).toBeTruthy();
    expect(screen.queryByTestId("region-outside")).toBeNull();
  });

  it("explains the permission-denied state with retry and open-settings actions", async () => {
    await seedSession(driverUser());
    mockLocation({ granted: false });
    installContractFetch({ [META]: metaOk });
    const openSettings = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue();

    renderHome();

    expect(await screen.findByTestId("region-permissionDenied")).toBeTruthy();
    expect(screen.getByText("Location needed")).toBeTruthy();
    expect(screen.getByTestId("region-retry")).toBeTruthy();

    fireEvent.press(screen.getByTestId("region-open-settings"));
    expect(openSettings).toHaveBeenCalled();
  });
});

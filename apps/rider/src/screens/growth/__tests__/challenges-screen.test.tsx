/**
 * M13-T3 challenges (UC-S-24, GAME-02) against growth-v1 mocks — approved
 * artboard R13Challenges: the region + role query, a running challenge
 * with live progress / reward / end time, a completed one with its credited
 * points, an ended one (E1 — the window lapsed, no partial reward), an
 * upcoming one, and the empty state.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { render, screen } from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { RegionProvider } from "../../../region/region-context";
import {
  challengeView,
  regionConfig,
} from "../../../test-utils/growth-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import ChallengesScreen from "../challenges-screen";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const locationMock = Location as jest.Mocked<typeof Location>;

function grantLocation() {
  const permission = {
    granted: true,
    status: "granted" as Location.PermissionStatus,
    canAskAgain: true,
    expires: "never" as const,
  };
  locationMock.requestForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 33.5138, longitude: 36.2765 },
  } as Location.LocationObject);
  locationMock.watchPositionAsync.mockResolvedValue({
    remove: jest.fn(),
  } as unknown as Location.LocationSubscription);
}

const REGION_ROUTE = {
  "GET /api/v1/regions/resolve": { status: 200, body: regionConfig },
};

function renderChallenges() {
  return render(
    <LocaleProvider>
      <RegionProvider>
        <ChallengesScreen />
      </RegionProvider>
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  grantLocation();
});

describe("challenges (UC-S-24)", () => {
  it("explains an out-of-area region with a retry instead of loading forever (W10)", async () => {
    mockApi({
      "GET /api/v1/regions/resolve": {
        status: 404,
        body: { status: 404, message: "outside" },
      },
    });
    await renderChallenges();
    expect(
      await screen.findByTestId("challenges-region-blocked"),
    ).toHaveTextContent("Outside our service area", { exact: false });
    expect(
      screen.getByTestId("challenges-region-blocked-retry"),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("challenges-loading")).toBeNull();
  });

  it("shows running, completed, ended and upcoming challenges", async () => {
    const running = challengeView();
    const completed = challengeView({
      challengeId: "cccc3333-3333-4333-8333-333333333333",
      titleEn: "October starter",
      titleAr: "بداية تشرين",
      myProgress: 3,
      goalTarget: 3,
      myCompleted: true,
      rewardPoints: 300,
    });
    const ended = challengeView({
      challengeId: "cccc4444-4444-4444-8444-444444444444",
      titleEn: "Share the road",
      titleAr: "شارك الطريق",
      goalType: "shared_rides",
      goalTarget: 2,
      myProgress: 1,
      ended: true,
    });
    const upcoming = challengeView({
      challengeId: "cccc5555-5555-4555-8555-555555555555",
      titleEn: "November dash",
      titleAr: "اندفاعة تشرين الثاني",
      startsAt: "2099-11-01T00:00:00Z",
      endsAt: "2099-11-08T00:00:00Z",
      myProgress: 0,
    });
    const api = mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/challenges": {
        status: 200,
        body: [running, upcoming, completed, ended],
      },
    });
    await renderChallenges();

    const runningCard = await screen.findByTestId(
      `challenge-${running.challengeId}`,
    );
    expect(runningCard).toHaveTextContent(/Weekend rider/);
    expect(
      screen.getByTestId(`challenge-${running.challengeId}-progress`),
    ).toHaveTextContent(/3 of 5 rides/);
    expect(
      screen.getByTestId(`challenge-${running.challengeId}-reward`),
    ).toHaveTextContent(/\+300 pts/);
    expect(
      screen.getByTestId(`challenge-${running.challengeId}-window`),
    ).toHaveTextContent(/Ends /);

    // Completed: the credited points (auto-credited exactly once).
    expect(
      screen.getByTestId(`challenge-${completed.challengeId}-done`),
    ).toHaveTextContent(/Done · 300 points added/);

    // E1: the window lapsed — ended, no partial reward shown.
    expect(
      screen.getByTestId(`challenge-${ended.challengeId}-window`),
    ).toHaveTextContent(/Ended/);
    expect(
      screen.getByTestId(`challenge-${ended.challengeId}-progress`),
    ).toHaveTextContent(/1 of 2 shared rides/);

    expect(
      screen.getByTestId(`challenge-${upcoming.challengeId}-window`),
    ).toHaveTextContent(/Starts /);

    const query = api.callsTo("GET", "/api/v1/challenges")[0].query;
    expect(query).toEqual({ regionId: regionConfig.id, as: "rider" });
  });

  it("shows the empty state", async () => {
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/challenges": { status: 200, body: [] },
    });
    await renderChallenges();
    expect(await screen.findByTestId("challenges-empty")).toHaveTextContent(
      /No challenges right now — check back soon\./,
    );
  });
});

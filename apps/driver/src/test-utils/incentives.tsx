import { renderRouter } from "expo-router/testing-library";
import React from "react";

import type { IncentiveProgress } from "../api/incentives-types";
import { AuthProvider } from "../auth/AuthProvider";
import IncentivesRoute from "../app/incentives";
import { SettingsScreen } from "../components/settings-screen";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { RegionProvider } from "../region/RegionProvider";
import { driverUser, installContractFetch, seedSession } from "./contract";
import type { ContractFetch, MockResponse } from "./contract";
import { ok, REGION_ID, RESOLVE_REGION, regionBody } from "./growth";
import { mockLocationGranted } from "./ride-harness";

/** Contract-shaped fixtures and a harness for incentives-v1.yaml. */

export const INCENTIVES = `GET /api/v1/driver/incentives?regionId=${REGION_ID}`;

/**
 * The approved D15Incentives board state, on a real calendar week
 * (Mon 19 – Sun 25 Oct 2026): 26 trips toward the 40 → 50,000 tier, peak
 * live until 09:30 with 9 peak trips, a 4.86 average over 21 ratings, and
 * last week's weekly trip bonus paid Monday morning.
 */
export function incentivesFixture(
  overrides: Partial<IncentiveProgress> = {},
): IncentiveProgress {
  return {
    regionId: REGION_ID,
    regionName: "Damascus",
    configured: true,
    currency: "SYP",
    weekStart: "2026-10-19",
    weekEnd: "2026-10-25",
    timeZone: "Asia/Damascus",
    weeklyTrips: {
      trips: 26,
      tiers: [
        { trips: 40, amount: 50000 },
        { trips: 60, amount: 100000 },
      ],
      reachedTier: null,
      nextTier: { trips: 40, amount: 50000 },
    },
    peak: {
      bonusPerTrip: 1000,
      windows: [
        { daysOfWeek: [1, 2, 3, 4], startsAt: "07:00:00", endsAt: "09:30:00" },
        { daysOfWeek: [5, 6], startsAt: "22:00:00", endsAt: "02:00:00" },
      ],
      activeNow: true,
      activeUntil: "09:30:00",
      trips: 9,
      earned: 9000,
    },
    rating: {
      amount: 20000,
      minAvgRating: 4.8,
      minWeeklyTrips: 30,
      average: 4.86,
      ratingCount: 21,
      trips: 26,
      qualifies: false,
    },
    recentAwards: [
      {
        weekStart: "2026-10-12",
        kind: "weekly_trips",
        amount: 50000,
        currency: "SYP",
        trips: 44,
        threshold: 40,
        avgRating: null,
        // Monday 19 Oct, 09:00 in Damascus.
        awardedAt: "2026-10-19T06:00:00Z",
      },
    ],
    ...overrides,
  };
}

/** The D15IncentivesEmpty state: the region runs no incentive. */
export function unconfiguredFixture(): IncentiveProgress {
  return incentivesFixture({
    configured: false,
    weeklyTrips: null,
    peak: null,
    rating: null,
    recentAwards: [],
  });
}

/**
 * Locale + auth + region around the incentives route and the settings
 * menu; the API mocked at the fetch boundary, GPS granted at the default
 * Damascus fix.
 */
export async function renderIncentivesApp(
  routes: Record<string, MockResponse | MockResponse[]> = {},
  options: { language?: "en" | "ar"; initialUrl?: string } = {},
): Promise<ContractFetch> {
  await seedSession(driverUser());
  mockLocationGranted();
  const contract = installContractFetch({
    "GET /api/v1/meta": ok({ name: "labby-backend", version: "0.1.0" }),
    [RESOLVE_REGION]: ok(regionBody()),
    ...routes,
  });
  const language = options.language ?? "en";
  renderRouter(
    {
      _layout: () => {
        const { Slot } = jest.requireActual("expo-router");
        return (
          <LocaleProvider initialLanguage={language}>
            <AuthProvider>
              <RegionProvider>
                <Slot />
              </RegionProvider>
            </AuthProvider>
          </LocaleProvider>
        );
      },
      index: () => <SettingsScreen />,
      settings: () => <SettingsScreen />,
      incentives: () => <IncentivesRoute />,
    },
    { initialUrl: options.initialUrl ?? "/incentives" },
  );
  return contract;
}

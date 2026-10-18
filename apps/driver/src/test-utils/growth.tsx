import { renderRouter } from "expo-router/testing-library";
import React from "react";

import type { UserProfile } from "../api/auth-types";
import type { ChallengeView, GamificationView } from "../api/growth-types";
import { AuthProvider } from "../auth/AuthProvider";
import ChallengesRoute from "../app/challenges";
import LevelRoute from "../app/level";
import { SettingsScreen } from "../components/settings-screen";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { RegionProvider } from "../region/RegionProvider";
import { driverUser, installContractFetch, seedSession } from "./contract";
import type { ContractFetch, MockResponse } from "./contract";
import { mockLocationGranted } from "./ride-harness";

/** Contract-shaped fixtures and a harness for growth-v1.yaml (driver side). */

export const GAMIFICATION = "GET /api/v1/gamification/me?as=driver";
export const REGION_ID = "9a000000-0000-4000-8000-000000000001";
export const CHALLENGES = `GET /api/v1/challenges?regionId=${REGION_ID}&as=driver`;
/** The boot resolve of mockLocationGranted's default fix. */
export const RESOLVE_REGION = "GET /api/v1/regions/resolve?lat=33.5&lng=36.28";

export const CHALLENGE_ID = "7d000000-0000-4000-8000-000000000001";

export const ok = (body: unknown): MockResponse => ({ status: 200, body });

export function regionBody() {
  return {
    id: REGION_ID,
    name: "Damascus",
    currency: "SYP",
    emergencyNumber: "112",
    serviceTypes: [],
  };
}

/** The approved D13Badges board state: Gold, 4 of 6 badges, split 612 + 2,228. */
export function gamificationFixture(
  overrides: Partial<GamificationView> = {},
): GamificationView {
  return {
    badges: [
      { badgeCode: "ride_10", earned: true, awardedAt: "2026-05-02T10:00:00Z" },
      { badgeCode: "ride_50", earned: true, awardedAt: "2026-07-14T10:00:00Z" },
      { badgeCode: "ride_100", earned: true, awardedAt: "2026-09-01T10:00:00Z" },
      { badgeCode: "first_shared_ride", earned: false, awardedAt: null },
      { badgeCode: "first_referral", earned: false, awardedAt: null },
      { badgeCode: "five_star_week", earned: true, awardedAt: "2026-10-05T10:00:00Z" },
    ],
    level: "gold",
    lifetime: 2840,
    driverTrips: 612,
    challengePoints: 2228,
    levels: [
      { level: "bronze", thresholdPoints: 0 },
      { level: "silver", thresholdPoints: 500 },
      { level: "gold", thresholdPoints: 2000 },
      { level: "platinum", thresholdPoints: 5000 },
    ],
    ...overrides,
  };
}

/** A running challenge per the D13Challenges board ("Weekly 40", 26 of 40). */
export function challengeFixture(
  overrides: Partial<ChallengeView> = {},
): ChallengeView {
  const now = Date.now();
  return {
    challengeId: CHALLENGE_ID,
    titleEn: "Weekly 40",
    titleAr: "40 في الأسبوع",
    goalType: "completed_rides",
    goalTarget: 40,
    rewardPoints: 500,
    startsAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString(),
    ended: false,
    myProgress: 26,
    myCompleted: false,
    ...overrides,
  };
}

function baseRoutes(): Record<string, MockResponse | MockResponse[]> {
  return {
    "GET /api/v1/meta": ok({ name: "labby-backend", version: "0.1.0" }),
    [RESOLVE_REGION]: ok(regionBody()),
  };
}

/**
 * Locale + auth + region around the M13 growth routes; the API mocked at the
 * fetch boundary, GPS granted at the default Damascus fix.
 */
export async function renderGrowthApp(
  routes: Record<string, MockResponse | MockResponse[]> = {},
  options: {
    language?: "en" | "ar";
    initialUrl?: string;
    user?: UserProfile;
  } = {},
): Promise<ContractFetch> {
  await seedSession(options.user ?? driverUser());
  mockLocationGranted();
  const contract = installContractFetch({ ...baseRoutes(), ...routes });
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
      level: () => <LevelRoute />,
      challenges: () => <ChallengesRoute />,
    },
    { initialUrl: options.initialUrl ?? "/level" },
  );
  return contract;
}

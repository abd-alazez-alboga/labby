import { renderRouter } from "expo-router/testing-library";
import React from "react";
import { View } from "react-native";

import type { UserProfile } from "../api/auth-types";
import type {
  DriverPerformance,
  MetricWindow,
  OwnReport,
  PendingRating,
} from "../api/trust-types";
import { AuthProvider } from "../auth/AuthProvider";
import { HomeScreen } from "../components/home-screen";
import { EarningsScreen } from "../components/money/earnings-screen";
import { PerformanceScreen } from "../components/trust/performance-screen";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { AvailabilityProvider } from "../realtime/AvailabilityProvider";
import { DriverRideProvider } from "../rides/DriverRideProvider";
import RateRiderRoute from "../app/rate-rider";
import ReportMemberRoute from "../app/report-member";
import ReportRiderRoute from "../app/report-rider";
import ReportsRoute from "../app/reports";
import { RatingPromptProvider } from "../trust/RatingPromptProvider";
import { driverUser, installContractFetch, seedSession } from "./contract";
import type { ContractFetch, MockResponse } from "./contract";
import { availabilityFixture } from "./realtime";
import { RIDE_ID } from "./rides";

/** Contract-shaped fixtures and a harness for trust-v1.yaml (driver side). */

export const PENDING = "GET /api/v1/ratings/pending?as=driver";
export const RATE = `POST /api/v1/rides/${RIDE_ID}/rating`;
export const REPORT = `POST /api/v1/rides/${RIDE_ID}/reports`;
export const REPORT_FILES = "POST /api/v1/report-files";
export const MY_REPORTS = "GET /api/v1/reports/mine?as=driver&page=0&size=20";
export const PERFORMANCE = "GET /api/v1/driver/performance";

export function pendingFixture(
  overrides: Partial<PendingRating> = {},
): PendingRating {
  // Relative to now: the window logic ("N days left") reads the clock.
  const completedAt = Date.now() - 60 * 60 * 1000;
  return {
    rideId: RIDE_ID,
    completedAt: new Date(completedAt).toISOString(),
    windowEndsAt: new Date(completedAt + 7 * 24 * 60 * 60 * 1000).toISOString(),
    counterpartFirstName: "Rana",
    counterpartPhotoUrl: null,
    pickupLabel: "Mazzeh Autostrad",
    destinationLabel: "Umayyad Square",
    ...overrides,
  };
}

export function reportFixture(overrides: Partial<OwnReport> = {}): OwnReport {
  return {
    id: "6c000000-0000-4000-8000-000000000001",
    rideId: RIDE_ID,
    category: "vehicle_damage",
    status: "open",
    createdAt: "2026-10-15T09:50:00Z",
    resolvedAt: null,
    ...overrides,
  };
}

export function windowFixture(
  days: 7 | 30,
  overrides: Partial<MetricWindow> = {},
): MetricWindow {
  return days === 30
    ? {
        days: 30,
        acceptance: { percent: 46.2, numerator: 24, denominator: 52 },
        cancellation: { percent: 4.2, numerator: 1, denominator: 24 },
        onTime: { percent: 91.3, numerator: 21, denominator: 23 },
        trips: 23,
        earnings: [{ currency: "SYP", amount: 512000 }],
        ...overrides,
      }
    : {
        days: 7,
        acceptance: { percent: 80, numerator: 8, denominator: 10 },
        cancellation: { percent: 12.5, numerator: 1, denominator: 8 },
        onTime: { percent: 100, numerator: 7, denominator: 7 },
        trips: 7,
        earnings: [{ currency: "SYP", amount: 140000 }],
        ...overrides,
      };
}

export function performanceFixture(
  overrides: Partial<DriverPerformance> = {},
): DriverPerformance {
  return {
    windows: [windowFixture(7), windowFixture(30)],
    rating: {
      role: "driver",
      average: 4.62,
      snapshotAt: "2026-10-15T00:00:00Z",
    },
    warnings: [],
    ratingRule: { minAvgRating: 3, minRatedRides: 20, warnAvgRating: 3.5 },
    ratingWarning: false,
    ...overrides,
  };
}

export const ok = (body: unknown): MockResponse => ({ status: 200, body });
export const coded = (status: number, code: string): MockResponse => ({
  status,
  body: { status, message: code, code },
});

/** The calls every harness render makes at activation. */
export function trustBaseRoutes(): Record<string, MockResponse | MockResponse[]> {
  return {
    "GET /api/v1/meta": ok({ name: "labby-backend", version: "0.1.0" }),
    "GET /api/v1/notifications/unread-count?app=driver": ok({ unread: 0 }),
    "GET /api/v1/driver/availability": ok(availabilityFixture()),
    "GET /api/v1/driver/offers/open": { status: 204 },
    "GET /api/v1/driver/rides/active": { status: 204 },
    [PENDING]: ok([]),
  };
}

/**
 * The real providers the trust screens use (auth, availability, the ride
 * facade, the rating prompt) around the home route and the M11 routes; the
 * API mocked at the fetch boundary.
 */
export async function renderTrustApp(
  routes: Record<string, MockResponse | MockResponse[]> = {},
  options: {
    language?: "en" | "ar";
    initialUrl?: string;
    user?: UserProfile;
  } = {},
): Promise<ContractFetch> {
  await seedSession(options.user ?? driverUser());
  const contract = installContractFetch({ ...trustBaseRoutes(), ...routes });
  const language = options.language ?? "en";
  renderRouter(
    {
      _layout: () => {
        const { Slot } = jest.requireActual("expo-router");
        return (
          <LocaleProvider initialLanguage={language}>
            <AuthProvider>
              <AvailabilityProvider>
                <DriverRideProvider>
                  <RatingPromptProvider>
                    <Slot />
                  </RatingPromptProvider>
                </DriverRideProvider>
              </AvailabilityProvider>
            </AuthProvider>
          </LocaleProvider>
        );
      },
      index: () => <HomeScreen />,
      "rate-rider": () => <RateRiderRoute />,
      "report-rider": () => <ReportRiderRoute />,
      "report-member": () => <ReportMemberRoute />,
      reports: () => <ReportsRoute />,
      performance: () => <PerformanceScreen />,
      earnings: () => <EarningsScreen />,
      settings: () => <View testID="settings-route" />,
      notifications: () => <View testID="notifications-route" />,
    },
    { initialUrl: options.initialUrl ?? "/" },
  );
  return contract;
}

import type { UserProfile } from '../api/auth';
import type {
  AccountFlag,
  AccountFlagPage,
  AdminReport,
  AdminReportPage,
  AdminReportSummary,
  AdminUserTrust,
  RoleTrust,
} from '../api/trust';
import { SOS_RIDE_ID } from './comms-fixtures';
import { adminUser, jsonResponse, stubFetchRoutes, type FetchRouteHandler } from './test-utils';

/**
 * Shared M11 admin trust fixtures, shaped exactly like trust-v1.yaml's
 * schemas (AdminReport, AccountFlag, AdminUserTrust). Names and figures
 * follow the approved artboards (Samer Haddad, Rana Khoury…).
 */

/** Support seat with everything trust + the M10 evidence permissions. */
export const TRUST_ADMIN = adminUser([
  'reports:view',
  'reports:handle',
  'users:view',
  'users:suspend',
  'rides:view',
  'support:view',
]);
/** May read the queue and reports but not resolve or open evidence. */
export const REPORTS_VIEWER = adminUser(['reports:view']);
/** Flags + profiles, read-only. */
export const USERS_VIEWER = adminUser(['users:view']);

export const SAMER_ID = '00000000-0000-4000-8000-0000000000a1';
export const RANA_ID = '00000000-0000-4000-8000-0000000000a2';
export const OMAR_ID = '00000000-0000-4000-8000-0000000000a3';
export const REPORT_1 = '11111111-0000-4000-8000-000000000001';
export const REPORT_2 = '22222222-0000-4000-8000-000000000002';
export const FLAG_1 = 'f1a90000-0000-4000-8000-000000000001';
export const FLAG_2 = 'f2a90000-0000-4000-8000-000000000002';
export const FLAG_3 = 'f3a90000-0000-4000-8000-000000000003';

/** Hours before now, as an ISO instant (queue "waiting" columns). */
export function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function reportSummary(overrides: Partial<AdminReportSummary> = {}): AdminReportSummary {
  return {
    id: REPORT_1,
    rideId: SOS_RIDE_ID,
    category: 'unsafe_driving',
    status: 'open',
    reporter: { userId: RANA_ID, name: 'Rana Khoury', role: 'rider' },
    reported: { userId: SAMER_ID, name: 'Samer Haddad', role: 'driver' },
    createdAt: hoursAgo(50),
    resolvedAt: null,
    photoCount: 1,
    ...overrides,
  };
}

export function reportPage(
  items: AdminReportSummary[],
  totalElements = items.length,
): AdminReportPage {
  return { items, page: 0, size: 20, totalElements };
}

export function adminReport(overrides: Partial<AdminReport> = {}): AdminReport {
  return {
    ...reportSummary(),
    description: 'He was speeding on the Mezzeh highway and using his phone.',
    photoUrls: ['/api/v1/files/photo-1?token=abc'],
    resolutionNote: null,
    resolvedBy: null,
    reporterHistory: { reportsAgainst: 0, substantiatedAgainst: 0, reportsFiled: 1 },
    reportedHistory: { reportsAgainst: 5, substantiatedAgainst: 2, reportsFiled: 0 },
    ...overrides,
  };
}

export const REPORT_THRESHOLD_FLAG: AccountFlag = {
  id: FLAG_1,
  user: { userId: SAMER_ID, name: 'Samer Haddad', role: 'driver' },
  kind: 'report_threshold',
  status: 'open',
  details: { substantiatedCount: 3, windowDays: 90, threshold: 3, reportIds: [REPORT_1, REPORT_2] },
  raisedAt: '2026-10-13T09:00:00Z',
  resolvedAt: null,
  resolutionNote: null,
};

export const LOW_RATING_FLAG: AccountFlag = {
  id: FLAG_2,
  user: { userId: SAMER_ID, name: 'Samer Haddad', role: 'driver' },
  kind: 'low_rating',
  status: 'open',
  details: { average: 3.38, ratingCount: 34, warnAvgRating: 3.5, minRatedRides: 20 },
  raisedAt: '2026-10-12T09:00:00Z',
  resolvedAt: null,
  resolutionNote: null,
};

export const METRIC_FLAG: AccountFlag = {
  id: FLAG_3,
  user: { userId: OMAR_ID, name: 'Omar Saleh', role: 'driver' },
  kind: 'metric_warning',
  status: 'open',
  details: {
    metric: 'acceptance',
    valuePercent: 46,
    thresholdPercent: 50,
    windowDays: 30,
    sampleSize: 52,
  },
  raisedAt: '2026-10-11T09:00:00Z',
  resolvedAt: null,
  resolutionNote: null,
};

export function flagPage(items: AccountFlag[], totalElements = items.length): AccountFlagPage {
  return { items, page: 0, size: 20, totalElements };
}

export function roleTrust(overrides: Partial<RoleTrust> = {}): RoleTrust {
  return {
    role: 'rider',
    state: 'active',
    suspensionReason: null,
    suspensionNote: null,
    suspendedAt: null,
    liveAverage: 4.81,
    liveRatingCount: 12,
    openFlags: [],
    activeWarnings: [],
    reportHistory: { reportsAgainst: 0, substantiatedAgainst: 0, reportsFiled: 1 },
    ...overrides,
  };
}

/** The artboard's Samer: driver auto-suspended for low rating, rider active. */
export function userTrust(overrides: Partial<AdminUserTrust> = {}): AdminUserTrust {
  return {
    userId: SAMER_ID,
    name: 'Samer Haddad',
    accountState: 'active',
    accountSuspensionNote: null,
    accountSuspendedAt: null,
    roles: [
      roleTrust({
        role: 'driver',
        state: 'suspended',
        suspensionReason: 'low_rating',
        suspendedAt: '2026-10-14T08:00:00Z',
        liveAverage: 2.94,
        liveRatingCount: 23,
        openFlags: [REPORT_THRESHOLD_FLAG, LOW_RATING_FLAG],
        activeWarnings: [
          {
            metric: 'cancellation',
            valuePercent: 18.5,
            thresholdPercent: 15,
            comparison: 'above',
            windowDays: 30,
            sampleSize: 27,
            raisedAt: '2026-10-10T08:00:00Z',
          },
        ],
        reportHistory: { reportsAgainst: 5, substantiatedAgainst: 3, reportsFiled: 0 },
      }),
      roleTrust(),
    ],
    ...overrides,
  };
}

/**
 * Stubs the profile read plus empty trust queues (the sidebar badges read
 * them on every navigation); `extra` wins, so each test layers its answers.
 */
export function stubTrustRoutes(user: UserProfile, extra: FetchRouteHandler = () => null) {
  return stubFetchRoutes((method, path, init, url) => {
    const handled = extra(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'GET' && path === '/api/v1/admin/reports') {
      return jsonResponse(200, reportPage([]));
    }
    if (method === 'GET' && path === '/api/v1/admin/flags') {
      return jsonResponse(200, flagPage([]));
    }
    if (method === 'GET' && path === '/api/v1/admin/sos-events') {
      return jsonResponse(200, { items: [], nextCursor: null });
    }
    return null;
  });
}

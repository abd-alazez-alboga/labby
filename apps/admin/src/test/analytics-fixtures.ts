import type {
  AdminDriver,
  AdminTransaction,
  AdminUser,
  AnalyticsDashboard,
  Page,
} from '../api/analytics';
import type { UserProfile } from '../api/auth';
import { adminUser, jsonResponse, stubFetchRoutes, type FetchRouteHandler } from './test-utils';

/** analytics-v1.yaml fixtures for the M15-T2 dashboard, lists and exports. */

export const DAMASCUS_ID = 'aaaaaaaa-0000-4000-8000-0000000000d1';
export const ALEPPO_ID = 'aaaaaaaa-0000-4000-8000-0000000000a1';

export const ANALYST = adminUser(['analytics:view', 'regions:view']);
export const EXPORTER = adminUser([
  'analytics:view',
  'analytics:export',
  'users:view',
  'wallets:view',
  'settlements:view',
  'rides:view',
  'support:view',
  'regions:view',
]);
export const USERS_ONLY = adminUser(['users:view']);

/** Two days of rides; the range in the tests is 7 days, so 5 empty days get filled. */
export function dashboard(overrides: Partial<AnalyticsDashboard> = {}): AnalyticsDashboard {
  return {
    from: '2026-10-13T21:00:00Z',
    to: '2026-10-20T21:00:00Z',
    regionId: null,
    rides: {
      total: 3482,
      completed: 2951,
      cancelledByRider: 301,
      cancelledByDriver: 111,
      noDriverFound: 119,
      completionRate: 0.8467,
      byRegion: [
        { regionId: ALEPPO_ID, regionName: 'Aleppo', total: 578, completed: 471, cancelled: 79 },
        {
          regionId: DAMASCUS_ID,
          regionName: 'Damascus',
          total: 2904,
          completed: 2480,
          cancelled: 333,
        },
      ],
      byServiceType: [
        {
          serviceTypeId: 'ssssssss-0000-4000-8000-000000000001',
          regionId: DAMASCUS_ID,
          nameEn: 'Economy',
          nameAr: 'اقتصادي',
          total: 2610,
          completed: 2231,
        },
      ],
      daily: [],
    },
    revenue: {
      totals: [{ currency: 'SYP', grossFares: 148125000, commission: 29625000 }],
      byRegion: [
        {
          regionId: DAMASCUS_ID,
          regionName: 'Damascus',
          currency: 'SYP',
          grossFares: 124575000,
          commission: 24915000,
        },
      ],
    },
    users: {
      signups: { scope: 'platform', riders: 214, drivers: 18 },
      activeRiders: 1906,
      activeDrivers: 162,
      driversOnlineNow: 47,
    },
    ops: {
      avgPickupSeconds: 400,
      acceptanceRate: 0.7841,
      offersAccepted: 3120,
      offersAnswered: 3979,
      activeSurgeZones: 2,
    },
    ...overrides,
  };
}

export const RANA: AdminUser = {
  userId: 'uuuuuuuu-0000-4000-8000-000000000001',
  name: 'Rana Khoury',
  phone: '+963944120551',
  state: 'active',
  roles: [{ role: 'rider', state: 'active' }],
  createdAt: '2026-10-19T06:42:00Z',
};

export const KHALED: AdminUser = {
  userId: 'uuuuuuuu-0000-4000-8000-000000000002',
  name: 'Khaled Masri',
  phone: null,
  state: 'suspended',
  roles: [
    { role: 'driver', state: 'active' },
    { role: 'rider', state: 'active' },
  ],
  createdAt: '2026-10-18T14:05:00Z',
};

export const ONLINE_DRIVER: AdminDriver = {
  userId: KHALED.userId,
  name: 'Khaled Masri',
  phone: '+963933870204',
  applicationStatus: 'approved',
  online: true,
  regionId: DAMASCUS_ID,
  regionName: 'Damascus',
  vehiclePlate: 'دمشق 482173',
  createdAt: '2026-10-18T14:05:00Z',
};

export const APPLICANT: AdminDriver = {
  userId: 'uuuuuuuu-0000-4000-8000-000000000003',
  name: 'Fadi Nassar',
  phone: null,
  applicationStatus: 'under_review',
  online: false,
  regionId: null,
  regionName: null,
  vehiclePlate: null,
  createdAt: '2026-10-19T08:00:00Z',
};

export const EARNING: AdminTransaction = {
  transactionId: 'tttttttt-0000-4000-8000-000000000001',
  source: 'driver_ledger',
  userId: KHALED.userId,
  userName: 'Khaled Masri',
  type: 'commission_due',
  amount: -8800,
  currency: 'SYP',
  rideId: 'rrrrrrrr-0000-4000-8000-000000000001',
  balanceAfter: -26400,
  reason: null,
  createdAt: '2026-10-19T07:48:00Z',
};

export const GRANT: AdminTransaction = {
  transactionId: 'tttttttt-0000-4000-8000-000000000002',
  source: 'wallet',
  userId: RANA.userId,
  userName: 'Rana Khoury',
  type: 'admin_grant',
  amount: 25000,
  currency: 'SYP',
  rideId: null,
  balanceAfter: 25000,
  reason: 'Support ticket T-8F2A1C09',
  createdAt: '2026-10-19T08:05:00Z',
};

export function page<T>(items: T[], totalItems = items.length): Page<T> {
  return { items, page: 0, size: 20, totalItems };
}

export const REGIONS = [
  { id: DAMASCUS_ID, name: 'Damascus', state: 'active', currency: 'SYP' },
  { id: ALEPPO_ID, name: 'Aleppo', state: 'active', currency: 'SYP' },
];

/** The shell's background calls plus the M15 endpoints; `extra` answers first. */
export function stubAnalyticsRoutes(user: UserProfile, extra: FetchRouteHandler = () => null) {
  return stubFetchRoutes((method, path, init, url) => {
    const handled = extra(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'GET' && path === '/api/v1/admin/regions') {
      return jsonResponse(200, REGIONS);
    }
    if (method === 'GET' && path === '/api/v1/admin/analytics') {
      return jsonResponse(200, dashboard());
    }
    if (method === 'GET' && path === '/api/v1/admin/users') {
      return jsonResponse(200, page([RANA, KHALED]));
    }
    if (method === 'GET' && path === '/api/v1/admin/drivers') {
      return jsonResponse(200, page([ONLINE_DRIVER, APPLICANT]));
    }
    if (method === 'GET' && path === '/api/v1/admin/transactions') {
      return jsonResponse(200, page([GRANT, EARNING], 9214));
    }
    if (method === 'GET' && path === '/api/v1/admin/sos-events') {
      return jsonResponse(200, { items: [], nextCursor: null });
    }
    return null;
  });
}

/** A CSV attachment response like the backend's exports. */
export function csvResponse(list: string): Response {
  return new Response('﻿id\r\n1\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=UTF-8',
      'Content-Disposition': `attachment; filename="labby-${list}-20261020-081530Z.csv"`,
    },
  });
}

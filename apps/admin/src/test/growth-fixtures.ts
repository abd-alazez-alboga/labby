import type { UserProfile } from '../api/auth';
import type { Challenge, ChallengeDetail, ChallengePage, Promo, PromoPage } from '../api/growth';
import { adminUser, jsonResponse, stubFetchRoutes, type FetchRouteHandler } from './test-utils';

/** Contract-shaped fixtures for growth-v1.yaml (admin side, UC-A-26/28). */

export const DAMASCUS_ID = '9a000000-0000-4000-8000-000000000001';
export const ALEPPO_ID = '9a000000-0000-4000-8000-000000000002';
export const ECONOMY_ID = '5e000000-0000-4000-8000-000000000001';
export const PROMO_WELCOME = '6a000000-0000-4000-8000-000000000001';
export const PROMO_FLASH = '6a000000-0000-4000-8000-000000000002';
export const CHALLENGE_WEEKLY = '7c000000-0000-4000-8000-000000000001';
export const CHALLENGE_SPRINT = '7c000000-0000-4000-8000-000000000002';

export const PROMOS_ADMIN = adminUser([
  'promos:view',
  'promos:manage',
  'regions:view',
  'pricing:view',
]);
export const PROMOS_VIEWER = adminUser(['promos:view']);
export const CHALLENGES_ADMIN = adminUser(['challenges:view', 'challenges:manage', 'regions:view']);
export const CHALLENGES_VIEWER = adminUser(['challenges:view', 'regions:view']);

export function regionList() {
  return [
    { id: DAMASCUS_ID, name: 'Damascus', state: 'active', currency: 'SYP' },
    { id: ALEPPO_ID, name: 'Aleppo', state: 'active', currency: 'SYP' },
  ];
}

export function serviceTypeList() {
  return [
    {
      id: ECONOMY_ID,
      regionId: DAMASCUS_ID,
      nameEn: 'Economy',
      nameAr: 'اقتصادي',
      baseFare: 5000,
      perKmRate: 1000,
      perMinRate: 200,
      minimumFare: 8000,
      enabled: true,
    },
  ];
}

/** The artboard's WELCOME20: 20% to SYP 10,000, first ride only, running now. */
export function promoFixture(overrides: Partial<Promo> = {}): Promo {
  const now = Date.now();
  return {
    promoId: PROMO_WELCOME,
    code: 'WELCOME20',
    regionId: DAMASCUS_ID,
    serviceTypeId: null,
    type: 'percent',
    value: '20',
    maxDiscount: '10000',
    startsAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    perUserLimit: 1,
    totalCap: 1000,
    firstRideOnly: true,
    active: true,
    redemptionCount: 188,
    redeemedAmount: '1950000',
    ...overrides,
  };
}

export function promoPage(items: Promo[], totalItems = items.length): PromoPage {
  return { items, page: 0, size: 20, totalItems };
}

/** The artboard's Weekly 40: drivers, Damascus, running now. */
export function challengeFixture(overrides: Partial<Challenge> = {}): Challenge {
  const now = Date.now();
  return {
    challengeId: CHALLENGE_WEEKLY,
    regionId: DAMASCUS_ID,
    role: 'driver',
    titleEn: 'Weekly 40',
    titleAr: '40 في الأسبوع',
    goalType: 'completed_rides',
    goalTarget: 40,
    rewardPoints: 500,
    startsAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString(),
    endedAt: null,
    participantCount: 148,
    completedCount: 31,
    ...overrides,
  };
}

export function challengePage(items: Challenge[], totalItems = items.length): ChallengePage {
  return { items, page: 0, size: 20, totalItems };
}

export function challengeDetail(
  challenge: Challenge = challengeFixture(),
  overrides: Partial<ChallengeDetail['participation']> = {},
): ChallengeDetail {
  return {
    challenge,
    participation: {
      items: [
        {
          userId: 'u-samer',
          userName: 'Samer K.',
          progress: 40,
          completed: true,
          completedAt: '2026-10-17T21:14:00Z',
        },
        {
          userId: 'u-huda',
          userName: 'Huda M.',
          progress: 33,
          completed: false,
          completedAt: null,
        },
      ],
      page: 0,
      size: 20,
      totalItems: 2,
      ...overrides,
    },
  };
}

/**
 * Stubs the profile read, the regions list and the sidebar queue reads;
 * `extra` wins, so each test layers its growth answers on top.
 */
export function stubGrowthRoutes(user: UserProfile, extra: FetchRouteHandler = () => null) {
  return stubFetchRoutes((method, path, init, url) => {
    const handled = extra(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'GET' && path === '/api/v1/admin/regions') {
      return jsonResponse(200, regionList());
    }
    if (method === 'GET' && path === `/api/v1/admin/regions/${DAMASCUS_ID}/service-types`) {
      return jsonResponse(200, serviceTypeList());
    }
    if (method === 'GET' && path === '/api/v1/admin/reports') {
      return jsonResponse(200, { items: [], page: 0, size: 1, totalElements: 0 });
    }
    if (method === 'GET' && path === '/api/v1/admin/flags') {
      return jsonResponse(200, { items: [], page: 0, size: 1, totalElements: 0 });
    }
    if (method === 'GET' && path === '/api/v1/admin/sos-events') {
      return jsonResponse(200, { items: [], nextCursor: null });
    }
    return null;
  });
}

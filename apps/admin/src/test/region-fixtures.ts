import type { UserProfile } from '../api/auth';
import type {
  GeoJsonPolygon,
  Region,
  ServiceType,
  SurchargeWindow,
  SurgeZone,
} from '../api/regions';
import { jsonResponse, stubFetchRoutes, type FetchRouteHandler } from './test-utils';

/**
 * Shared M4 fixtures, shaped exactly like the contract's schemas
 * (regions-v1.yaml): polygons are closed [lng, lat] rings, SRID 4326.
 */

export const BOUNDARY: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [36.2, 33.4],
      [36.4, 33.4],
      [36.4, 33.6],
      [36.2, 33.6],
      [36.2, 33.4],
    ],
  ],
};

export const ZONE_POLYGON: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [36.25, 33.45],
      [36.3, 33.45],
      [36.3, 33.5],
      [36.25, 33.45],
    ],
  ],
};

/** A freshly created draft: only the name is set (UC-A-05). */
export const DRAFT_REGION: Region = {
  id: 'region-1',
  name: 'Damascus',
  state: 'draft',
  boundary: null,
  currency: null,
  emergencyNumber: null,
  cancellationGraceMin: null,
  cancellationFee: null,
  waitGraceMin: null,
  waitPerMinRate: null,
  pickupFeeThresholdKm: null,
  pickupFeePerKm: null,
  surgeCap: null,
  commissionTiers: null,
  incentiveValues: null,
  suspensionThresholds: null,
  serviceTypeCount: 0,
  surgeZoneCount: 0,
};

/** A draft whose mandatory bundle is complete (ready to activate). */
export const COMPLETE_REGION: Region = {
  ...DRAFT_REGION,
  boundary: BOUNDARY,
  currency: 'SYP',
  emergencyNumber: '112',
  cancellationGraceMin: 5,
  cancellationFee: 2,
  waitGraceMin: 5,
  waitPerMinRate: 0.25,
  pickupFeeThresholdKm: 10,
  pickupFeePerKm: 0.5,
  surgeCap: 2,
  commissionTiers: [
    { weeklyTripsAbove: 0, percent: 25 },
    { weeklyTripsAbove: 100, percent: 20 },
  ],
  incentiveValues: {
    weeklyTripBonuses: [{ trips: 40, amount: 50 }],
    peakHourBonusPerTrip: 1,
    ratingReward: { amount: 20, minAvgRating: 4.8, minWeeklyTrips: 30 },
  },
  suspensionThresholds: {
    driver: { minAvgRating: 3, minRatedRides: 20 },
    rider: { minAvgRating: 2.5, minRatedRides: 10 },
  },
  serviceTypeCount: 1,
  surgeZoneCount: 1,
};

export const SERVICE_TYPES: ServiceType[] = [
  {
    id: 'st-1',
    regionId: 'region-1',
    nameEn: 'Economy',
    nameAr: 'اقتصادي',
    baseFare: 1,
    perKmRate: 0.3,
    perMinRate: 0.1,
    minimumFare: 1.5,
    enabled: true,
  },
  {
    id: 'st-2',
    regionId: 'region-1',
    nameEn: 'Van',
    nameAr: 'فان',
    baseFare: 2,
    perKmRate: 0.5,
    perMinRate: 0.2,
    minimumFare: 3,
    enabled: false,
  },
];

export const SURCHARGE_WINDOWS: SurchargeWindow[] = [
  {
    id: 'win-1',
    regionId: 'region-1',
    label: 'Morning rush',
    startsAt: '07:30:00',
    endsAt: '09:00:00',
    daysOfWeek: [1, 2, 3, 4, 5],
    percent: 25,
  },
];

export const SURGE_ZONES: SurgeZone[] = [
  {
    id: 'zone-1',
    regionId: 'region-1',
    name: 'Old town',
    polygon: ZONE_POLYGON,
    thresholdSteps: [
      { ratio: 2, multiplier: 1.2 },
      { ratio: 3, multiplier: 1.5 },
    ],
    multiplierCap: 2,
    overrideMultiplier: null,
    overrideSetAt: null,
  },
];

/**
 * Stubs the detail page's standard reads (profile, region-1 bundle, the
 * three pricing children); `extra` wins, so tests layer mutations on top.
 */
export function stubRegionRoutes(
  user: UserProfile,
  region: Region = DRAFT_REGION,
  extra?: FetchRouteHandler,
) {
  return stubFetchRoutes((method, path, init) => {
    const handled = extra?.(method, path, init);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'GET' && path === '/api/v1/admin/regions') {
      return jsonResponse(200, [
        { id: region.id, name: region.name, state: region.state, currency: region.currency },
      ]);
    }
    if (method === 'GET' && path === `/api/v1/admin/regions/${region.id}`) {
      return jsonResponse(200, region);
    }
    if (method === 'GET' && path === `/api/v1/admin/regions/${region.id}/service-types`) {
      return jsonResponse(200, SERVICE_TYPES);
    }
    if (method === 'GET' && path === `/api/v1/admin/regions/${region.id}/surcharge-windows`) {
      return jsonResponse(200, SURCHARGE_WINDOWS);
    }
    if (method === 'GET' && path === `/api/v1/admin/regions/${region.id}/surge-zones`) {
      return jsonResponse(200, SURGE_ZONES);
    }
    return null;
  });
}

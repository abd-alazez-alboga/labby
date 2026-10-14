import type { UserProfile } from '../api/auth';
import type { AdminChatLog, AdminSosEvent, LiveOps } from '../api/comms';
import type { AdminRideDetail, AdminRideSummary } from '../api/rides';
import { ZONE_POLYGON } from './region-fixtures';
import { jsonResponse, stubFetchRoutes, type FetchRouteHandler } from './test-utils';

/**
 * Shared M10 fixtures, shaped exactly like the contracts' schemas
 * (comms-v1.yaml, rides-v1.yaml AdminRides).
 */

export const SOS_RIDE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
export const DONE_RIDE_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

export const REGIONS = [
  { id: 'region-1', name: 'Damascus', state: 'active' as const, currency: 'SYP' },
  { id: 'region-2', name: 'Aleppo', state: 'active' as const, currency: 'SYP' },
];

/** Today, fixed wall-clock moments (formatted through formatClock in asserts). */
function today(hours: number, minutes: number, seconds = 0): string {
  const at = new Date();
  at.setHours(hours, minutes, seconds, 0);
  return at.toISOString();
}

export const REQUESTED_AT = today(12, 28, 4);
export const OFFERING_AT = today(12, 28, 10);
export const ACCEPTED_AT = today(12, 29, 12);
export const ARRIVED_AT = today(12, 35, 2);
export const STARTED_AT = today(12, 36, 40);
export const SOS_AT = today(12, 40, 51);
export const ACK_AT = today(12, 55, 0);

export const OPEN_SOS: AdminSosEvent = {
  sosEventId: 'sos-open-1',
  rideId: SOS_RIDE_ID,
  triggeredByRole: 'rider',
  lat: 33.513,
  lng: 36.292,
  triggeredAt: SOS_AT,
  createdAt: SOS_AT,
  regionId: 'region-1',
  triggeredBy: { userId: 'user-lina', name: 'Lina K.', phone: '+963911111111' },
  rideState: 'in_progress',
  acknowledged: null,
};

export const ACKNOWLEDGED_SOS: AdminSosEvent = {
  sosEventId: 'sos-done-2',
  rideId: DONE_RIDE_ID,
  triggeredByRole: 'driver',
  lat: 33.5,
  lng: 36.3,
  triggeredAt: today(11, 10, 0),
  createdAt: today(11, 10, 0),
  regionId: 'region-1',
  triggeredBy: { userId: 'user-samer', name: 'Samer A.', phone: '+963922222222' },
  rideState: 'completed',
  acknowledged: {
    byUserId: 'admin-1',
    byName: 'Samir A.',
    at: ACK_AT,
    note: 'False alarm, pocket press',
  },
};

export const LIVE_OPS: LiveOps = {
  regionId: 'region-1',
  serverTime: today(12, 41, 0),
  refreshSeconds: 5,
  drivers: [
    {
      driverUserId: 'driver-yara',
      name: 'Yara M.',
      lat: 33.52,
      lng: 36.28,
      headingDeg: 90,
      status: 'idle',
      rideId: null,
    },
    {
      driverUserId: 'driver-samer',
      name: 'Samer A.',
      lat: 33.514,
      lng: 36.293,
      headingDeg: null,
      status: 'on_ride',
      rideId: SOS_RIDE_ID,
    },
  ],
  rides: [
    {
      rideId: SOS_RIDE_ID,
      state: 'in_progress',
      pickup: { lat: 33.51, lng: 36.29 },
      destination: { lat: 33.52, lng: 36.31 },
      stops: [],
      driverUserId: 'driver-samer',
      sosOpen: true,
    },
  ],
  surgeZones: [
    { id: 'zone-mazzeh', name: 'Mazzeh', polygon: ZONE_POLYGON, multiplier: 2, level: 3 },
    { id: 'zone-old', name: 'Old City', polygon: ZONE_POLYGON, multiplier: 1, level: 0 },
  ],
  sosEvents: [OPEN_SOS],
};

const COMPONENTS = {
  currency: 'SYP',
  baseFare: 3000,
  distanceFare: 15000,
  timeFare: 5000,
  surchargePercent: 0,
  surchargeAmount: 0,
  surgeMultiplier: 1,
  surgeAmount: 0,
  waitFare: 0,
  pickupFee: 0,
  minimumFareAdjustment: 0,
  discount: 0,
  total: 23000,
};

export const RIDE_DETAIL: AdminRideDetail = {
  ride: {
    id: SOS_RIDE_ID,
    state: 'in_progress',
    kind: 'on_demand',
    regionId: 'region-1',
    serviceTypeNameEn: 'Economy',
    serviceTypeNameAr: 'اقتصادي',
    pickup: { lat: 33.51, lng: 36.29, label: 'Abu Rummaneh' },
    destination: { lat: 33.52, lng: 36.31, label: 'Umayyad Sq' },
    stops: [],
    paymentMethod: 'cash',
    surgeMultiplier: 1,
    surchargePercent: 0,
    estimate: {
      distanceMeters: 6200,
      durationSeconds: 900,
      approximate: false,
      components: COMPONENTS,
    },
    timeline: {
      requestedAt: REQUESTED_AT,
      offeringAt: OFFERING_AT,
      acceptedAt: ACCEPTED_AT,
      driverArrivedAt: ARRIVED_AT,
      startedAt: STARTED_AT,
      completedAt: null,
      cancelledAt: null,
      noDriverFoundAt: null,
    },
    cancellationReason: null,
    cancellationFee: null,
    fare: null,
    paymentStatus: null,
    tip: null,
  },
  riderUserId: 'user-lina',
  riderName: 'Lina K.',
  riderPhone: '+963911111111',
  driverUserId: 'driver-samer',
  driverName: 'Samer A.',
  driverPhone: '+963922222222',
  vehicleId: 'vehicle-1',
  cancellationNote: null,
  offers: [
    {
      offerId: 'offer-1',
      sequence: 1,
      driverUserId: 'driver-yara',
      driverName: 'Yara M.',
      vehicleId: 'vehicle-2',
      offeredAt: today(12, 28, 12),
      expiresAt: today(12, 28, 27),
      response: 'declined',
      respondedAt: today(12, 28, 31),
      pickupDistanceMeters: 600,
      pickupEtaSeconds: 120,
    },
    {
      offerId: 'offer-2',
      sequence: 2,
      driverUserId: 'driver-samer',
      driverName: 'Samer A.',
      vehicleId: 'vehicle-1',
      offeredAt: today(12, 28, 35),
      expiresAt: today(12, 28, 50),
      response: 'accepted',
      respondedAt: ACCEPTED_AT,
      pickupDistanceMeters: 1100,
      pickupEtaSeconds: 240,
    },
  ],
  trace: [
    { lat: 33.512, lng: 36.285, recordedAt: today(12, 30, 0), phase: 'to_pickup' },
    { lat: 33.51, lng: 36.29, recordedAt: today(12, 35, 0), phase: 'to_pickup' },
    { lat: 33.512, lng: 36.295, recordedAt: today(12, 38, 0), phase: 'in_ride' },
    { lat: 33.514, lng: 36.3, recordedAt: today(12, 41, 0), phase: 'in_ride' },
  ],
};

export const CHAT_LOG: AdminChatLog = {
  rideId: SOS_RIDE_ID,
  windowState: 'open',
  openedAt: ACCEPTED_AT,
  closedAt: null,
  items: [
    {
      messageId: 'msg-1',
      senderRole: 'driver',
      kind: 'quick_reply',
      body: null,
      quickReply: { code: 'on_my_way', textEn: 'On my way', textAr: 'أنا في الطريق' },
      sentAt: today(12, 30, 0),
    },
    {
      messageId: 'msg-2',
      senderRole: 'rider',
      kind: 'text',
      body: "I'm at the pharmacy entrance, blue jacket",
      quickReply: null,
      sentAt: today(12, 31, 0),
    },
    {
      messageId: 'msg-3',
      senderRole: 'driver',
      kind: 'text',
      body: 'Stuck in traffic',
      quickReply: null,
      sentAt: today(12, 33, 0),
    },
  ],
  nextCursor: null,
};

export function rideSummary(overrides: Partial<AdminRideSummary> = {}): AdminRideSummary {
  return {
    id: DONE_RIDE_ID,
    state: 'completed',
    requestedAt: today(12, 2, 0),
    pickup: { lat: 33.5, lng: 36.28, label: 'Mazzeh' },
    destination: { lat: 33.51, lng: 36.3, label: 'Old City' },
    serviceTypeNameEn: 'Economy',
    serviceTypeNameAr: 'اقتصادي',
    total: 61000,
    cancellationFee: null,
    currency: 'SYP',
    kind: 'on_demand',
    regionId: 'region-1',
    regionName: 'Damascus',
    riderUserId: 'user-omar',
    riderName: 'Omar H.',
    driverUserId: 'driver-yara',
    driverName: 'Yara M.',
    ...overrides,
  };
}

/**
 * Stubs the M10 pages' standard reads (profile, regions list); `extra` wins,
 * so each test layers the live-ops / SOS / rides answers it needs on top.
 */
export function stubCommsRoutes(user: UserProfile, extra: FetchRouteHandler) {
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
    return null;
  });
}

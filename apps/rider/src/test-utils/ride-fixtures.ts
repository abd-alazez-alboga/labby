/**
 * Contract-shaped fixtures for rides-v1.yaml (rider view) and a fake
 * WebSocket for the realtime-v1 protocol.
 */
import type {
  EstimateResponse,
  FareComponents,
  Receipt,
  Ride,
  RiderPreferences,
  SavedLocation,
} from "../api/rides";
import type { SocketLike } from "../realtime/rider-socket";

export const RIDE_ID = "11111111-1111-4111-8111-111111111111";
export const ECONOMY_ID = "22222222-2222-4222-8222-222222222222";
export const COMFORT_ID = "33333333-3333-4333-8333-333333333333";

export const pickupPlace = { lat: 33.5138, lng: 36.2765, label: "Mazzeh Autostrad" };
export const destinationPlace = { lat: 33.5131, lng: 36.2913, label: "Umayyad Square" };

export function components(overrides: Partial<FareComponents> = {}): FareComponents {
  return {
    currency: "SYP",
    baseFare: 5000,
    distanceFare: 12600,
    timeFare: 4200,
    surchargePercent: 0,
    surchargeAmount: 0,
    surgeMultiplier: 1,
    surgeAmount: 0,
    waitFare: 0,
    pickupFee: 0,
    minimumFareAdjustment: 0,
    discount: 0,
    total: 21800,
    ...overrides,
  };
}

export const sampleDriver = {
  firstName: "Samer",
  photoUrl: null,
  rating: null,
  vehicle: {
    make: "Hyundai",
    model: "Accent",
    color: "Silver",
    plate: "دمشق 502345",
    photoUrl: null,
  },
};

export function ride(overrides: Partial<Ride> = {}): Ride {
  return {
    id: RIDE_ID,
    state: "requested",
    kind: "on_demand",
    regionId: "44444444-4444-4444-8444-444444444444",
    serviceTypeId: ECONOMY_ID,
    serviceTypeNameEn: "Economy",
    serviceTypeNameAr: "اقتصادية",
    pickup: pickupPlace,
    destination: destinationPlace,
    stops: [],
    paymentMethod: "cash",
    pickupDistanceMode: "nearby_only",
    surgeMultiplier: 1,
    surchargePercent: 0,
    estimate: {
      distanceMeters: 4200,
      durationSeconds: 720,
      approximate: false,
      components: components({ total: 22000 }),
    },
    timeline: { requestedAt: "2026-10-08T09:29:00Z" },
    cancellationGraceEndsAt: null,
    waitGraceEndsAt: null,
    cancellationReason: null,
    cancellationFee: null,
    fare: null,
    paymentStatus: null,
    carriedDues: [],
    driverStream: null,
    driverPosition: null,
    etaSeconds: null,
    retryOfRideId: null,
    redispatchOfRideId: null,
    redispatchedAsRideId: null,
    driver: null,
    ...overrides,
  };
}

export function acceptedRide(overrides: Partial<Ride> = {}): Ride {
  return ride({
    state: "accepted",
    driver: sampleDriver,
    driverStream: "ok",
    driverPosition: { lat: 33.52, lng: 36.27 },
    etaSeconds: 240,
    timeline: {
      requestedAt: "2026-10-08T09:29:00Z",
      offeringAt: "2026-10-08T09:29:01Z",
      acceptedAt: "2026-10-08T09:29:20Z",
    },
    cancellationGraceEndsAt: "2026-10-08T09:31:20Z",
    ...overrides,
  });
}

export function estimateResponse(
  overrides: Partial<EstimateResponse> = {},
): EstimateResponse {
  return {
    regionId: "44444444-4444-4444-8444-444444444444",
    currency: "SYP",
    surgeMultiplier: 1,
    surgeActive: false,
    surgeZoneName: null,
    surchargePercent: 0,
    route: {
      distanceMeters: 4200,
      durationSeconds: 720,
      approximate: false,
      geometry: {
        type: "LineString",
        coordinates: [
          [36.2765, 33.5138],
          [36.2913, 33.5131],
        ],
      },
    },
    options: [
      {
        serviceTypeId: ECONOMY_ID,
        nameEn: "Economy",
        nameAr: "اقتصادية",
        estimate: {
          distanceMeters: 4200,
          durationSeconds: 720,
          approximate: false,
          components: components({ total: 22000 }),
        },
      },
      {
        serviceTypeId: COMFORT_ID,
        nameEn: "Comfort",
        nameAr: "مريحة",
        estimate: {
          distanceMeters: 4200,
          durationSeconds: 720,
          approximate: false,
          components: components({ total: 33000 }),
        },
      },
    ],
    pickupDistanceMode: "nearby_only",
    pickupFeeRule: null,
    ...overrides,
  };
}

/**
 * An estimate under surge (PRC-02): every option's components carry the
 * multiplier and their totals scale with it (base totals 22,000 / 33,000).
 */
export function surgeEstimate(
  multiplier: number,
  zone: string | null = "Mazzeh",
): EstimateResponse {
  const base = estimateResponse({
    surgeMultiplier: multiplier,
    surgeActive: multiplier > 1,
    surgeZoneName: multiplier > 1 ? zone : null,
  });
  for (const option of base.options) {
    const total = option.estimate.components.total;
    option.estimate.components = components({
      surgeMultiplier: multiplier,
      surgeAmount: Math.round(total * (multiplier - 1)),
      total: Math.round(total * multiplier),
    });
  }
  return base;
}

export function preferencesFixture(
  overrides: Partial<RiderPreferences> = {},
): RiderPreferences {
  return {
    temperature: "cool",
    conversation: "quiet",
    music: "no_preference",
    pickupDistanceMode: "nearby_only",
    ...overrides,
  };
}

export const savedHome: SavedLocation = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Home",
  lat: 33.505,
  lng: 36.25,
  address: "Mazzeh, Damascus",
};

export const savedWork: SavedLocation = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Work",
  lat: 33.5131,
  lng: 36.2913,
  address: "Abu Rummaneh, Damascus",
};

export function receiptFixture(overrides: Partial<Receipt> = {}): Receipt {
  return {
    rideId: RIDE_ID,
    regionId: "44444444-4444-4444-8444-444444444444",
    serviceTypeNameEn: "Economy",
    serviceTypeNameAr: "اقتصادية",
    pickup: pickupPlace,
    destination: destinationPlace,
    stops: [],
    timeline: {
      requestedAt: "2026-10-08T09:29:00Z",
      startedAt: "2026-10-08T09:35:00Z",
      completedAt: "2026-10-08T09:49:00Z",
    },
    fare: {
      distanceMeters: 4200,
      durationSeconds: 840,
      components: components({
        surchargePercent: 25,
        surchargeAmount: 5450,
        total: 27250,
      }),
    },
    paymentMethod: "cash",
    paymentStatus: "paid_cash",
    carriedDues: [],
    driver: sampleDriver,
    route: {
      type: "LineString",
      coordinates: [
        [36.2765, 33.5138],
        [36.28, 33.515],
        [36.2913, 33.5131],
      ],
    },
    ...overrides,
  };
}

/** In-memory WebSocket: records frames, lets the test drive the server side. */
export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static latest(): FakeSocket {
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!socket) throw new Error("No socket opened yet");
    return socket;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number): void {
    this.closedWith = code ?? 1000;
    this.readyState = 3;
  }

  // ---- server side
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

export const fakeSocketFactory = (url: string) => new FakeSocket(url);

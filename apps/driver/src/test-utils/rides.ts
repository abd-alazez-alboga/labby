import type {
  FareComponents,
  Ride,
  RideOffer,
} from "../api/ride-types";

/** Contract-shaped fixtures for rides-v1.yaml (driver view). */

export const RIDE_ID = "5b1d3f0e-1111-4c4c-9a9a-000000000001";
export const OFFER_ID = "5b1d3f0e-2222-4c4c-9a9a-000000000001";

export function componentsFixture(
  overrides: Partial<FareComponents> = {},
): FareComponents {
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

/** An open offer; `expiresInMs` from now with a 15 s window. */
export function offerFixture(
  overrides: Partial<RideOffer> = {},
  expiresInMs = 12000,
): RideOffer {
  const now = Date.now();
  return {
    id: OFFER_ID,
    rideId: RIDE_ID,
    offeredAt: new Date(now + expiresInMs - 15000).toISOString(),
    expiresAt: new Date(now + expiresInMs).toISOString(),
    pickup: { lat: 33.5, lng: 36.28, label: "Mazzeh Autostrad" },
    pickupDistanceMeters: 1100,
    pickupEtaSeconds: 180,
    destination: { lat: 33.513, lng: 36.292, label: "Umayyad Square" },
    stops: [],
    serviceTypeNameEn: "Economy",
    serviceTypeNameAr: "اقتصادي",
    estimatedFare: 22000,
    currency: "SYP",
    surge: false,
    paymentMethod: "cash",
    rider: {
      firstName: "Rana",
      rating: null,
      comfort: { temperature: "cool", conversation: "quiet", music: "no_preference" },
    },
    ...overrides,
  };
}

/** A ride in driver view; `accepted` unless overridden. */
export function rideFixture(overrides: Partial<Ride> = {}): Ride {
  return {
    id: RIDE_ID,
    state: "accepted",
    kind: "on_demand",
    regionId: "9a000000-0000-4000-8000-000000000001",
    serviceTypeId: "9b000000-0000-4000-8000-000000000001",
    serviceTypeNameEn: "Economy",
    serviceTypeNameAr: "اقتصادي",
    pickup: { lat: 33.5, lng: 36.28, label: "Mazzeh Autostrad" },
    destination: { lat: 33.513, lng: 36.292, label: "Umayyad Square" },
    stops: [],
    paymentMethod: "cash",
    surgeMultiplier: 1,
    surchargePercent: 0,
    estimate: {
      distanceMeters: 4200,
      durationSeconds: 720,
      approximate: false,
      components: componentsFixture({ total: 22000 }),
    },
    timeline: {
      requestedAt: new Date(Date.now() - 120000).toISOString(),
      acceptedAt: new Date(Date.now() - 60000).toISOString(),
    },
    cancellationGraceEndsAt: null,
    waitGraceEndsAt: null,
    cancellationReason: null,
    cancellationFee: null,
    fare: null,
    paymentStatus: null,
    walletApplied: null,
    cashDue: null,
    tip: null,
    carriedDues: [],
    driverStream: "ok",
    etaSeconds: 180,
    rider: {
      firstName: "Rana",
      rating: null,
      comfort: { temperature: "cool", conversation: "quiet", music: "no_preference" },
    },
    ...overrides,
  };
}

/** Driver arrived `waitedMs` ago; the free wait ends `graceLeftMs` from now. */
export function arrivedRide(
  graceLeftMs: number,
  waitedMs = 60000,
  overrides: Partial<Ride> = {},
): Ride {
  const now = Date.now();
  const base = rideFixture();
  return rideFixture({
    state: "driver_arrived",
    timeline: {
      ...base.timeline,
      driverArrivedAt: new Date(now - waitedMs).toISOString(),
    },
    waitGraceEndsAt: new Date(now + graceLeftMs).toISOString(),
    ...overrides,
  });
}

export function inProgressRide(overrides: Partial<Ride> = {}): Ride {
  const base = rideFixture();
  return rideFixture({
    state: "in_progress",
    etaSeconds: 420,
    timeline: {
      ...base.timeline,
      driverArrivedAt: new Date(Date.now() - 300000).toISOString(),
      startedAt: new Date(Date.now() - 200000).toISOString(),
    },
    ...overrides,
  });
}

/** A completed cash ride awaiting the driver's cash-confirm / mark-unpaid. */
export function completedRide(overrides: Partial<Ride> = {}): Ride {
  return inProgressRide({
    state: "completed",
    paymentStatus: "pending",
    // Cash ride: the driver collects the whole stored fare (rides-v1 A).
    cashDue: 27250,
    etaSeconds: null,
    fare: {
      distanceMeters: 4200,
      durationSeconds: 840,
      components: componentsFixture({
        surchargePercent: 25,
        surchargeAmount: 5450,
        total: 27250,
      }),
    },
    ...overrides,
  });
}

/** A ride / offer frame as the backend sends it (RideEvents.java). */
export function rideFrame(
  type: "ride.state" | "ride.updated",
  ride: Ride,
  extra: Record<string, unknown> = {},
  as: "driver" | "rider" = "driver",
) {
  return { type, as, ...extra, ride };
}

export function offerNewFrame(offer: RideOffer, as: "driver" | "rider" = "driver") {
  return { type: "offer.new", as, offer };
}

export function offerWithdrawnFrame(reason: "timeout" | "ride_ended") {
  return {
    type: "offer.withdrawn",
    as: "driver",
    offerId: OFFER_ID,
    rideId: RIDE_ID,
    reason,
  };
}

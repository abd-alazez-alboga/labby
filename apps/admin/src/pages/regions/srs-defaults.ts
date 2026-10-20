import type { Region } from '../../api/regions';

/**
 * SRS §9 "Configurable Defaults (shipped values)" — offered as editable,
 * pre-filled values when CREATING a region, a service type or a surge zone
 * (V1 audit I24 / I26 / I27 / I28). Never applied to an existing record: an
 * edit form always shows what is stored. Money values are the SRS figures in
 * region currency units; the admin adjusts them to the currency's scale.
 */
export const SRS_REGION_DEFAULTS = {
  cancellationGraceMin: 2,
  cancellationFee: 2,
  waitGraceMin: 5,
  waitPerMinRate: 0.25,
  pickupFeeThresholdKm: 10,
  pickupFeePerKm: 0.5,
  /** COM-02: 25% / 20% > 100 / 15% > 200 weekly trips. */
  commissionTiers: [
    { weeklyTripsAbove: 0, percent: 25 },
    { weeklyTripsAbove: 100, percent: 20 },
    { weeklyTripsAbove: 200, percent: 15 },
  ],
  /**
   * DRV-08: 50 @ 40+, 100 @ 60+; peak +1.00 per trip; rating reward 20 @ ≥ 4.8 with ≥ 30 trips.
   * The bundle form does NOT prefill the peak bonus (owner ruling 2026-10-20): the admin sets
   * it together with its peak windows.
   */
  incentiveValues: {
    weeklyTripBonuses: [
      { trips: 40, amount: 50 },
      { trips: 60, amount: 100 },
    ],
    peakHourBonusPerTrip: 1,
    peakWindows: [],
    ratingReward: { amount: 20, minAvgRating: 4.8, minWeeklyTrips: 30 },
  },
  /** RATE-03: driver < 3.0 @ ≥ 20, rider < 2.5 @ ≥ 10; warning flag driver < 3.5, rider < 3.0. */
  suspensionThresholds: {
    driver: { minAvgRating: 3, minRatedRides: 20, warnAvgRating: 3.5 },
    rider: { minAvgRating: 2.5, minRatedRides: 10, warnAvgRating: 3 },
  },
  /** DRV-07: acceptance < 50%, cancellation > 15%, 30-day window, ≥ 20 sample. */
  metricWarnings: {
    minAcceptancePercent: 50,
    maxCancellationPercent: 15,
    windowDays: 30,
    minSample: 20,
  },
} satisfies Partial<Region>;

/** PRC-01: the minimum fare a new service type starts with. */
export const SRS_MINIMUM_FARE = 1.5;

/** PRC-02: the example surge steps a new zone starts with (≥2 → 1.2×, ≥3 → 1.5×, ≥5 → 2.0×). */
export const SRS_SURGE_STEPS = [
  { ratio: 2, multiplier: 1.2 },
  { ratio: 3, multiplier: 1.5 },
  { ratio: 5, multiplier: 2 },
];

/** The region with every unset bundle value filled from §9 (set values are kept). */
export function withSrsDefaults(region: Region): Region {
  return {
    ...region,
    cancellationGraceMin: region.cancellationGraceMin ?? SRS_REGION_DEFAULTS.cancellationGraceMin,
    cancellationFee: region.cancellationFee ?? SRS_REGION_DEFAULTS.cancellationFee,
    waitGraceMin: region.waitGraceMin ?? SRS_REGION_DEFAULTS.waitGraceMin,
    waitPerMinRate: region.waitPerMinRate ?? SRS_REGION_DEFAULTS.waitPerMinRate,
    pickupFeeThresholdKm: region.pickupFeeThresholdKm ?? SRS_REGION_DEFAULTS.pickupFeeThresholdKm,
    pickupFeePerKm: region.pickupFeePerKm ?? SRS_REGION_DEFAULTS.pickupFeePerKm,
    commissionTiers: region.commissionTiers?.length
      ? region.commissionTiers
      : SRS_REGION_DEFAULTS.commissionTiers,
    incentiveValues: region.incentiveValues ?? SRS_REGION_DEFAULTS.incentiveValues,
    suspensionThresholds: region.suspensionThresholds ?? SRS_REGION_DEFAULTS.suspensionThresholds,
    metricWarnings: region.metricWarnings ?? SRS_REGION_DEFAULTS.metricWarnings,
  };
}

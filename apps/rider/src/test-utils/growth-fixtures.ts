/**
 * M13 growth fixtures mirroring backend/docs/api/growth-v1.yaml: promo
 * validation, referral status (with the region reward amended at T3),
 * loyalty balance + points history, gamification view and challenges.
 * Region values are deliberately non-default — screens must read them from
 * the API, never hardcode them.
 */
import type {
  ChallengeView,
  GamificationView,
  LoyaltyBalance,
  PointsTransaction,
  PromoValidation,
  ReferralStatus,
} from "../api/growth";

/** Matches `estimateResponse().regionId` so booking promos share a region. */
export const GROWTH_REGION_ID = "44444444-4444-4444-8444-444444444444";

/** Damascus-realistic region config (SD-01) for mounting RegionProvider. */
export const regionConfig = {
  id: GROWTH_REGION_ID,
  name: "Damascus",
  currency: "SYP",
  emergencyNumber: "112",
  serviceTypes: [],
};

export function promoValidation(
  overrides: Partial<PromoValidation> = {},
): PromoValidation {
  return {
    code: "WELCOME20",
    type: "percent",
    value: 20,
    maxDiscount: 10000,
    discountPreview: 4400,
    ...overrides,
  };
}

export function referralStatus(
  overrides: Partial<ReferralStatus> = {},
): ReferralStatus {
  return {
    code: "LB-SAMI42",
    enteredCode: null,
    reward: {
      regionId: GROWTH_REGION_ID,
      currency: "SYP",
      referrerAmount: 25000,
      refereeAmount: 25000,
    },
    referees: [
      {
        firstName: "Rama",
        status: "rewarded",
        createdAt: "2026-10-01T09:00:00Z",
        rewardedAt: "2026-10-12T16:30:00Z",
      },
      {
        firstName: "Khaled",
        status: "pending",
        createdAt: "2026-10-14T11:00:00Z",
        rewardedAt: null,
      },
    ],
    ...overrides,
  };
}

export function loyaltyBalance(
  overrides: Partial<LoyaltyBalance> = {},
): LoyaltyBalance {
  return {
    redeemable: 1240,
    lifetime: 1740,
    level: "silver",
    levels: [
      { level: "bronze", thresholdPoints: 0 },
      { level: "silver", thresholdPoints: 500 },
      { level: "gold", thresholdPoints: 2000 },
      { level: "platinum", thresholdPoints: 5000 },
    ],
    rule: {
      regionId: GROWTH_REGION_ID,
      currency: "SYP",
      // 1 pt / SYP 100 — a region value, not the code default.
      pointsPerCurrencyUnit: 0.01,
      redemptionThresholdPoints: 500,
      redemptionRate: 10,
    },
    ...overrides,
  };
}

export function pointsTransactions(): PointsTransaction[] {
  return [
    {
      pointsTransactionId: "aaaa1111-1111-4111-8111-111111111111",
      type: "accrual",
      points: 275,
      rideId: "11111111-1111-4111-8111-111111111111",
      challengeId: null,
      walletTransactionId: null,
      createdAt: "2026-10-16T12:00:00Z",
    },
    {
      pointsTransactionId: "aaaa2222-2222-4222-8222-222222222222",
      type: "challenge",
      points: 300,
      rideId: null,
      challengeId: "cccc1111-1111-4111-8111-111111111111",
      walletTransactionId: null,
      createdAt: "2026-10-13T18:00:00Z",
    },
    {
      pointsTransactionId: "aaaa3333-3333-4333-8333-333333333333",
      type: "redemption",
      points: -500,
      rideId: null,
      challengeId: null,
      walletTransactionId: "dddd1111-1111-4111-8111-111111111111",
      createdAt: "2026-10-10T10:00:00Z",
    },
  ];
}

export function pointsPage(items: PointsTransaction[] = pointsTransactions()) {
  return { items, page: 0, size: 20, totalItems: items.length };
}

export function gamificationView(
  overrides: Partial<GamificationView> = {},
): GamificationView {
  return {
    badges: [
      { badgeCode: "ride_10", earned: true, awardedAt: "2026-09-21T10:00:00Z" },
      { badgeCode: "ride_50", earned: false, awardedAt: null },
      { badgeCode: "ride_100", earned: false, awardedAt: null },
      {
        badgeCode: "first_shared_ride",
        earned: true,
        awardedAt: "2026-10-08T15:00:00Z",
      },
      {
        badgeCode: "first_referral",
        earned: true,
        awardedAt: "2026-10-12T16:30:00Z",
      },
      { badgeCode: "five_star_week", earned: false, awardedAt: null },
    ],
    level: "silver",
    lifetime: 1740,
    levels: loyaltyBalance().levels,
    ...overrides,
  };
}

export function challengeView(
  overrides: Partial<ChallengeView> = {},
): ChallengeView {
  return {
    challengeId: "cccc2222-2222-4222-8222-222222222222",
    titleEn: "Weekend rider",
    titleAr: "راكب نهاية الأسبوع",
    goalType: "completed_rides",
    goalTarget: 5,
    rewardPoints: 300,
    startsAt: "2026-10-16T00:00:00Z",
    endsAt: "2026-10-18T23:59:00Z",
    ended: false,
    myProgress: 3,
    myCompleted: false,
    ...overrides,
  };
}

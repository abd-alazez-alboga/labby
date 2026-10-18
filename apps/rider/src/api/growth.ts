import { ApiError, apiFetch } from "./http-client";

/**
 * Client slice of the growth contract for the rider app
 * (backend/docs/api/growth-v1.yaml, M13): promo validation before booking,
 * referrals, loyalty points, badges / levels and challenges. Types mirror
 * the contract schemas 1:1; screens never call fetch themselves.
 */

// --------------------------------------------------------------- schemas

export type PromoType = "percent" | "fixed";

export interface ValidatePromoRequest {
  code: string;
  regionId: string;
  serviceTypeId: string;
  /** Drives the discount preview; omitted for a scheduled booking. */
  estimateTotal?: number;
  /** Present for a scheduled booking (ruling 3: discount at ride time). */
  scheduledAt?: string;
}

/** A valid promo's terms (`PromoValidation`). */
export interface PromoValidation {
  code: string;
  type: PromoType;
  /** Percent 0–100 or fixed amount in the region currency. */
  value: number;
  maxDiscount?: number | null;
  /** Against `estimateTotal`; null for a scheduled booking. */
  discountPreview?: number | null;
}

export type ReferralRefereeStatus = "pending" | "rewarded" | "blocked";

/** The named region's referral reward, both sides, in the region currency. */
export interface ReferralReward {
  regionId: string;
  currency: string;
  referrerAmount: number;
  refereeAmount: number;
}

/** The caller's referral picture (`ReferralStatus`). */
export interface ReferralStatus {
  /** The caller's share code — created on first read. */
  code: string;
  /** The code the caller entered as a referee, if any. */
  enteredCode?: string | null;
  /** The requested region's amounts; null when no regionId was given. */
  reward?: ReferralReward | null;
  /** Newest first — status only, never phone or full name. */
  referees: {
    firstName?: string | null;
    status: ReferralRefereeStatus;
    createdAt: string;
    rewardedAt?: string | null;
  }[];
}

export type GrowthLevel = "bronze" | "silver" | "gold" | "platinum";

/** One rung of the level ladder (GAME-03), lifetime points. */
export interface LevelThreshold {
  level: GrowthLevel;
  thresholdPoints: number;
}

/** The region's loyalty knobs (ruling 4) — never hardcoded client-side. */
export interface LoyaltyRule {
  regionId: string;
  currency: string;
  pointsPerCurrencyUnit: number;
  redemptionThresholdPoints: number;
  /** Wallet credit per point. */
  redemptionRate: number;
}

export interface LoyaltyBalance {
  redeemable: number;
  lifetime: number;
  level: GrowthLevel;
  levels: LevelThreshold[];
  rule: LoyaltyRule;
}

export type PointsTransactionType =
  | "accrual"
  | "redemption"
  | "challenge"
  | "adjustment";

export interface PointsTransaction {
  pointsTransactionId: string;
  type: PointsTransactionType;
  /** Signed. */
  points: number;
  rideId?: string | null;
  challengeId?: string | null;
  walletTransactionId?: string | null;
  createdAt: string;
}

export interface PointsTransactionPage {
  items: PointsTransaction[];
  page: number;
  size: number;
  totalItems: number;
}

export const BADGE_CODES = [
  "ride_10",
  "ride_50",
  "ride_100",
  "first_shared_ride",
  "first_referral",
  "five_star_week",
] as const;
export type BadgeCode = (typeof BADGE_CODES)[number];

/** The caller's badges and level as one role (`GamificationView`). */
export interface GamificationView {
  /** The whole catalog in sort order, earned or not. */
  badges: { badgeCode: BadgeCode; earned: boolean; awardedAt?: string | null }[];
  level: GrowthLevel;
  /** Riders — loyalty earned; drivers — trips + challenge points. */
  lifetime: number;
  levels: LevelThreshold[];
}

export type ChallengeGoalType =
  | "completed_rides"
  | "shared_rides"
  | "five_star_ratings";

/** One challenge with the caller's progress (`ChallengeView`). */
export interface ChallengeView {
  challengeId: string;
  titleEn: string;
  titleAr: string;
  goalType: ChallengeGoalType;
  goalTarget: number;
  rewardPoints: number;
  startsAt: string;
  endsAt: string;
  /** True once past `endsAt` or ended early. */
  ended: boolean;
  myProgress: number;
  myCompleted: boolean;
}

// ----------------------------------------------------------------- levels

/**
 * The next rung above `lifetime`, or null at the top — with how far the
 * ladder segment has been climbed (0…1) for the progress bar.
 */
export function nextLevel(
  levels: LevelThreshold[],
  lifetime: number,
): { level: GrowthLevel; remaining: number; progress: number } | null {
  const sorted = [...levels].sort((a, b) => a.thresholdPoints - b.thresholdPoints);
  const next = sorted.find((rung) => rung.thresholdPoints > lifetime);
  if (!next) return null;
  const previous = [...sorted]
    .reverse()
    .find((rung) => rung.thresholdPoints <= lifetime);
  const floor = previous?.thresholdPoints ?? 0;
  const span = next.thresholdPoints - floor;
  return {
    level: next.level,
    remaining: next.thresholdPoints - lifetime,
    progress: span > 0 ? Math.min(1, Math.max(0, (lifetime - floor) / span)) : 0,
  };
}

// ----------------------------------------------------------------- errors

export type PromoErrorKey =
  | "notFound"
  | "window"
  | "exhausted"
  | "userLimit"
  | "firstRideOnly"
  | "wrongRegion"
  | "wrongService"
  | "alreadyApplied"
  | "generic";

/** The machine codes of the promo refusals (growth-v1) → their copy. */
const PROMO_ERROR_CODES: Record<string, PromoErrorKey> = {
  promo_not_found: "notFound",
  promo_window: "window",
  promo_exhausted: "exhausted",
  promo_user_limit: "userLimit",
  promo_first_ride_only: "firstRideOnly",
  promo_wrong_region: "wrongRegion",
  promo_wrong_service: "wrongService",
  promo_already_applied: "alreadyApplied",
};

/**
 * Classifies a refused promo code (the validate 404/409s, or the same codes
 * failing a booking). Returns null for errors that are not about the promo,
 * so booking screens keep their own error handling for everything else.
 */
export function promoErrorKey(error: unknown): PromoErrorKey | null {
  if (!(error instanceof ApiError)) return null;
  const code = error.body?.code;
  if (code && code in PROMO_ERROR_CODES) return PROMO_ERROR_CODES[code];
  return null;
}

// ------------------------------------------------------------- endpoints

function json(body: unknown): string {
  return JSON.stringify(body);
}

/**
 * `POST /promos/validate` — the terms when valid now for this context
 * (UC-R-04 A1); 404 `promo_not_found`, 409 with the `promo_*` codes above.
 * The estimate stays promo-free: this preview is the only pre-ride number.
 */
export function validatePromo(
  request: ValidatePromoRequest,
): Promise<PromoValidation> {
  return apiFetch<PromoValidation>("/api/v1/promos/validate", {
    method: "POST",
    auth: true,
    body: json(request),
  });
}

/**
 * `GET /referrals/me` — the share code (created on first read) + referees
 * (UC-R-18); with `regionId`, `reward` carries that region's amounts.
 */
export function getReferralStatus(regionId?: string): Promise<ReferralStatus> {
  const query = regionId ? `?regionId=${encodeURIComponent(regionId)}` : "";
  return apiFetch<ReferralStatus>(`/api/v1/referrals/me${query}`, {
    auth: true,
  });
}

/** `GET /loyalty` — balance, level and the region redemption rule (UC-R-19). */
export function getLoyalty(regionId: string): Promise<LoyaltyBalance> {
  return apiFetch<LoyaltyBalance>(
    `/api/v1/loyalty?regionId=${encodeURIComponent(regionId)}`,
    { auth: true },
  );
}

export const POINTS_HISTORY_PAGE_SIZE = 20;

/** `GET /loyalty/transactions` — points history, newest first. */
export function listPointsTransactions(
  page = 0,
): Promise<PointsTransactionPage> {
  return apiFetch<PointsTransactionPage>(
    `/api/v1/loyalty/transactions?page=${page}&size=${POINTS_HISTORY_PAGE_SIZE}`,
    { auth: true },
  );
}

/**
 * `POST /loyalty/redeem` — points into a wallet credit (UC-R-19); 403
 * `account_suspended`, 409 `below_threshold` | `insufficient_points`.
 */
export function redeemPoints(
  regionId: string,
  points: number,
): Promise<LoyaltyBalance> {
  return apiFetch<LoyaltyBalance>("/api/v1/loyalty/redeem", {
    method: "POST",
    auth: true,
    body: json({ regionId, points }),
  });
}

/** `GET /gamification/me?as=rider` — badges and level (UC-S-23). */
export function getGamification(): Promise<GamificationView> {
  return apiFetch<GamificationView>("/api/v1/gamification/me?as=rider", {
    auth: true,
  });
}

/** `GET /challenges` — the region's rider challenges with my progress (UC-S-24). */
export function listChallenges(regionId: string): Promise<ChallengeView[]> {
  return apiFetch<ChallengeView[]>(
    `/api/v1/challenges?regionId=${encodeURIComponent(regionId)}&as=rider`,
    { auth: true },
  );
}

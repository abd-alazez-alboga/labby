/**
 * Types mirroring the M13 growth contract (backend/docs/api/growth-v1.yaml) —
 * the DRIVER slice: badges + level (UC-S-23/24, GAME-01/03) and challenges
 * with the caller's progress (GAME-02). Import-free.
 */

/** The fixed V24 badge catalog, in sort order. */
export type BadgeCode =
  | "ride_10"
  | "ride_50"
  | "ride_100"
  | "first_shared_ride"
  | "first_referral"
  | "five_star_week";

export type GrowthLevel = "bronze" | "silver" | "gold" | "platinum";

/** One catalog badge, earned or not. */
export interface BadgeView {
  badgeCode: BadgeCode;
  earned: boolean;
  awardedAt?: string | null;
}

/** One rung of the level ladder (lifetime points). */
export interface LevelStep {
  level: GrowthLevel;
  thresholdPoints: number;
}

/**
 * `GET /gamification/me?as=driver` — the whole badge catalog with earned
 * flags, the level and the ladder. For drivers `lifetime` counts trips +
 * challenge points; it never decreases.
 */
export interface GamificationView {
  badges: BadgeView[];
  level: GrowthLevel;
  lifetime: number;
  /** Driver view only (amended at T4 sign-off): completed trips; null for riders. */
  driverTrips?: number | null;
  /** Driver view only: points earned from challenges; null for riders. */
  challengePoints?: number | null;
  levels: LevelStep[];
}

export type ChallengeGoalType =
  | "completed_rides"
  | "shared_rides"
  | "five_star_ratings";

/** One challenge of the caller's region and role, with the caller's progress. */
export interface ChallengeView {
  challengeId: string;
  titleEn: string;
  titleAr: string;
  goalType: ChallengeGoalType;
  goalTarget: number;
  rewardPoints: number;
  startsAt: string;
  endsAt: string;
  /** True once past endsAt or ended early by an admin. */
  ended: boolean;
  myProgress: number;
  myCompleted: boolean;
}

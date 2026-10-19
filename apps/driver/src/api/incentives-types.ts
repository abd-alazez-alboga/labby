/**
 * Types mirroring the M15 incentives contract
 * (backend/docs/api/incentives-v1.yaml) — the driver's live weekly progress
 * (DRV-08, UC-D-17). Money is the server's exact decimal in the region
 * currency; times are region-local `HH:MM:SS`. Import-free.
 */

/** A weekly trip tier: reaching `trips` this week pays `amount`. */
export interface IncentiveTier {
  trips: number;
  amount: number;
}

/** A peak-hour window — ISO days (1 = Monday … 7 = Sunday), region-local times. */
export interface PeakWindow {
  daysOfWeek: number[];
  startsAt: string;
  /** Before `startsAt` = the window runs past midnight. */
  endsAt: string;
}

/** Weekly trip bonus progress — the highest tier reached pays (ruling Q2). */
export interface WeeklyTripsProgress {
  trips: number;
  /** Ascending by trips. */
  tiers: IncentiveTier[];
  reachedTier?: IncentiveTier | null;
  nextTier?: IncentiveTier | null;
}

/** Peak-hour bonus progress — a trip REQUESTED inside a window earns it. */
export interface PeakProgress {
  bonusPerTrip: number;
  windows: PeakWindow[];
  activeNow: boolean;
  /** End of the window in force now (`HH:MM:SS`); null when not active. */
  activeUntil?: string | null;
  trips: number;
  /** trips × bonusPerTrip so far (paid Monday). */
  earned: number;
}

/** Weekly rating reward progress (ruling Q4). */
export interface RatingProgress {
  amount: number;
  minAvgRating: number;
  minWeeklyTrips: number;
  /** 2 decimals; null without ratings this week. */
  average?: number | null;
  ratingCount: number;
  trips: number;
  qualifies: boolean;
}

export type IncentiveKind = "weekly_trips" | "peak_hours" | "rating";

/** One paid incentive (newest week first in `recentAwards`). */
export interface IncentiveAward {
  /** The paid week's Monday (`YYYY-MM-DD`). */
  weekStart: string;
  kind: IncentiveKind;
  amount: number;
  currency: string;
  trips: number;
  threshold?: number | null;
  avgRating?: number | null;
  awardedAt: string;
}

/**
 * `GET /driver/incentives?regionId` — this week's progress in the region.
 * `configured: false` (the empty board) leaves the three blocks null.
 */
export interface IncentiveProgress {
  regionId: string;
  regionName: string;
  configured: boolean;
  currency?: string | null;
  /** This week's Monday (`YYYY-MM-DD`, region zone). */
  weekStart: string;
  /** This week's Sunday. */
  weekEnd: string;
  timeZone: string;
  weeklyTrips?: WeeklyTripsProgress | null;
  peak?: PeakProgress | null;
  rating?: RatingProgress | null;
  recentAwards: IncentiveAward[];
}

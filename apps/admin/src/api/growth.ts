import type { ApiClient } from './client';

/**
 * Contract types and calls for the M13 growth admin endpoints (UC-A-26/28).
 * Source of truth: backend/docs/api/growth-v1.yaml. Promos are gated by
 * `promos:view` / `promos:manage`, challenges by `challenges:view` /
 * `challenges:manage`; every mutation is audit-logged server-side. Decimal
 * amounts travel as strings.
 */

export type PromoType = 'percent' | 'fixed';

export interface Promo {
  promoId: string;
  code: string;
  regionId?: string | null;
  serviceTypeId?: string | null;
  type: PromoType;
  /** Decimal — percent 0–100 or fixed amount in the region currency. */
  value: string;
  maxDiscount?: string | null;
  startsAt: string;
  endsAt: string;
  perUserLimit: number;
  totalCap?: number | null;
  firstRideOnly: boolean;
  active: boolean;
  redemptionCount: number;
  /** Sum of applied discounts (single-currency promos only). */
  redeemedAmount?: string | null;
}

export interface PromoPage {
  items: Promo[];
  page: number;
  size: number;
  totalItems: number;
}

export interface SavePromoRequest {
  code: string;
  regionId?: string | null;
  serviceTypeId?: string | null;
  type: PromoType;
  value: string;
  maxDiscount?: string | null;
  startsAt: string;
  endsAt: string;
  perUserLimit?: number;
  totalCap?: number | null;
  firstRideOnly?: boolean;
}

export interface PatchPromoRequest {
  regionId?: string | null;
  serviceTypeId?: string | null;
  maxDiscount?: string | null;
  startsAt?: string;
  endsAt?: string;
  perUserLimit?: number;
  totalCap?: number | null;
  firstRideOnly?: boolean;
  active?: boolean;
}

export type ChallengeRole = 'rider' | 'driver';
export type ChallengeGoalType = 'completed_rides' | 'shared_rides' | 'five_star_ratings';
export const CHALLENGE_GOAL_TYPES: readonly ChallengeGoalType[] = [
  'completed_rides',
  'shared_rides',
  'five_star_ratings',
];

export interface Challenge {
  challengeId: string;
  regionId: string;
  role: ChallengeRole;
  titleEn: string;
  titleAr: string;
  goalType: ChallengeGoalType;
  goalTarget: number;
  rewardPoints: number;
  startsAt: string;
  endsAt: string;
  endedAt?: string | null;
  participantCount: number;
  completedCount: number;
}

export interface ChallengePage {
  items: Challenge[];
  page: number;
  size: number;
  totalItems: number;
}

export interface SaveChallengeRequest {
  regionId: string;
  role: ChallengeRole;
  titleEn: string;
  titleAr: string;
  goalType: ChallengeGoalType;
  goalTarget: number;
  rewardPoints: number;
  startsAt: string;
  endsAt: string;
}

export interface ChallengeParticipant {
  userId: string;
  userName?: string;
  progress: number;
  completed: boolean;
  completedAt?: string | null;
}

export interface ChallengeDetail {
  challenge: Challenge;
  participation: {
    items: ChallengeParticipant[];
    page: number;
    size: number;
    totalItems: number;
  };
}

export interface PromoQuery {
  regionId?: string;
  active?: boolean;
  /** true = active AND the window contains now (M13 review W17). */
  running?: boolean;
  page?: number;
  size?: number;
}

function pageParams(query: { page?: number; size?: number }): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(query.page ?? 0));
  params.set('size', String(query.size ?? 20));
  return params;
}

/** GET /admin/promos — newest first with redemption counters; promos:view. */
export function listPromos(client: ApiClient, query: PromoQuery = {}): Promise<PromoPage> {
  const params = pageParams(query);
  if (query.regionId) {
    params.set('regionId', query.regionId);
  }
  if (query.active !== undefined) {
    params.set('active', String(query.active));
  }
  if (query.running !== undefined) {
    // W17: active AND the window contains now (growth-v1).
    params.set('running', String(query.running));
  }
  return client.get<PromoPage>(`/api/v1/admin/promos?${params.toString()}`);
}

/** POST /admin/promos — promos:manage, audited; 409 `promo_code_taken`, 422 `fixed_needs_region` | `window_invalid`. */
export function createPromo(client: ApiClient, body: SavePromoRequest): Promise<Promo> {
  return client.post<Promo>('/api/v1/admin/promos', body);
}

/**
 * PATCH /admin/promos/{promoId} — promos:manage, audited. `{active:false}`
 * deactivates: new redemptions are refused, reserved rides keep theirs.
 */
export function patchPromo(
  client: ApiClient,
  promoId: string,
  body: PatchPromoRequest,
): Promise<Promo> {
  return client.patch<Promo>(`/api/v1/admin/promos/${promoId}`, body);
}

/** GET /admin/challenges — newest first with participation counters; challenges:view. */
export function listChallenges(
  client: ApiClient,
  query: { regionId?: string; page?: number; size?: number } = {},
): Promise<ChallengePage> {
  const params = pageParams(query);
  if (query.regionId) {
    params.set('regionId', query.regionId);
  }
  return client.get<ChallengePage>(`/api/v1/admin/challenges?${params.toString()}`);
}

/** POST /admin/challenges — challenges:manage, audited; 422 `window_invalid`. */
export function createChallenge(client: ApiClient, body: SaveChallengeRequest): Promise<Challenge> {
  return client.post<Challenge>('/api/v1/admin/challenges', body);
}

/** GET /admin/challenges/{challengeId} — one participation page; challenges:view. */
export function getChallenge(
  client: ApiClient,
  challengeId: string,
  query: { page?: number; size?: number } = {},
): Promise<ChallengeDetail> {
  return client.get<ChallengeDetail>(
    `/api/v1/admin/challenges/${challengeId}?${pageParams(query).toString()}`,
  );
}

/**
 * POST /admin/challenges/{challengeId}/end — challenges:manage, audited; 409
 * `already_ended`. Completions already made keep their reward.
 */
export function endChallenge(client: ApiClient, challengeId: string): Promise<Challenge> {
  return client.post<Challenge>(`/api/v1/admin/challenges/${challengeId}/end`);
}

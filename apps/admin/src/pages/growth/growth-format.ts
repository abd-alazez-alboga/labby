import type { ChipTone } from '../../ui';
import type { Challenge, Promo } from '../../api/growth';
import { formatDay, formatNumber, latinLocale } from '../money/money-format';

/**
 * Pure display helpers for the M13 growth pages (artboards "A13Promos" /
 * "A13Challenges" / "A13ChallengeDetail", owner-approved 2026-10-18).
 */

export type PromoStatus = 'active' | 'scheduled' | 'ended' | 'deactivated';

/** Status from the row itself: deactivated wins, then the window. */
export function promoStatus(promo: Promo, now: number = Date.now()): PromoStatus {
  if (!promo.active) {
    return 'deactivated';
  }
  if (Date.parse(promo.startsAt) > now) {
    return 'scheduled';
  }
  if (Date.parse(promo.endsAt) < now) {
    return 'ended';
  }
  return 'active';
}

export const PROMO_STATUS_TONES: Record<PromoStatus, ChipTone> = {
  active: 'success',
  scheduled: 'warning',
  ended: 'neutral',
  deactivated: 'danger',
};

/** "1 Oct – 30 Nov" in latin digits either language. */
export function windowLabel(startsAt: string, endsAt: string, language: string): string {
  return `${formatDay(startsAt, language)} – ${formatDay(endsAt, language)}`;
}

/** A contract decimal string as a localized number ("8000" → "8,000"); raw when unparsable. */
export function formatDecimal(value: string, language: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  try {
    return new Intl.NumberFormat(latinLocale(language)).format(parsed);
  } catch {
    return value;
  }
}

/** The challenge's lifecycle for the status chip. */
export type ChallengeStatus = 'active' | 'scheduled' | 'ended' | 'endedEarly';

export function challengeStatus(challenge: Challenge, now: number = Date.now()): ChallengeStatus {
  if (challenge.endedAt) {
    return 'endedEarly';
  }
  if (Date.parse(challenge.startsAt) > now) {
    return 'scheduled';
  }
  if (Date.parse(challenge.endsAt) < now) {
    return 'ended';
  }
  return 'active';
}

export const CHALLENGE_STATUS_TONES: Record<ChallengeStatus, ChipTone> = {
  active: 'success',
  scheduled: 'warning',
  ended: 'neutral',
  endedEarly: 'danger',
};

/** "Points granted" on the detail page: completions × reward, never a backend field. */
export function pointsGranted(challenge: Challenge, language: string): string {
  return formatNumber(challenge.completedCount * challenge.rewardPoints, language);
}

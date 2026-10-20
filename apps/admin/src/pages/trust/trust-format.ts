import type { TFunction } from 'i18next';

import { ApiError } from '../../api/client';
import type {
  AccountFlag,
  AdminUserTrust,
  MetricWarning,
  ReportStatus,
  SuspensionAction,
} from '../../api/trust';
import type { ChipTone } from '../../ui';
import { formatNumber, latinLocale } from '../money/money-format';
import { classifyError } from '../onboarding/review-utils';

/** Pure display helpers behind the M11 trust screens (UC-A-13/14/16/17). */

/** The account-state chip tone of the user profile header (trust and history tabs). */
export const ACCOUNT_TONES: Record<AdminUserTrust['accountState'], ChipTone> = {
  active: 'success',
  suspended: 'danger',
  deleted: 'neutral',
};

/** A rating average with exactly 2 decimals, Western digits (e.g. "3.38"). */
export function formatRating(value: number, language: string): string {
  return new Intl.NumberFormat(latinLocale(language), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** How long a queue item has waited: minutes, hours, then days (e.g. "2 d"). */
export function waitingParts(since: string, nowMs: number = Date.now()) {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(since)) / 60_000));
  if (minutes < 60) {
    return { unit: 'minutes' as const, count: minutes };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { unit: 'hours' as const, count: hours };
  }
  return { unit: 'days' as const, count: Math.floor(hours / 24) };
}

export const REPORT_STATUS_TONES: Record<ReportStatus, ChipTone> = {
  open: 'neutral',
  substantiated: 'warning',
  unsubstantiated: 'neutral',
};

/** The DRV-07 rule a metric warning (or flag) fired on, in one line. */
export function metricRule(
  t: TFunction,
  language: string,
  warning: Pick<
    MetricWarning,
    'metric' | 'valuePercent' | 'thresholdPercent' | 'windowDays' | 'sampleSize'
  >,
): string {
  return t(`trust.rule.${warning.metric}`, {
    value: formatNumber(warning.valuePercent, language),
    threshold: formatNumber(warning.thresholdPercent, language),
    sample: warning.sampleSize,
    days: warning.windowDays,
  });
}

/** The triggering rule of a flag, rendered from its kind-shaped `details`. */
export function flagRule(t: TFunction, language: string, flag: AccountFlag): string {
  switch (flag.kind) {
    case 'low_rating':
      return t('trust.rule.lowRating', {
        average: formatRating(flag.details.average, language),
        warn: formatNumber(flag.details.warnAvgRating, language),
        count: flag.details.ratingCount,
      });
    case 'metric_warning':
      return metricRule(t, language, flag.details);
    case 'report_threshold':
      return t('trust.rule.reportThreshold', {
        count: flag.details.substantiatedCount,
        days: flag.details.windowDays,
        threshold: flag.details.threshold,
      });
  }
}

/** The domain error code of a 409 (ErrorResponse.code), if any. */
export function conflictCode(error: unknown): string | null {
  return error instanceof ApiError && error.status === 409 ? (error.code ?? null) : null;
}

const SUSPENSION_CONFLICTS = [
  'already_suspended',
  'not_suspended',
  'document_expired',
  'admin_account',
  'account_deleted',
] as const;

/** i18n key for a failed suspend/reactivate, with clear copy per 409 code. */
export function suspensionErrorKey(error: unknown): string {
  const code = conflictCode(error);
  if (code && (SUSPENSION_CONFLICTS as readonly string[]).includes(code)) {
    return `trust.errors.${code}`;
  }
  return decisionErrorKey(error);
}

/** i18n key for a failed trust decision that is not a known 409. */
export function decisionErrorKey(error: unknown): string {
  switch (classifyError(error)) {
    case 'validation':
      return 'trust.errors.validation';
    case 'network':
      return 'review.decisionErrors.network';
    case 'forbidden':
      return 'review.decisionErrors.forbidden';
    case 'notFound':
      return 'review.decisionErrors.notFound';
    case 'conflict':
      return 'trust.errors.conflict';
    default:
      return 'review.decisionErrors.server';
  }
}

/**
 * The suspend/reactivate actions the profile offers right now (UC-A-14):
 * reactivate a suspended account or role (never a `document_expired` role —
 * only an approved renewal lifts it), suspend an active or automatically
 * suspended role, or the whole account. A deleted account offers nothing.
 */
export function availableActions(trust: AdminUserTrust): SuspensionAction[] {
  if (trust.accountState === 'deleted') {
    return [];
  }
  const actions: SuspensionAction[] = [];
  if (trust.accountState === 'suspended') {
    actions.push({ kind: 'reactivateAccount' });
  }
  for (const role of trust.roles) {
    if (role.state === 'suspended' && role.suspensionReason !== 'document_expired') {
      actions.push({ kind: 'reactivateRole', role: role.role });
    }
  }
  for (const role of trust.roles) {
    // Suspending an automatic suspension (low rating, document expiry)
    // replaces its reason with `manual` (contract); a manual one would be a
    // 409. Reactivation still keeps a driver with an expired document
    // suspended (backend), so this opens no DRV-04 bypass.
    if (role.state === 'active' || role.suspensionReason !== 'manual') {
      actions.push({ kind: 'suspendRole', role: role.role });
    }
  }
  if (trust.accountState === 'active') {
    actions.push({ kind: 'suspendAccount' });
  }
  return actions;
}

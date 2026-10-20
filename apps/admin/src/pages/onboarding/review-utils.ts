import { ApiError } from '../../api/client';
import type { DriverDocument, FileRef, ServiceTypeRef } from '../../api/onboarding';
import { latinLocale } from '../money/money-format';

/**
 * Shared, framework-free helpers for the M5 review screens: error
 * classification (network vs server vs contract statuses), calendar-date
 * expiry checks, and the refresh schedule for expiring file URLs.
 */

export type FailureKind =
  'network' | 'server' | 'notFound' | 'forbidden' | 'conflict' | 'validation';

/** A thrown fetch error is a network failure; an ApiError carries the server's status. */
export function classifyError(error: unknown): FailureKind {
  if (!(error instanceof ApiError)) {
    return 'network';
  }
  switch (error.status) {
    case 400:
      return 'validation';
    case 403:
      return 'forbidden';
    case 404:
      return 'notFound';
    case 409:
      return 'conflict';
    default:
      return 'server';
  }
}

/** Today's calendar date in the admin's browser, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** A document is valid THROUGH `expiresOn` (contract) — expired once today is later. */
export function isExpired(expiresOn: string, today: string = todayIso()): boolean {
  return expiresOn < today;
}

export function anyExpired(documents: readonly DriverDocument[]): boolean {
  const today = todayIso();
  return documents.some((document) => isExpired(document.expiresOn, today));
}

/** Refresh this long before the earliest URL expires… */
export const URL_REFRESH_LEAD_MS = 30_000;
/** …but never sooner than this (guards against clock skew and very short TTLs). */
export const URL_REFRESH_MIN_MS = 15_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Milliseconds until a resource's file URLs should be re-minted (by
 * refetching it), or null when it shows no files. Driven by the earliest
 * `urlExpiresAt` so no visible link outlives its token.
 */
export function nextRefreshDelay(files: readonly FileRef[], nowMs: number = Date.now()) {
  const expiries = files
    .map((file) => Date.parse(file.urlExpiresAt))
    .filter((value) => !Number.isNaN(value));
  if (expiries.length === 0) {
    return null;
  }
  const delay = Math.min(...expiries) - nowMs - URL_REFRESH_LEAD_MS;
  return Math.min(Math.max(delay, URL_REFRESH_MIN_MS), MAX_TIMEOUT_MS);
}

export function formatDateTime(value: string | null | undefined, language: string): string {
  return value ? new Date(value).toLocaleString(latinLocale(language)) : '—';
}

/** A service type's name in the UI language. */
export function serviceTypeName(type: ServiceTypeRef, language: string): string {
  return language === 'ar' ? type.nameAr : type.nameEn;
}

/** A conflict (409) diagnosis: the i18n key plus, for "already decided", the new state. */
export interface ConflictDiagnosis {
  key: string;
  /** i18n key of the state the item moved to, when another reviewer won. */
  stateKey?: string;
}

/** i18n key for a failed decision that is NOT a 409 (those are diagnosed per page). */
export function decisionFailureKey(kind: FailureKind): string {
  switch (kind) {
    case 'network':
      return 'review.decisionErrors.network';
    case 'forbidden':
      return 'review.decisionErrors.forbidden';
    case 'notFound':
      return 'review.decisionErrors.notFound';
    case 'validation':
      return 'review.decisionErrors.validation';
    case 'conflict':
      return 'review.conflict.generic';
    default:
      return 'review.decisionErrors.server';
  }
}

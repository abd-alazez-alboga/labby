import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { AccountState, ApplicationStatus } from '../../api/analytics';
import type { ChipTone } from '../../ui';
import { dayBounds } from '../rides/rides-search';

/** The page size of the M15 users / drivers / transactions lists. */
export const DIRECTORY_PAGE_SIZE = 20;

/**
 * URL-backed list filters, like the rides and support queues: returning from
 * a detail page keeps them. `update` drops empty values and any change other
 * than the page itself resets the page.
 */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
      }
      if (!('page' in changes)) {
        next.delete('page');
      }
      setParams(next);
    },
    [params, setParams],
  );
  const page = Math.max(0, Number(params.get('page')) || 0);
  return { params, update, page };
}

/** `from` / `to` instants of an inclusive local-day range (either end optional). */
export function dayRange(fromDay: string, toDay: string): { from?: string; to?: string } {
  return {
    from: fromDay ? dayBounds(fromDay)?.from : undefined,
    to: toDay ? dayBounds(toDay)?.to : undefined,
  };
}

/** The value when it is one of the allowed ones, else undefined. */
export function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export const ACCOUNT_TONES: Record<AccountState, ChipTone> = {
  active: 'success',
  suspended: 'danger',
  deleted: 'neutral',
};

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'approved',
  'under_review',
  'needs_changes',
  'submitted',
  'rejected',
  'withdrawn',
];

export const APPLICATION_TONES: Record<ApplicationStatus, ChipTone> = {
  approved: 'success',
  under_review: 'accent',
  needs_changes: 'warning',
  submitted: 'accent',
  rejected: 'danger',
  withdrawn: 'neutral',
};

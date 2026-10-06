import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/client';
import { resolveFileUrl } from '../api/onboarding';
import {
  classifyError,
  isExpired,
  nextRefreshDelay,
  URL_REFRESH_MIN_MS,
} from '../pages/onboarding/review-utils';
import { fileRef } from './onboarding-fixtures';

describe('secure file URLs (NFR-S2)', () => {
  it('resolves API-relative URLs against the runtime API base', () => {
    expect(resolveFileUrl('/api/v1/files/abc', 'http://localhost:8080')).toBe(
      'http://localhost:8080/api/v1/files/abc',
    );
    expect(resolveFileUrl('/api/v1/files/abc', 'https://ops.example/labby/')).toBe(
      'https://ops.example/labby/api/v1/files/abc',
    );
  });

  it('passes absolute (object-store) URLs through unchanged', () => {
    expect(resolveFileUrl('https://bucket.example/x?sig=1', 'http://localhost:8080')).toBe(
      'https://bucket.example/x?sig=1',
    );
  });

  it('schedules the refresh 30 s before the earliest expiry, never sooner than the floor', () => {
    const now = Date.parse('2026-10-06T10:00:00Z');
    const files = [
      fileRef('a', 'image/jpeg', '2026-10-06T10:05:00Z'),
      fileRef('b', 'image/jpeg', '2026-10-06T10:02:00Z'),
    ];
    expect(nextRefreshDelay(files, now)).toBe(90_000);
    // Already (or almost) expired — e.g. clock skew: wait the floor, don't spin.
    expect(nextRefreshDelay([fileRef('c', 'image/jpeg', '2026-10-06T09:00:00Z')], now)).toBe(
      URL_REFRESH_MIN_MS,
    );
    expect(nextRefreshDelay([], now)).toBeNull();
  });
});

describe('review helpers', () => {
  it('treats a document as valid through its expiry date', () => {
    expect(isExpired('2026-10-06', '2026-10-06')).toBe(false);
    expect(isExpired('2026-10-05', '2026-10-06')).toBe(true);
  });

  it('tells network failures from server statuses', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyError(new ApiError(500, '/x'))).toBe('server');
    expect(classifyError(new ApiError(409, '/x'))).toBe('conflict');
    expect(classifyError(new ApiError(404, '/x'))).toBe('notFound');
  });
});

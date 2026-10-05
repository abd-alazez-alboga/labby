import { describe, expect, it } from 'vitest';

import ar from '../i18n/ar.json';
import en from '../i18n/en.json';

/** Flattens a resource tree to dotted leaf keys. */
function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

/**
 * EN and AR ship together from day one: every key must exist in both
 * bundles, so a missing translation fails the build instead of leaking
 * English into the Arabic UI (or vice versa).
 */
describe('i18n key parity', () => {
  it('EN and AR expose exactly the same keys', () => {
    expect(flattenKeys(ar).sort()).toEqual(flattenKeys(en).sort());
  });
});

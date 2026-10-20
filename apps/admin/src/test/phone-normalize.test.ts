import { describe, expect, it } from 'vitest';

import { normalizePhone } from '../auth/phone';
import { classifyQuery } from '../pages/rides/rides-search';

/** V1 audit H3 (owner ruling): one E.164 form per handset, Syria by default. */
describe('normalizePhone', () => {
  it('turns a Syrian national mobile into E.164', () => {
    expect(normalizePhone('0933000111')).toBe('+963933000111');
    expect(normalizePhone('0933 000 111')).toBe('+963933000111');
    expect(normalizePhone('0933-000-111')).toBe('+963933000111');
  });

  it('turns the 00 and bare country-code forms into +963', () => {
    expect(normalizePhone('00963933000111')).toBe('+963933000111');
    expect(normalizePhone('963933000111')).toBe('+963933000111');
    expect(normalizePhone('963 933 000 111')).toBe('+963933000111');
  });

  it('keeps a + number, minus spaces and dashes', () => {
    expect(normalizePhone('+963933000111')).toBe('+963933000111');
    expect(normalizePhone(' +963 933-000-111 ')).toBe('+963933000111');
    expect(normalizePhone('+447700900123')).toBe('+447700900123');
  });

  it('leaves anything else for the server to judge', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('12345')).toBe('12345');
    // Not a 10-digit 09 mobile: no country code guessed.
    expect(normalizePhone('093300011')).toBe('093300011');
  });

  it('is idempotent', () => {
    for (const raw of ['0933000111', '00963933000111', '963933000111', '+963933000111']) {
      expect(normalizePhone(normalizePhone(raw))).toBe(normalizePhone(raw));
    }
  });

  it('feeds the rides phone search', () => {
    expect(classifyQuery(' 0933 000 111 ')).toEqual({ kind: 'phone', value: '+963933000111' });
  });
});

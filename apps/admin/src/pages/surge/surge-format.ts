/**
 * Surge display + input helpers (UC-A-09). Multipliers always render with
 * Western digits and at least one decimal ("2.0×", "1.25×"); inside a
 * translated sentence they are wrapped in an LTR isolate so the "×" never
 * detaches from its number in RTL text.
 */

import { latinLocale } from '../money/money-format';

/** The backend's scale: `@Digits(integer = 2, fraction = 2)`, at least 1.00. */
export const MIN_MULTIPLIER = 1;
export const MAX_MULTIPLIER = 99.99;

/** "2.0×" / "1.25×" in the UI locale with Western digits. */
export function formatMultiplier(value: number, language: string): string {
  const number = new Intl.NumberFormat(latinLocale(language), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
  return `${number}×`;
}

/** Wraps text in a left-to-right isolate (LRI … PDI) for use inside RTL sentences. */
export function isolateLtr(text: string): string {
  return `⁦${text}⁩`;
}

/** Wall-clock time, 24-hour ("12:42"), Western digits. */
export function formatClock(value: string, language: string): string {
  return new Date(value).toLocaleTimeString(latinLocale(language), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** A past moment: the clock when it is today, else day + clock ("8 Oct, 11:58"). */
export function formatSince(value: string, language: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (date.toDateString() === now.toDateString()) {
    return formatClock(value, language);
  }
  return date.toLocaleString(latinLocale(language), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/**
 * A zone's effective cap: the lower of its own cap and the region cap, when
 * set (the same rule the backend applies to computed values and overrides).
 */
export function effectiveCap(
  zoneCap: number | null | undefined,
  regionCap: number | null | undefined,
): number | null {
  const caps = [zoneCap, regionCap].filter((cap): cap is number => cap != null);
  return caps.length === 0 ? null : Math.min(...caps);
}

const MULTIPLIER = /^\d+(\.\d{1,2})?$/;

export type MultiplierParse = { value: number } | { error: 'format' | 'range' };

/**
 * Parses the manual-multiplier field like the money `parseAmount`: plain
 * digits with at most 2 decimals (no signs, exponents, grouping), then
 * range-checked against 1.0 … the effective cap (or the backend's 99.99).
 */
export function parseMultiplier(raw: string, cap: number | null): MultiplierParse {
  const trimmed = raw.trim();
  if (!MULTIPLIER.test(trimmed)) {
    return { error: 'format' };
  }
  const value = Number(trimmed);
  const max = cap ?? MAX_MULTIPLIER;
  if (value < MIN_MULTIPLIER || value > max) {
    return { error: 'range' };
  }
  return { value };
}

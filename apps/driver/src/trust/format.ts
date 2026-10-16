import { formatAmountValue, isolateDigits, pluralCategory } from "../money/format";

/**
 * Display helpers for the M11 trust screens. Western digits in both
 * languages (owner ruling 2026-10-11); every number embedded in Arabic text
 * travels inside an LTR isolate so "46%" never reorders to "%46".
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "46%" / "4.5%" — the server's 1-decimal percent, isolated in Arabic. */
export function formatPercent(value: number, language: string): string {
  return isolateDigits(`${formatAmountValue(value, 1)}%`, language);
}

/** A whole count ("52", "1,204"), isolated in Arabic. */
export function formatCount(value: number, language: string): string {
  return isolateDigits(formatAmountValue(value, 0), language);
}

/** An average rating ("4.62", "3.0" stays "3"), isolated in Arabic. */
export function formatRating(value: number, language: string): string {
  return isolateDigits(formatAmountValue(value, 2), language);
}

/** A rating threshold — always one decimal ("3.0", "3.5"), isolated in Arabic. */
export function formatThreshold(value: number, language: string): string {
  let text: string;
  try {
    text = new Intl.NumberFormat("en-GB", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    text = String(value);
  }
  return isolateDigits(text, language);
}

/** Plural-correct count copy keyed by CLDR category (`<base>.<category>`). */
export function countCopy(
  t: Translate,
  base: string,
  count: number,
  language: string,
): string {
  return t(`${base}.${pluralCategory(count, language)}`, {
    value: formatCount(count, language),
  });
}

/** Whole days left until `windowEndsAt` (rounded up, never negative). */
export function daysLeft(windowEndsAt: string, now: number = Date.now()): number {
  const end = Date.parse(windowEndsAt);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / DAY_MS));
}

function locale(language: string): string {
  return language === "ar" ? "ar-u-nu-latn" : "en-GB";
}

/** "22 Oct" — local day + short month of an ISO date-time. */
export function formatDayMonth(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale(language), {
      day: "numeric",
      month: "short",
    }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

/** "22 Oct, 12:43" — local short date + time of an ISO date-time. */
export function formatDayMonthTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale(language), {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return iso;
  }
}

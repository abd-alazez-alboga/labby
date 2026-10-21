/**
 * Ride history filters (V1 audit W41, UC-R-16 — approved artboards
 * V1FRiderHistoryFilters / Dates / Empty): one chip at a time (All,
 * Completed, Cancelled, Scheduled, Shared) and an optional inclusive day
 * range, mapped onto the `GET /rides` `state` / `kind` / `from` / `to`
 * parameters (rides-v1.yaml). Days are `YYYY-MM-DD` calendar days of the
 * device; labels use Western digits (NFR-I2).
 */
import type { TranslateOptions } from "i18n-js";

import type { RideHistoryFilters } from "../api/rides";
import type { AppLocale } from "../i18n/translations";

type T = (key: string, options?: TranslateOptions) => string;

export const HISTORY_FILTERS = [
  "all",
  "completed",
  "cancelled",
  "scheduled",
  "shared",
] as const;

export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

/** An inclusive day range; null = no limit on that side. */
export interface DayRange {
  from: string | null;
  to: string | null;
}

export const NO_RANGE: DayRange = { from: null, to: null };

export function hasRange(range: DayRange): boolean {
  return range.from !== null || range.to !== null;
}

/** The `GET /rides` parameters of a chip and a range. */
export function historyParams(
  filter: HistoryFilter,
  range: DayRange,
): RideHistoryFilters {
  const params: RideHistoryFilters = {};
  if (filter === "completed" || filter === "cancelled") params.state = filter;
  if (filter === "scheduled" || filter === "shared") params.kind = filter;
  if (range.from) params.from = range.from;
  if (range.to) params.to = range.to;
  return params;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The device-local calendar day of `date` as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local noon of a `YYYY-MM-DD` day (safe from DST edges when formatting). */
export function dayDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

/** The day `delta` days after `key`. */
export function shiftDay(key: string, delta: number): string {
  const date = dayDate(key);
  date.setDate(date.getDate() + delta);
  return dayKey(date);
}

function format(
  key: string,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, options).format(
      dayDate(key),
    );
  } catch {
    return key;
  }
}

/** "Oct 1, 2026" — a date field of the range sheet. */
export function formatFieldDay(key: string, locale: AppLocale): string {
  return format(key, locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function dayOptions(keys: string[], now: Date): Intl.DateTimeFormatOptions {
  const thisYear = String(now.getFullYear());
  return keys.every((key) => key.startsWith(thisYear))
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
}

/** Both ends as short day labels, with the year once the range leaves this year. */
function rangeEnds(
  from: string,
  to: string,
  locale: AppLocale,
  now: Date,
): { from: string; to: string } {
  const options = dayOptions([from, to], now);
  return {
    from: format(from, locale, options),
    to: format(to, locale, options),
  };
}

function oneDay(key: string, locale: AppLocale, now: Date): string {
  return format(key, locale, dayOptions([key], now));
}

/**
 * Both ends in the locale's own compact range form ("Oct 1 – 5"), else
 * the two labels joined.
 */
function compactRange(
  from: string,
  to: string,
  locale: AppLocale,
  t: T,
  now: Date,
): string {
  try {
    const formatter = new Intl.DateTimeFormat(
      `${locale}-u-nu-latn`,
      dayOptions([from, to], now),
    );
    if (typeof formatter.formatRange === "function") {
      return formatter.formatRange(dayDate(from), dayDate(to));
    }
  } catch {
    // fall through to the joined labels
  }
  return t("history.range.both", rangeEnds(from, to, locale, now));
}

/** The range as a label ("Oct 1 – 5", "From Oct 1", "Until Oct 5"); null without one. */
export function formatRange(
  range: DayRange,
  locale: AppLocale,
  t: T,
  now: Date = new Date(),
): string | null {
  if (range.from && range.to) {
    return compactRange(range.from, range.to, locale, t, now);
  }
  if (range.from) {
    return t("history.range.since", { date: oneDay(range.from, locale, now) });
  }
  if (range.to) {
    return t("history.range.until", { date: oneDay(range.to, locale, now) });
  }
  return null;
}

/** The range inside a sentence ("from Oct 1 to Oct 5"); null without one. */
export function rangePhrase(
  range: DayRange,
  locale: AppLocale,
  t: T,
  now: Date = new Date(),
): string | null {
  if (range.from && range.to) {
    return t(
      "history.rangePhrase.both",
      rangeEnds(range.from, range.to, locale, now),
    );
  }
  if (range.from) {
    return t("history.rangePhrase.since", {
      date: oneDay(range.from, locale, now),
    });
  }
  if (range.to) {
    return t("history.rangePhrase.until", {
      date: oneDay(range.to, locale, now),
    });
  }
  return null;
}

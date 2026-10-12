import type { EarningsPeriod } from "../api/money-types";
import { fromIsoDate, toIsoDate } from "../onboarding/dates";

/**
 * Period-anchor stepping for the earnings summary (UC-D-15). The SERVER
 * resolves an anchor to its Monday-start week (region time zone) or
 * calendar month; these helpers only move the anchor between periods and
 * label the resolved range. Dates are device-local, like the document
 * expiry helpers — the server stays the authority.
 */

/** Monday of the device-local week containing `iso`. */
export function weekStartIso(iso: string): string {
  const date = fromIsoDate(iso);
  const sinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - sinceMonday);
  return toIsoDate(date);
}

/** First day of the month containing `iso`. */
export function monthStartIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** The anchor one period earlier (−1) or later (+1). */
export function stepAnchor(
  period: EarningsPeriod,
  anchorIso: string,
  direction: -1 | 1,
): string {
  if (period === "weekly") {
    const date = fromIsoDate(weekStartIso(anchorIso));
    date.setDate(date.getDate() + direction * 7);
    return toIsoDate(date);
  }
  const date = fromIsoDate(monthStartIso(anchorIso));
  date.setMonth(date.getMonth() + direction);
  return toIsoDate(date);
}

/** True when both dates fall in the same period bucket (device-local). */
export function samePeriod(
  period: EarningsPeriod,
  a: string,
  b: string,
): boolean {
  return period === "weekly"
    ? weekStartIso(a) === weekStartIso(b)
    : monthStartIso(a) === monthStartIso(b);
}

/** Western digits in both languages (owner ruling 2026-10-11). */
function dateLocale(language: string): string {
  return language === "ar" ? "ar-u-nu-latn" : "en-GB";
}

function formatDay(
  iso: string,
  language: string,
  withMonth: boolean,
): string {
  try {
    return new Intl.DateTimeFormat(dateLocale(language), {
      weekday: "short",
      day: "numeric",
      ...(withMonth ? { month: "short" } : {}),
    }).format(fromIsoDate(iso));
  } catch {
    return iso;
  }
}

/**
 * The stepper label: weekly "Mon 6 – Sun 12 Oct" (month on both ends when
 * they differ), monthly "October 2026".
 */
export function periodLabel(
  period: EarningsPeriod,
  fromIso: string,
  toIso: string,
  language: string,
): string {
  if (period === "monthly") {
    try {
      return new Intl.DateTimeFormat(dateLocale(language), {
        month: "long",
        year: "numeric",
      }).format(fromIsoDate(fromIso));
    } catch {
      return fromIso.slice(0, 7);
    }
  }
  const sameMonth = fromIso.slice(0, 7) === toIso.slice(0, 7);
  return `${formatDay(fromIso, language, !sameMonth)} – ${formatDay(toIso, language, true)}`;
}

/** The server-resolved range a local anchor WILL label while loading. */
export function localRange(
  period: EarningsPeriod,
  anchorIso: string,
): { from: string; to: string } {
  if (period === "weekly") {
    const from = weekStartIso(anchorIso);
    const end = fromIsoDate(from);
    end.setDate(end.getDate() + 6);
    return { from, to: toIsoDate(end) };
  }
  const from = monthStartIso(anchorIso);
  const end = fromIsoDate(from);
  end.setMonth(end.getMonth() + 1);
  end.setDate(0);
  return { from, to: toIsoDate(end) };
}

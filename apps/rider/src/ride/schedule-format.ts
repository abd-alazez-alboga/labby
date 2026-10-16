/**
 * Display helpers for the M12 screens: relative day labels ("Today",
 * "Tomorrow", "Sat 18 Oct") with the clock time, distances from the rider
 * and the soonest-due scheduled ride for the on-demand warning. Dates are
 * the device's local calendar days; numbers use Western digits.
 */
import type { TranslateOptions } from "i18n-js";

import type { LatLngPoint, Ride } from "../api/rides";
import type { AppLocale } from "../i18n/translations";
import { formatClock } from "./ride-format";

type T = (key: string, options?: TranslateOptions) => string;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of the given day. */
export function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** Whole calendar days from `now`'s day to `date`'s day (0 = today). */
export function dayOffset(date: Date, now: Date): number {
  return Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS,
  );
}

/** "Today" / "Tomorrow" / "Sat 18 Oct" (lower-case words inside a sentence). */
export function formatDayLabel(
  date: Date,
  locale: AppLocale,
  t: T,
  now: Date = new Date(),
  lower = false,
): string {
  const offset = dayOffset(date, now);
  if (offset === 0) return t(lower ? "m12.todayLower" : "m12.today");
  if (offset === 1) return t(lower ? "m12.tomorrowLower" : "m12.tomorrow");
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** "Tomorrow · 09:00" — a day label and the clock time. */
export function formatScheduleDay(
  value: string | Date,
  locale: AppLocale,
  t: T,
  now: Date = new Date(),
  lower = false,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return t("m12.dayTime", {
    day: formatDayLabel(date, locale, t, now, lower),
    time: formatClock(date, locale),
  });
}

/** "600 m" under a kilometre, else "1.4 km". */
export function formatDistance(meters: number, locale: AppLocale, t: T): string {
  if (meters < 1000) {
    const rounded = Math.max(0, Math.round(meters / 50) * 50);
    return t("m12.meters", { value: String(rounded) });
  }
  let value: string;
  try {
    value = new Intl.NumberFormat(`${locale}-u-nu-latn`, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(meters / 1000);
  } catch {
    value = (meters / 1000).toFixed(1);
  }
  return t("m12.km", { value });
}

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: LatLngPoint, b: LatLngPoint): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The scheduled ride due within the next `withinMinutes` (soonest first),
 * if any — the on-demand booking warning (owner ruling 2026-10-16).
 */
export function scheduledRideDueSoon(
  rides: Ride[],
  withinMinutes: number,
  now: Date = new Date(),
): Ride | null {
  const limit = now.getTime() + withinMinutes * 60 * 1000;
  const due = rides
    .filter((ride) => ride.state === "scheduled" && ride.scheduled)
    .map((ride) => ({
      ride,
      at: new Date(ride.scheduled?.scheduledAt ?? "").getTime(),
    }))
    .filter(({ at }) => Number.isFinite(at) && at >= now.getTime() && at <= limit)
    .sort((a, b) => a.at - b.at);
  return due[0]?.ride ?? null;
}

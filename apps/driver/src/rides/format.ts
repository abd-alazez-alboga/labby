import type { TFunction } from "i18next";

import type { Place } from "../api/ride-types";
import { formatMoney as formatAmount } from "../money/format";

/**
 * Display helpers for the ride screens. Numbers follow the app's locale
 * convention (Intl with `ar-u-nu-latn` / `en-GB`, as the onboarding dates
 * do — Western digits in Arabic, owner ruling 2026-10-11); money is ALWAYS
 * a stored server amount — nothing here computes a fare.
 */

/** Western digits in BOTH languages (owner ruling 2026-10-11). */
function locale(language: string): string {
  return language === "ar" ? "ar-u-nu-latn" : "en-GB";
}

export function formatNumber(
  value: number,
  language: string,
  maximumFractionDigits = 0,
): string {
  try {
    return new Intl.NumberFormat(locale(language), {
      maximumFractionDigits,
    }).format(value);
  } catch {
    return String(value);
  }
}

/**
 * "SYP 22,000" / "⁦22,000⁩ ل.س" — the stored amount, up to 2 decimals. One
 * money format app-wide (W20): the M8 formatter's Arabic currency label and
 * LTR isolate apply to the ride flow too.
 */
export function formatMoney(
  amount: number,
  currency: string,
  language: string,
): string {
  return formatAmount(amount, currency, language);
}

/** "350 m" below 1 km, "1.1 km" above. */
export function formatDistance(
  t: TFunction,
  meters: number,
  language: string,
): string {
  if (meters < 1000) {
    return t("ride.meters", {
      value: formatNumber(Math.max(0, Math.round(meters)), language),
    });
  }
  return t("ride.kilometers", {
    value: formatNumber(meters / 1000, language, 1),
  });
}

/** Whole minutes, at least 1 ("3 min"). */
export function formatMinutes(
  t: TFunction,
  seconds: number,
  language: string,
): string {
  return t("ride.minutes", {
    value: formatNumber(Math.max(1, Math.round(seconds / 60)), language),
  });
}

/** m:ss (or h:mm:ss) clock for timers; never negative. */
export function formatClock(ms: number, language: string): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) =>
    formatNumber(value, language).padStart(2, formatNumber(0, language));
  const head = hours > 0 ? `${formatNumber(hours, language)}:${two(minutes)}` : formatNumber(minutes, language);
  return `${head}:${two(seconds)}`;
}

/** The place's label, or a generic "pinned location". */
export function placeLabel(t: TFunction, place: Place): string {
  const label = place.label?.trim();
  return label ? label : t("ride.pinnedLocation");
}

/** Great-circle distance in meters (display hint only — the server judges arrival). */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local wall-clock time ("14:05") of an ISO date-time. */
export function formatTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale(language), {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return iso;
  }
}

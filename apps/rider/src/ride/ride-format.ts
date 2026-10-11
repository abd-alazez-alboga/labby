/**
 * Display helpers for the ride screens: money, distance, duration, clock
 * times, place labels, service-type names and the fare breakdown lines.
 *
 * The fare breakdown is built ONLY from stored `FareComponents` (PRC-04) —
 * nothing here adds, rounds or recomputes an amount; zero-valued optional
 * components are simply not listed.
 */
import type { TranslateOptions } from "i18n-js";

import type { FareComponents, Place } from "../api/rides";
import type { AppLocale } from "../i18n/translations";

type T = (key: string, options?: TranslateOptions) => string;

function formatNumber(
  value: number,
  locale: AppLocale,
  fractionDigits: { min: number; max: number },
): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits.min,
      maximumFractionDigits: fractionDigits.max,
    }).format(value);
  } catch {
    return value.toFixed(fractionDigits.max);
  }
}

/** "SYP 22,000" (EN) / "22,000 SYP" (AR); up to 2 decimals, never rounded further. */
export function formatMoney(
  amount: number,
  currency: string,
  locale: AppLocale,
  t: T,
): string {
  return t("ride.money", {
    currency,
    amount: formatNumber(amount, locale, { min: 0, max: 2 }),
  });
}

/** Kilometres with one decimal ("4.2"). */
export function formatKm(meters: number, locale: AppLocale): string {
  return formatNumber(meters / 1000, locale, { min: 1, max: 1 });
}

/** Whole minutes, at least 1 ("14"). */
export function formatMinutes(seconds: number, locale: AppLocale): string {
  return formatNumber(Math.max(1, Math.round(seconds / 60)), locale, {
    min: 0,
    max: 0,
  });
}

/** "4:12" — the free-waiting countdown. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Clock time in the app language ("12:41"). */
export function formatClock(value: string | number | Date, locale: AppLocale) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

/** Day + time ("Wed 8 Oct · 12:29") for history and receipts. */
export function formatDateTime(iso: string, locale: AppLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    const day = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
    return `${day} · ${formatClock(date, locale)}`;
  } catch {
    return iso;
  }
}

/** A place's display text: its label, else its coordinates. */
export function placeLabel(place: Place | null | undefined): string {
  if (!place) return "";
  if (place.label && place.label.trim()) return place.label.trim();
  return `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
}

/** The service-type name in the app language. */
export function serviceName(
  names: { nameEn?: string; nameAr?: string } | null | undefined,
  locale: AppLocale,
): string {
  if (!names) return "";
  return (locale === "ar" ? names.nameAr : names.nameEn) ?? names.nameEn ?? "";
}

export interface FareLine {
  key: string;
  label: string;
  amount: number;
}

/**
 * The itemized lines of a stored fare (or of an estimate), in contract
 * order; `total` is the stored total. Optional components that are 0 are
 * left out; a discount is shown as a negative amount.
 */
export function fareLines(
  components: FareComponents,
  measured: { distanceMeters: number; durationSeconds: number },
  locale: AppLocale,
  t: T,
): FareLine[] {
  const lines: FareLine[] = [
    { key: "base", label: t("fare.base"), amount: components.baseFare },
    {
      key: "distance",
      label: t("fare.distance", { km: formatKm(measured.distanceMeters, locale) }),
      amount: components.distanceFare,
    },
    {
      key: "time",
      label: t("fare.time", {
        minutes: formatMinutes(measured.durationSeconds, locale),
      }),
      amount: components.timeFare,
    },
  ];
  if (components.surchargeAmount !== 0) {
    lines.push({
      key: "surcharge",
      label: t("fare.surcharge", {
        percent: formatNumber(components.surchargePercent, locale, {
          min: 0,
          max: 2,
        }),
      }),
      amount: components.surchargeAmount,
    });
  }
  if (components.surgeAmount !== 0) {
    lines.push({
      key: "surge",
      label: t("fare.surge", {
        multiplier: formatNumber(components.surgeMultiplier, locale, {
          min: 1,
          max: 2,
        }),
      }),
      amount: components.surgeAmount,
    });
  }
  if (components.waitFare !== 0) {
    lines.push({ key: "wait", label: t("fare.wait"), amount: components.waitFare });
  }
  if (components.pickupFee !== 0) {
    lines.push({
      key: "pickupFee",
      label: t("fare.pickupFee"),
      amount: components.pickupFee,
    });
  }
  if (components.minimumFareAdjustment !== 0) {
    lines.push({
      key: "minimum",
      label: t("fare.minimum"),
      amount: components.minimumFareAdjustment,
    });
  }
  if (components.discount !== 0) {
    lines.push({
      key: "discount",
      label: t("fare.discount"),
      amount: -components.discount,
    });
  }
  return lines;
}

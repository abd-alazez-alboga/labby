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

/**
 * Numbers always use WESTERN digits (owner ruling 2026-10-11, NFR-I2) —
 * `-u-nu-latn` keeps the locale's own grouping/words while forcing 0-9,
 * never Arabic-Indic digits.
 */
function formatNumber(
  value: number,
  locale: AppLocale,
  fractionDigits: { min: number; max: number },
): string {
  try {
    return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
      minimumFractionDigits: fractionDigits.min,
      maximumFractionDigits: fractionDigits.max,
    }).format(value);
  } catch {
    return value.toFixed(fractionDigits.max);
  }
}

/** The currency's display label ("SYP" / "ل.س"), falling back to the code. */
function currencyLabel(currency: string, t: T): string {
  return t(`money.currencies.${currency}`, { defaultValue: currency });
}

/**
 * "SYP 15,000" (EN) / "15,000 ل.س" (AR, the number in an LTR isolate so it
 * reads correctly inside RTL text); up to 2 decimals, never rounded further.
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale: AppLocale,
  t: T,
): string {
  const digits = formatNumber(amount, locale, { min: 0, max: 2 });
  return t("ride.money", {
    currency: currencyLabel(currency, t),
    amount: locale === "ar" ? `⁦${digits}⁩` : digits,
  });
}

/**
 * A signed amount for the wallet activity list: "+SYP 20,000" / "−SYP 27,250"
 * (EN), "⁦+20,000⁩ ل.س" (AR — the sign travels inside the LTR isolate).
 */
export function formatSignedMoney(
  amount: number,
  currency: string,
  locale: AppLocale,
  t: T,
): string {
  const sign = amount < 0 ? "−" : "+";
  const digits = formatNumber(Math.abs(amount), locale, { min: 0, max: 2 });
  const money = t("ride.money", {
    currency: currencyLabel(currency, t),
    amount: locale === "ar" ? `⁦${sign}${digits}⁩` : digits,
  });
  return locale === "ar" ? money : `${sign}${money}`;
}

/**
 * A surge multiplier as "1.5×" / "1.25×" / "2.0×" — one or two decimals as
 * needed, Western digits; in Arabic the whole figure sits in an LTR isolate
 * so "×" stays after the number inside RTL text (PRC-02).
 */
export function formatSurge(multiplier: number, locale: AppLocale): string {
  const text = `${formatNumber(multiplier, locale, { min: 1, max: 2 })}×`;
  return locale === "ar" ? `\u2066${text}\u2069` : text;
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

/** Clock time in the app language ("12:41"), Western digits (NFR-I2). */
export function formatClock(value: string | number | Date, locale: AppLocale) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

/** Day + month ("5 Oct" / "5 تشرين الأول") for dues and wallet activity. */
export function formatDate(iso: string, locale: AppLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
      day: "numeric",
      month: "short",
    }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

/** Day + time ("Wed 8 Oct · 12:29") for history and receipts. */
export function formatDateTime(iso: string, locale: AppLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    const day = new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
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
        multiplier: formatSurge(components.surgeMultiplier, locale),
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

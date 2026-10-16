import type { TFunction } from "i18next";

import { pluralCategory } from "../money/format";
import { formatNumber } from "../rides/format";

/**
 * Display helpers for scheduled rides. Western digits in both languages
 * (owner ruling 2026-10-11); times are the device's local clock, like
 * every other time in the app.
 */

function locale(language: string): string {
  return language === "ar" ? "ar-u-nu-latn" : "en-GB";
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "Fri 17 Oct · 09:00" (local). */
export function formatWhen(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    const day = new Intl.DateTimeFormat(locale(language), {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
    const time = new Intl.DateTimeFormat(locale(language), {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
    return `${day} · ${time}`;
  } catch {
    return iso;
  }
}

/** "in 40 min" / "in 14 h" / "in 3 days" — "started" once it is due. */
export function formatRelative(
  t: TFunction,
  iso: string,
  language: string,
  now: number = Date.now(),
): string {
  const diff = Date.parse(iso) - now;
  if (!Number.isFinite(diff) || diff <= 0) return t("scheduled.relative.due");
  if (diff < HOUR_MS) {
    return t("scheduled.relative.minutes", {
      value: formatNumber(Math.max(1, Math.round(diff / MINUTE_MS)), language),
    });
  }
  if (diff < 2 * DAY_MS) {
    return t("scheduled.relative.hours", {
      value: formatNumber(Math.round(diff / HOUR_MS), language),
    });
  }
  const days = Math.round(diff / DAY_MS);
  return t(`scheduled.relative.days.${pluralCategory(days, language)}`, {
    value: formatNumber(days, language),
  });
}

/** True within the last hour before pickup — the "goes live soon" chip. */
export function isSoon(iso: string, now: number = Date.now()): boolean {
  const diff = Date.parse(iso) - now;
  return Number.isFinite(diff) && diff <= HOUR_MS;
}

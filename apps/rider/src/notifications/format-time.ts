import type { AppLocale } from "../i18n/translations";

/**
 * Notification timestamp in the app language: time only for today, date +
 * time otherwise. Falls back to the raw ISO value if the runtime lacks Intl.
 */
export function formatNotificationTime(
  iso: string,
  locale: AppLocale,
  now: Date = new Date(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  try {
    // Western digits in Arabic too (owner ruling 2026-10-11, M15-T4).
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
      ...(sameDay ? {} : { day: "numeric", month: "short" }),
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return iso;
  }
}

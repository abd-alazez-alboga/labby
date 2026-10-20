/**
 * Calendar-date helpers for document expiries. The contract works in ISO
 * calendar dates (YYYY-MM-DD): a document is valid THROUGH `expiresOn`, and
 * entry requires `expiresOn` AFTER today (UC-D-01 E2). "Today" is the
 * device's local date — the launch market's devices run on Asia/Damascus;
 * the server re-checks against the operating timezone and stays the authority.
 */

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Local calendar date of `date` as YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of an ISO calendar date. */
export function fromIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

/** Tomorrow's local date — the earliest expiry the contract accepts. */
export function tomorrow(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

/** E2: true only for an expiry strictly after today. */
export function isAfterToday(iso: string, now: Date = new Date()): boolean {
  return iso > todayIso(now);
}

/** Whole calendar days from today to `iso` (negative once it has passed). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = fromIsoDate(iso.slice(0, 10));
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Vehicle years run 1980..next calendar year (contract VehicleInput.year). */
export function maxVehicleYear(now: Date = new Date()): number {
  return now.getFullYear() + 1;
}

/** Western digits in BOTH languages (owner ruling 2026-10-11). */
function dateLocale(language: string): string {
  return language === "ar" ? "ar-u-nu-latn" : "en-GB";
}

/** Human date for display, localized when Intl is available. */
export function formatDate(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(dateLocale(language), {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(fromIsoDate(iso.slice(0, 10)));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Human date-time for history entries (ISO date-time input). */
export function formatDateTime(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(dateLocale(language), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

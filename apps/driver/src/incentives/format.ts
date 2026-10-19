import { isolateDigits } from "../money/format";

/**
 * Display helpers for the M15 incentives screen (boards "D15Incentives" /
 * "D15IncentivesAr"). Western digits in both languages (owner ruling
 * 2026-10-11); every number or clock time inside Arabic text travels in an
 * LTR isolate. Day names come from the translations (`incentives.day.<1-7>`,
 * ISO numbering), so they never depend on the device's ICU data.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "07:00:00" → "07:00" (region-local wall time, never converted). */
export function clockTime(time: string): string {
  return time.slice(0, 5);
}

/** "07:00 – 09:30" — overnight windows read as given ("22:00 – 02:00"). */
export function windowTimes(
  startsAt: string,
  endsAt: string,
  language: string,
): string {
  return isolateDigits(
    `${clockTime(startsAt)} – ${clockTime(endsAt)}`,
    language,
  );
}

function dayName(t: Translate, day: number): string {
  return t(`incentives.day.${day}`);
}

/**
 * A window's days: one contiguous run (wrapping Sunday → Monday) reads
 * "Mon – Thu", a single day "Sat", anything else a comma list
 * ("Mon, Wed, Fri" / «الاثنين، الأربعاء»).
 */
export function daysLabel(t: Translate, daysOfWeek: number[]): string {
  const days = [...new Set(daysOfWeek)]
    .filter((day) => day >= 1 && day <= 7)
    .sort((a, b) => a - b);
  if (days.length === 0) return "";
  if (days.length === 1) return dayName(t, days[0]);
  const set = new Set(days);
  for (const start of days) {
    let contiguous = true;
    for (let step = 0; step < days.length; step += 1) {
      if (!set.has(((start - 1 + step) % 7) + 1)) {
        contiguous = false;
        break;
      }
    }
    if (contiguous) {
      const end = ((start - 1 + days.length - 1) % 7) + 1;
      return t("incentives.dayRange", {
        from: dayName(t, start),
        to: dayName(t, end),
      });
    }
  }
  return days.map((day) => dayName(t, day)).join(t("incentives.listSeparator"));
}

/** A `YYYY-MM-DD` calendar date as a local Date (no zone shift). */
function calendarDate(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(ymd);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** ISO day of week (1 = Monday … 7 = Sunday). */
function isoDay(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

function monthName(date: Date, language: string): string {
  try {
    return new Intl.DateTimeFormat(
      language === "ar" ? "ar-u-nu-latn" : "en-GB",
      { month: "short" },
    ).format(date);
  } catch {
    return String(date.getMonth() + 1);
  }
}

/** "Mon 19" (no month) or "Sun 25 Oct" — a calendar date with its weekday. */
export function formatCalendarDay(
  t: Translate,
  ymd: string,
  language: string,
  options: { month?: boolean } = { month: true },
): string {
  const date = calendarDate(ymd);
  if (!date) return ymd;
  const day = `${dayName(t, isoDay(date))} ${isolateDigits(
    String(date.getDate()),
    language,
  )}`;
  return options.month === false ? day : `${day} ${monthName(date, language)}`;
}

/**
 * The week line's dates: "Mon 19 – Sun 25 Oct"; across a month boundary
 * both ends carry their month ("Mon 27 Oct – Sun 2 Nov").
 */
export function weekRange(
  t: Translate,
  weekStart: string,
  weekEnd: string,
  language: string,
): string {
  const sameMonth = weekStart.slice(0, 7) === weekEnd.slice(0, 7);
  return t("incentives.dayRange", {
    from: formatCalendarDay(t, weekStart, language, { month: !sameMonth }),
    to: formatCalendarDay(t, weekEnd, language),
  });
}

/** The calendar date (`YYYY-MM-DD`) of an instant in the region's zone. */
export function dateInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}

/** `YYYY-MM-DD` plus `days` calendar days. */
export function addDays(ymd: string, days: number): string {
  const date = calendarDate(ymd);
  if (!date) return ymd;
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

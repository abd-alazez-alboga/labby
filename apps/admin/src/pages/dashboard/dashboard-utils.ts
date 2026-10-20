import type { DailyRides } from '../../api/analytics';
import { latinLocale } from '../money/money-format';

/** The date-range presets of the dashboard filter bar. */
export const RANGE_PRESETS = ['today', '7d', '30d', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/**
 * A dashboard range: calendar days `[firstDay, lastDay]` and their instant
 * bounds. The days are those of the range's time zone — the region's when
 * one is known (the API buckets `daily` by the region's local date), else the
 * browser's — so the totals and the per-day chart count the same rides.
 */
export interface DashboardRange {
  firstDay: string;
  lastDay: string;
  /** Midnight of the first day in the range's zone (ISO). */
  from: string;
  /** Midnight AFTER the last day in the range's zone (ISO, exclusive). */
  to: string;
}

/** The longest range the backend serves (analytics-v1: 366 days). */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
/** The backend rejects `Duration.between(from, to) > 366 days` exactly (no rounding). */
const MAX_RANGE_MS = MAX_RANGE_DAYS * DAY_MS;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → its UTC midnight (pure calendar arithmetic, zone-free), or null. */
function dayToUtc(day: string): number | null {
  if (!DAY_PATTERN.test(day)) {
    return null;
  }
  const [year, month, date] = day.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, date);
  const check = new Date(utc);
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === date ? utc : null;
}

function utcToDay(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return utcToDay((dayToUtc(day) ?? 0) + days * DAY_MS);
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock fields of `instant` in `zone`, as a UTC timestamp, plus the date. */
function wallClock(instant: number, zone: string): { asUtc: number; day: string } {
  let format = zoneFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    zoneFormats.set(zone, format);
  }
  const fields: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') {
      fields[part.type] = Number(part.value);
    }
  }
  const asUtc = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour % 24,
    fields.minute,
    fields.second,
  );
  return { asUtc, day: utcToDay(asUtc) };
}

/** The UTC offset of `zone` at `instant`, in ms (whole seconds). */
function zoneOffset(instant: number, zone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return wallClock(whole, zone).asUtc - whole;
}

/**
 * The instant `day` starts in the IANA `zone` (like Java's
 * `LocalDate.atStartOfDay(zone)`): local midnight; on a DST overlap at
 * midnight the earlier one; on a DST gap over midnight the first instant
 * after the gap. Uses only `Intl.DateTimeFormat` (no libraries).
 */
export function zoneMidnight(day: string, zone: string): Date {
  const utcMidnight = dayToUtc(day);
  if (utcMidnight === null) {
    throw new RangeError(`Invalid day: ${day}`);
  }
  // The offset just before and just after the day can differ by a DST shift.
  const candidates = [
    utcMidnight - zoneOffset(utcMidnight - DAY_MS, zone),
    utcMidnight - zoneOffset(utcMidnight + DAY_MS, zone),
  ].sort((a, b) => a - b);
  const exact = candidates.find((instant) => wallClock(instant, zone).asUtc === utcMidnight);
  if (exact !== undefined) {
    return new Date(exact);
  }
  // Midnight falls in a gap: the day starts at the first second whose local date is `day`.
  let low = utcMidnight - 15 * 3_600_000;
  let high = utcMidnight + 15 * 3_600_000;
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2000) * 1000;
    if (wallClock(middle, zone).day >= day) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return new Date(high);
}

/** The calendar day of `now` in `zone` (the browser's when absent). */
export function todayIn(now: Date, zone?: string): string {
  if (zone) {
    return wallClock(now.getTime(), zone).day;
  }
  return utcToDay(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** The instant `day` starts in `zone`, or at browser-local midnight when no zone is known. */
function startOf(day: string, zone?: string): Date {
  if (zone) {
    return zoneMidnight(day, zone);
  }
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

function range(firstDay: string, lastDay: string, zone?: string): DashboardRange {
  return {
    firstDay,
    lastDay,
    from: startOf(firstDay, zone).toISOString(),
    to: startOf(addDays(lastDay, 1), zone).toISOString(),
  };
}

/**
 * The zone the dashboard's days are counted in: the selected region's; with
 * "All regions", the one zone every listed region shares. Undefined (browser
 * time) when the zone is unknown or the regions span several zones.
 */
export function dashboardZone(
  regionId: string,
  zones: ReadonlyMap<string, string>,
): string | undefined {
  if (regionId) {
    return zones.get(regionId);
  }
  const distinct = new Set(zones.values());
  return distinct.size === 1 ? [...distinct][0] : undefined;
}

export interface ResolveOptions {
  now?: Date;
  /** IANA zone of the days (see {@link dashboardZone}); the browser's when absent. */
  timeZone?: string;
}

/**
 * The range of a preset, ending today (days of `timeZone`). A custom range
 * needs both days, in order and at most {@link MAX_RANGE_DAYS} long measured
 * exactly as the backend does (`to − from ≤ 366 × 24 h`); otherwise null.
 */
export function resolveRange(
  preset: RangePreset,
  customFrom: string,
  customTo: string,
  { now = new Date(), timeZone }: ResolveOptions = {},
): DashboardRange | null {
  const today = todayIn(now, timeZone);
  switch (preset) {
    case 'today':
      return range(today, today, timeZone);
    case '7d':
      return range(addDays(today, -6), today, timeZone);
    case '30d':
      return range(addDays(today, -29), today, timeZone);
    case 'custom': {
      if (dayToUtc(customFrom) === null || dayToUtc(customTo) === null || customTo < customFrom) {
        return null;
      }
      const candidate = range(customFrom, customTo, timeZone);
      const span = Date.parse(candidate.to) - Date.parse(candidate.from);
      return span > MAX_RANGE_MS ? null : candidate;
    }
  }
}

/** One chart day: the API's counts (zero when absent) plus the label. */
export interface ChartDay {
  date: string;
  label: string;
  total: number;
  completed: number;
  cancelled: number;
  /** No driver found or still in progress. */
  other: number;
}

/** Every day of the range, oldest first, empty days filled with zeros. */
export function fillDays(
  daily: readonly DailyRides[],
  current: DashboardRange,
  language: string,
): ChartDay[] {
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const first = dayToUtc(current.firstDay);
  const last = dayToUtc(current.lastDay);
  if (first === null || last === null) {
    return [];
  }
  const format = new Intl.DateTimeFormat(latinLocale(language), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const days: ChartDay[] = [];
  for (let date = first; date <= last; date += DAY_MS) {
    const key = utcToDay(date);
    const counts = byDate.get(key);
    const total = counts?.total ?? 0;
    const completed = counts?.completed ?? 0;
    const cancelled = counts?.cancelled ?? 0;
    days.push({
      date: key,
      label: format.format(date),
      total,
      completed,
      cancelled,
      other: Math.max(0, total - completed - cancelled),
    });
  }
  return days;
}

/**
 * A round axis maximum above the tallest day (1, 2, 5 × 10ⁿ steps), always
 * even so the middle tick is a whole number of rides (up to 10: 2, 4, … 10).
 */
export function axisMax(peak: number): number {
  if (peak <= 0) {
    return 4;
  }
  if (peak <= 10) {
    return Math.max(2, Math.ceil(peak / 2) * 2);
  }
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= peak) {
      return step * magnitude;
    }
  }
  return 10 * magnitude;
}

/** "13 – 19 Oct 2026" (or one day) in the UI language, Western digits. */
export function rangeLabel(current: DashboardRange, language: string): string {
  const first = dayToUtc(current.firstDay);
  const last = dayToUtc(current.lastDay);
  if (first === null || last === null) {
    return '';
  }
  const format = new Intl.DateTimeFormat(latinLocale(language), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return current.firstDay === current.lastDay
    ? format.format(first)
    : format.formatRange(first, last);
}

/** A 0..1 rate as a percentage with one decimal ("84.7%"), or null. */
export function formatRate(rate: number | null, language: string): string | null {
  if (rate === null) {
    return null;
  }
  return new Intl.NumberFormat(latinLocale(language), {
    style: 'percent',
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(rate);
}

/** Whole seconds split into minutes + seconds for the pickup-time card. */
export function minutesSeconds(total: number): { minutes: number; seconds: number } {
  const rounded = Math.max(0, Math.round(total));
  return { minutes: Math.floor(rounded / 60), seconds: rounded % 60 };
}

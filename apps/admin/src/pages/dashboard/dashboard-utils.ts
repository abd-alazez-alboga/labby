import type { DailyRides } from '../../api/analytics';
import { latinLocale } from '../money/money-format';

/** The date-range presets of the dashboard filter bar. */
export const RANGE_PRESETS = ['today', '7d', '30d', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** A dashboard range: local calendar days `[firstDay, lastDay]` and their instant bounds. */
export interface DashboardRange {
  firstDay: string;
  lastDay: string;
  /** Local midnight of the first day (ISO). */
  from: string;
  /** Local midnight AFTER the last day (ISO, exclusive). */
  to: string;
}

/** The longest range the backend serves (analytics-v1: 366 days). */
export const MAX_RANGE_DAYS = 366;

function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function range(first: Date, last: Date): DashboardRange {
  return {
    firstDay: isoDay(first),
    lastDay: isoDay(last),
    from: first.toISOString(),
    to: addDays(last, 1).toISOString(),
  };
}

/**
 * The range of a preset, ending today (local days). A custom range needs both
 * days, in order and at most {@link MAX_RANGE_DAYS} long; otherwise null.
 */
export function resolveRange(
  preset: RangePreset,
  customFrom: string,
  customTo: string,
  now: Date = new Date(),
): DashboardRange | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'today':
      return range(today, today);
    case '7d':
      return range(addDays(today, -6), today);
    case '30d':
      return range(addDays(today, -29), today);
    case 'custom': {
      const first = parseDay(customFrom);
      const last = parseDay(customTo);
      if (!first || !last || last < first) {
        return null;
      }
      const days = Math.round((addDays(last, 1).getTime() - first.getTime()) / 86_400_000);
      return days > MAX_RANGE_DAYS ? null : range(first, last);
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
  const first = parseDay(current.firstDay);
  const last = parseDay(current.lastDay);
  if (!first || !last) {
    return [];
  }
  const format = new Intl.DateTimeFormat(latinLocale(language), { day: 'numeric', month: 'short' });
  const days: ChartDay[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const key = isoDay(date);
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

/** "13 – 19 Oct 2026" (or one day) in the UI language, Western digits. */
export function rangeLabel(current: DashboardRange, language: string): string {
  const first = parseDay(current.firstDay);
  const last = parseDay(current.lastDay);
  if (!first || !last) {
    return '';
  }
  const format = new Intl.DateTimeFormat(latinLocale(language), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
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

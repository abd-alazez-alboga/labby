import type { AvailabilityWindow, DayOfWeek } from "../api/scheduled-types";

/**
 * Pure helpers for the weekly availability set (UC-D-05). The semantics are
 * the contract's (scheduled-shared-v1 "Availability windows"): start
 * inclusive, end exclusive, `endsAt < startsAt` runs past midnight and
 * belongs to its start day, `startsAt = endsAt` is the whole day. The
 * server is the judge; these only shape and order what the screen edits.
 */

const HH_MM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const ALL_DAY_TIME = "00:00";

export function isTime(value: string): boolean {
  return HH_MM.test(value);
}

/** Minutes since midnight of an `HH:mm`. */
export function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** `HH:mm` of a Date's local wall clock (the time picker's value). */
export function timeOf(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** A Date carrying `HH:mm` on today's local clock (the time picker's input). */
export function dateAt(value: string): Date {
  const date = new Date();
  const [hours, minutes] = value.split(":").map(Number);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function isAllDay(window: AvailabilityWindow): boolean {
  return window.startsAt === window.endsAt;
}

export function spansMidnight(window: AvailabilityWindow): boolean {
  return toMinutes(window.endsAt) < toMinutes(window.startsAt);
}

function sameWindow(a: AvailabilityWindow, b: AvailabilityWindow): boolean {
  return (
    a.dayOfWeek === b.dayOfWeek &&
    a.startsAt === b.startsAt &&
    a.endsAt === b.endsAt
  );
}

/** The contract refuses an exact duplicate (400). */
export function isDuplicate(
  windows: readonly AvailabilityWindow[],
  candidate: AvailabilityWindow,
): boolean {
  return windows.some((window) => sameWindow(window, candidate));
}

/** By weekday, then start — the order the server returns. */
export function sortWindows(
  windows: readonly AvailabilityWindow[],
): AvailabilityWindow[] {
  return [...windows].sort(
    (a, b) =>
      a.dayOfWeek - b.dayOfWeek || toMinutes(a.startsAt) - toMinutes(b.startsAt),
  );
}

export function windowsOn(
  windows: readonly AvailabilityWindow[],
  day: DayOfWeek,
): AvailabilityWindow[] {
  return sortWindows(windows.filter((window) => window.dayOfWeek === day));
}

export function withoutWindow(
  windows: readonly AvailabilityWindow[],
  target: AvailabilityWindow,
): AvailabilityWindow[] {
  return windows.filter((window) => !sameWindow(window, target));
}

/** Same set regardless of order (unsaved-changes check). */
export function sameSet(
  a: readonly AvailabilityWindow[],
  b: readonly AvailabilityWindow[],
): boolean {
  if (a.length !== b.length) return false;
  const left = sortWindows(a);
  const right = sortWindows(b);
  return left.every((window, index) => sameWindow(window, right[index]));
}

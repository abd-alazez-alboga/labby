import type { CaseStatus, LocalizedText, TicketPriority, TicketStatus } from '../../api/support';
import type { ChipTone } from '../../ui';

/** Pure display helpers behind the M14 support screens (UC-A-21/22). */

export const PRIORITY_TONES: Record<TicketPriority, ChipTone> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'neutral',
  low: 'neutral',
};

export const TICKET_STATUS_TONES: Record<TicketStatus, ChipTone> = {
  open: 'success',
  in_progress: 'accent',
  waiting_on_user: 'warning',
  resolved: 'success',
  closed: 'neutral',
};

export const CASE_STATUS_TONES: Record<CaseStatus, ChipTone> = {
  reported: 'warning',
  driver_contacted: 'accent',
  found: 'success',
  not_found: 'danger',
  returned: 'success',
  closed: 'neutral',
};

/** A queue age (seconds since creation): minutes, hours, then days. */
export function ageParts(ageSeconds: number) {
  const minutes = Math.max(0, Math.floor(ageSeconds / 60));
  if (minutes < 60) {
    return { unit: 'minutes' as const, count: minutes };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { unit: 'hours' as const, count: hours };
  }
  return { unit: 'days' as const, count: Math.floor(hours / 24) };
}

/** The short ticket reference the boards use, e.g. `T-3F9A21C0`. */
export function ticketRef(ticketId: string): string {
  return `T-${ticketId.slice(0, 8).toUpperCase()}`;
}

/** A LocalizedText in the UI language, falling back to the other one. */
export function localizedName(name: LocalizedText, language: string): string {
  const preferred = language.startsWith('ar') ? name.ar : name.en;
  return preferred || name.en || name.ar;
}

/** The first line of a ticket's description, shortened for a queue row. */
export function ticketExcerpt(description: string, max = 80): string {
  const firstLine = description.split('\n', 1)[0].trim();
  return firstLine.length > max ? `${firstLine.slice(0, max - 1).trimEnd()}…` : firstLine;
}

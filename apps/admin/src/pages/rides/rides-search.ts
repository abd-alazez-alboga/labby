import type {
  AdminRideDetail,
  AdminRideSummary,
  AdminRideSummaryPage,
  RideState,
} from '../../api/rides';
import { isUuid } from '../money/money-format';

/**
 * Pure helpers behind the UC-A-18 rides search page. The contract's state
 * filter takes ONE state, so chips that group several states (Active,
 * Cancelled) search each member state and merge client-side. States are
 * disjoint, so the group's newest-first page n (size S) is exactly the
 * slice [n·S, (n+1)·S) of the members' first (n+1)·S rows merged newest
 * first — `memberWindow` says how many rows to read per member and
 * `mergePages(…, window)` cuts that slice, so every page holds S rows.
 */

export type RideFilterChip = 'all' | 'active' | 'completed' | 'cancelled' | 'no_driver' | 'sos';

export const RIDE_FILTER_CHIPS: readonly RideFilterChip[] = [
  'all',
  'active',
  'completed',
  'cancelled',
  'no_driver',
  'sos',
];

const CHIP_STATES: Record<Exclude<RideFilterChip, 'sos'>, RideState[]> = {
  all: [],
  active: ['requested', 'offering', 'accepted', 'driver_arrived', 'in_progress'],
  completed: ['completed'],
  cancelled: ['cancelled_by_rider', 'cancelled_by_driver'],
  no_driver: ['no_driver_found'],
};

/** The member states a chip expands to ([] = no state filter). */
export function chipStates(chip: Exclude<RideFilterChip, 'sos'>): RideState[] {
  return CHIP_STATES[chip];
}

export interface MergedRides {
  /** The rows of the requested page, newest first. */
  items: AdminRideSummary[];
  totalItems: number;
  /** How many pages of the page size the merged rows fill (at least 1). */
  totalPages: number;
}

/** The largest page the admin rides search serves (rides-v1 `size` maximum). */
export const MAX_SEARCH_SIZE = 100;

/**
 * The reads one member state needs for the group's page `page` of `size`:
 * its first (page+1)·size rows, in chunks the search serves.
 */
export function memberWindow(page: number, size: number): { chunk: number; rows: number } {
  const rows = (page + 1) * size;
  return { chunk: Math.min(MAX_SEARCH_SIZE, rows), rows };
}

/**
 * Merges the member-state reads of one grouped chip (or the single page)
 * newest first. With `window`, the members' reads are their leading rows
 * (see memberWindow) and the result is exactly that page's slice.
 */
export function mergePages(
  pages: readonly AdminRideSummaryPage[],
  window?: { page: number; size: number },
): MergedRides {
  const sorted = pages
    .flatMap((page) => page.items)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || a.id.localeCompare(b.id));
  const totalItems = pages.reduce((sum, page) => sum + page.totalItems, 0);
  const size = Math.max(1, window?.size ?? Math.max(1, ...pages.map((page) => page.size)));
  const items = window
    ? sorted.slice(window.page * window.size, (window.page + 1) * window.size)
    : sorted;
  return { items, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)) };
}

export type QueryKind = 'none' | 'id' | 'phone';

/** What a search-box input means: a pasted UUID, or an exact phone. */
export function classifyQuery(raw: string): { kind: QueryKind; value: string } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { kind: 'none', value: '' };
  }
  if (isUuid(trimmed)) {
    return { kind: 'id', value: trimmed.toLowerCase() };
  }
  return { kind: 'phone', value: trimmed.replace(/[\s-]/g, '') };
}

/** The `from`/`to` bounds covering one local calendar day ("YYYY-MM-DD"). */
export function dayBounds(day: string): { from: string; to: string } | null {
  const start = new Date(`${day}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** A search table row: a summary, plus the estimate when it came from a detail. */
export type RideRow = AdminRideSummary & {
  /** The estimate total while no final fare exists (detail-sourced rows only). */
  estimateTotal?: number | null;
};

/** A search row synthesized from a ride detail (the SOS chip's rows). */
export function detailToSummary(detail: AdminRideDetail): RideRow {
  const { ride } = detail;
  return {
    estimateTotal: ride.fare ? null : ride.estimate.components.total,
    id: ride.id,
    state: ride.state,
    requestedAt: ride.timeline.requestedAt,
    pickup: ride.pickup,
    destination: ride.destination,
    serviceTypeNameEn: ride.serviceTypeNameEn,
    serviceTypeNameAr: ride.serviceTypeNameAr,
    total: ride.fare?.components.total ?? null,
    cancellationFee: ride.cancellationFee ?? null,
    currency: ride.estimate.components.currency,
    kind: ride.kind,
    regionId: ride.regionId,
    regionName: '',
    riderUserId: detail.riderUserId,
    riderName: detail.riderName,
    driverUserId: detail.driverUserId ?? null,
    driverName: detail.driverName ?? null,
  };
}

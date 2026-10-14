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
 * Cancelled) issue one search per member state and merge the pages
 * client-side — states are disjoint, so page n of the group is the union of
 * each member's page n, re-sorted newest first.
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
  /** The union of the member pages, newest first. */
  items: AdminRideSummary[];
  totalItems: number;
  /** Zero-based count of pages (the largest member's). */
  totalPages: number;
}

/** Merges the member-state pages of one grouped chip (or the single page). */
export function mergePages(pages: readonly AdminRideSummaryPage[]): MergedRides {
  const items = pages
    .flatMap((page) => page.items)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const totalItems = pages.reduce((sum, page) => sum + page.totalItems, 0);
  const totalPages = Math.max(
    1,
    ...pages.map((page) => Math.ceil(page.totalItems / Math.max(1, page.size))),
  );
  return { items, totalItems, totalPages };
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

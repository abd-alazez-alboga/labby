import type { ApiClient } from '../../api/client';
import { listSosEvents, type AdminSosEvent } from '../../api/comms';
import type { FareComponents, RideTimeline } from '../../api/rides';

/** Pure helpers behind the UC-A-18 ride detail page. */

export type TimelineKind =
  | 'requested'
  | 'offering'
  | 'accepted'
  | 'driver_arrived'
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'no_driver_found'
  | 'sos';

export interface TimelineMoment {
  kind: TimelineKind;
  at: string;
  /** The SOS event behind an `sos` moment. */
  sos?: AdminSosEvent;
}

const STATE_MOMENTS: readonly [TimelineKind, keyof RideTimeline][] = [
  ['requested', 'requestedAt'],
  ['offering', 'offeringAt'],
  ['accepted', 'acceptedAt'],
  ['driver_arrived', 'driverArrivedAt'],
  ['started', 'startedAt'],
  ['completed', 'completedAt'],
  ['cancelled', 'cancelledAt'],
  ['no_driver_found', 'noDriverFoundAt'],
];

/**
 * The ride's state moments (RIDE-02, one per reached state) merged with its
 * SOS events (permanent facts, SAFE-02) in chronological order.
 */
export function buildTimeline(
  timeline: RideTimeline,
  sosEvents: readonly AdminSosEvent[],
): TimelineMoment[] {
  const moments: TimelineMoment[] = [];
  for (const [kind, field] of STATE_MOMENTS) {
    const at = timeline[field];
    if (at) {
      moments.push({ kind, at });
    }
  }
  for (const sos of sosEvents) {
    moments.push({ kind: 'sos', at: sos.triggeredAt, sos });
  }
  return moments.sort((a, b) => a.at.localeCompare(b.at));
}

/** How many SOS list pages the per-ride lookup walks at most. */
export const MAX_SOS_PAGES = 5;

/**
 * Every SOS event of one ride, oldest first. The alert list has no ride
 * filter, so this walks the region's list (newest first) until it passes the
 * ride's request moment — no event of the ride can predate it — or runs out
 * of pages. Needs support:view (the caller gates).
 */
export async function fetchRideSosEvents(
  client: ApiClient,
  rideId: string,
  regionId: string,
  requestedAt: string,
): Promise<AdminSosEvent[]> {
  const found: AdminSosEvent[] = [];
  let before: string | undefined;
  for (let pageNo = 0; pageNo < MAX_SOS_PAGES; pageNo += 1) {
    const page = await listSosEvents(client, { status: 'all', regionId, before, size: 50 });
    for (const event of page.items) {
      if (event.rideId === rideId) {
        found.push(event);
      }
    }
    const oldest = page.items[page.items.length - 1];
    if (!page.nextCursor || !oldest || oldest.createdAt < requestedAt) {
      break;
    }
    before = page.nextCursor;
  }
  return found.sort((a, b) => a.triggeredAt.localeCompare(b.triggeredAt));
}

export interface FareLine {
  key:
    | 'base'
    | 'distance'
    | 'time'
    | 'surcharge'
    | 'surge'
    | 'wait'
    | 'pickupFee'
    | 'minimum'
    | 'discount';
  amount: number;
}

/** The non-zero fare components, in the contract's addition order (PRC-01). */
export function fareLines(components: FareComponents): FareLine[] {
  const lines: FareLine[] = [
    { key: 'base', amount: components.baseFare },
    { key: 'distance', amount: components.distanceFare },
    { key: 'time', amount: components.timeFare },
    { key: 'surcharge', amount: components.surchargeAmount },
    { key: 'surge', amount: components.surgeAmount },
    { key: 'wait', amount: components.waitFare },
    { key: 'pickupFee', amount: components.pickupFee },
    { key: 'minimum', amount: components.minimumFareAdjustment },
    { key: 'discount', amount: -components.discount },
  ];
  // Base always shows (the fare's anchor); the rest only when non-zero.
  return lines.filter((line) => line.key === 'base' || line.amount !== 0);
}

import { describe, expect, it } from 'vitest';

import { toLiveOpsOverlay } from '../pages/liveops/live-ops-overlay';
import { refreshDelayMs } from '../pages/liveops/use-live-ops';
import { buildTimeline, fareLines } from '../pages/rides/ride-detail-utils';
import { rideRef } from '../pages/rides/ride-format';
import { chipStates, classifyQuery, dayBounds, mergePages } from '../pages/rides/rides-search';
import { newOpenEvents } from '../sos/SosAlertsProvider';
import { LIVE_OPS, OPEN_SOS, RIDE_DETAIL, rideSummary } from './comms-fixtures';

describe('M10 admin helpers', () => {
  it('maps the live-ops surge zones onto the surge facade overlay shape', () => {
    const [mazzeh, old] = toLiveOpsOverlay(LIVE_OPS.surgeZones);
    expect(mazzeh).toMatchObject({ multiplier: 2, level: 3, band: 'surging', strength: 1 });
    expect(old).toMatchObject({ multiplier: 1, level: 0, band: 'none', strength: 0 });
  });

  it('polls at the announced pace, never faster than 1 s', () => {
    expect(refreshDelayMs(5)).toBe(5_000);
    expect(refreshDelayMs(0)).toBe(1_000);
  });

  it('detects only newly seen open alerts', () => {
    const next = [{ ...OPEN_SOS, sosEventId: 'new' }, OPEN_SOS];
    expect(newOpenEvents(new Set([OPEN_SOS.sosEventId]), next).map((e) => e.sosEventId)).toEqual([
      'new',
    ]);
  });

  it('expands grouped chips to their contract states', () => {
    expect(chipStates('all')).toEqual([]);
    expect(chipStates('cancelled')).toEqual(['cancelled_by_rider', 'cancelled_by_driver']);
    expect(chipStates('no_driver')).toEqual(['no_driver_found']);
  });

  it('merges member-state pages newest first and sums the totals', () => {
    const older = rideSummary({ id: 'a', requestedAt: '2026-10-13T10:00:00Z' });
    const newer = rideSummary({ id: 'b', requestedAt: '2026-10-13T11:00:00Z' });
    const merged = mergePages([
      { items: [older], page: 0, size: 25, totalItems: 30 },
      { items: [newer], page: 0, size: 25, totalItems: 5 },
    ]);
    expect(merged.items.map((r) => r.id)).toEqual(['b', 'a']);
    expect(merged.totalItems).toBe(35);
    expect(merged.totalPages).toBe(2);
  });

  it('classifies search input and day bounds', () => {
    expect(classifyQuery('  ')).toEqual({ kind: 'none', value: '' });
    expect(classifyQuery('+963 911-111 111')).toEqual({ kind: 'phone', value: '+963911111111' });
    expect(classifyQuery(RIDE_DETAIL.ride.id.toUpperCase()).kind).toBe('id');
    expect(dayBounds('not-a-day')).toBeNull();
  });

  it('merges SOS moments into the state timeline chronologically', () => {
    const kinds = buildTimeline(RIDE_DETAIL.ride.timeline, [OPEN_SOS]).map((m) => m.kind);
    expect(kinds).toEqual([
      'requested',
      'offering',
      'accepted',
      'driver_arrived',
      'started',
      'sos',
    ]);
  });

  it('lists the base fare plus the non-zero components only', () => {
    expect(fareLines(RIDE_DETAIL.ride.estimate.components).map((l) => l.key)).toEqual([
      'base',
      'distance',
      'time',
    ]);
    expect(rideRef(RIDE_DETAIL.ride.id)).toBe('R-AAAAAAAA');
  });
});

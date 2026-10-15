import { describe, expect, it } from 'vitest';

import { toLiveOpsOverlay } from '../pages/liveops/live-ops-overlay';
import { refreshDelayMs } from '../pages/liveops/use-live-ops';
import { buildTimeline, fareLines } from '../pages/rides/ride-detail-utils';
import { liveOpsLink, rideRef, routeLabel } from '../pages/rides/ride-format';
import {
  chipStates,
  classifyQuery,
  dayBounds,
  memberWindow,
  mergePages,
} from '../pages/rides/rides-search';
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

  it('pages a grouped chip newest first across states with a constant page size (A-W3)', () => {
    // in_progress: 6 recent rides; requested: 3 old ones. Page size 4.
    const at = (h: number) => `2026-10-13T${String(h).padStart(2, '0')}:00:00Z`;
    const recent = [20, 19, 18, 17, 16, 15].map((h) =>
      rideSummary({ id: `ip-${h}`, state: 'in_progress', requestedAt: at(h) }),
    );
    const old = [3, 2, 1].map((h) =>
      rideSummary({ id: `rq-${h}`, state: 'requested', requestedAt: at(h) }),
    );
    // Page 1 (zero-based) needs each member's first 8 rows.
    expect(memberWindow(1, 4)).toEqual({ chunk: 8, rows: 8 });
    expect(memberWindow(9, 25)).toEqual({ chunk: 100, rows: 250 });
    const members = [
      { items: recent, page: 0, size: 8, totalItems: 6 },
      { items: old, page: 0, size: 8, totalItems: 3 },
    ];
    const first = mergePages(members, { page: 0, size: 4 });
    expect(first.items.map((r) => r.id)).toEqual(['ip-20', 'ip-19', 'ip-18', 'ip-17']);
    const second = mergePages(members, { page: 1, size: 4 });
    expect(second.items.map((r) => r.id)).toEqual(['ip-16', 'ip-15', 'rq-3', 'rq-2']);
    expect(second.totalItems).toBe(9);
    expect(second.totalPages).toBe(3);
    expect(mergePages(members, { page: 2, size: 4 }).items.map((r) => r.id)).toEqual(['rq-1']);
  });

  it('points the route arrow from pickup to destination in both directions (A-W4)', () => {
    const pickup = { label: 'Mazzeh' };
    const destination = { label: 'Old City' };
    expect(routeLabel(pickup, destination, '—')).toBe('Mazzeh → Old City');
    expect(routeLabel(pickup, destination, '—', 'rtl')).toBe('Mazzeh ← Old City');
    expect(routeLabel({}, destination, '—', 'ltr')).toBe('— → Old City');
  });

  it('links an SOS alert to its region and ride on the live map (A-H3)', () => {
    expect(liveOpsLink({ regionId: 'region-2', rideId: 'ride-9' })).toBe(
      '/live-ops?region=region-2&ride=ride-9',
    );
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

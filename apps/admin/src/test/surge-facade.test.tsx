import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../api/client';
import type { SurgeState } from '../api/regions';
import {
  CYCLE_GRACE_MS,
  FALLBACK_REFRESH_MS,
  INITIAL_REFRESH_TRACK,
  STALE_RETRY_MS,
  cyclePeriod,
  formatMultiplier,
  latestComputedAt,
  nextRefreshDelay,
  parseMultiplier,
  planNextRead,
  toSurgeOverlay,
  useSurgeState,
} from '../pages/surge';
import { ZONE_POLYGON } from './region-fixtures';

const client = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ apiClient: client as unknown as ApiClient }),
}));

const NOW = new Date('2026-10-13T12:40:30Z').getTime();

function stateWith(
  nextCycleAt: string | null,
  currentMultiplier = 1.5,
  computedAt: string | null = '2026-10-13T12:40:00Z',
): SurgeState {
  return {
    regionId: 'region-1',
    surgeCap: 2,
    nextCycleAt,
    zones: [
      {
        id: 'z-1',
        name: 'Old City',
        polygon: ZONE_POLYGON,
        currentMultiplier,
        computedMultiplier: 1.2,
        overrideMultiplier: 1.5,
        overrideSetAt: '2026-10-13T11:58:00Z',
        overridePending: false,
        demandCount: 5,
        supplyCount: 2,
        computedAt,
        level: currentMultiplier >= 2 ? 3 : currentMultiplier > 1 ? 2 : 0,
        effectiveCap: 2,
      },
    ],
  };
}

/** Lets the hook's pending fetch promise settle under fake timers. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('surge helpers', () => {
  it('schedules the next read a few seconds after the announced cycle', () => {
    expect(nextRefreshDelay('2026-10-13T12:42:00Z', '2026-10-13T12:40:00Z', NOW)).toBe(
      90_000 + CYCLE_GRACE_MS,
    );
    expect(nextRefreshDelay(null, null, NOW)).toBe(FALLBACK_REFRESH_MS);
  });

  it('clamps the delay to [1 s, one period + grace] whatever the device clock says', () => {
    // Device clock 10 min behind the server: one period (from server timestamps) + grace.
    expect(nextRefreshDelay('2026-10-13T12:52:00Z', '2026-10-13T12:50:00Z', NOW)).toBe(
      120_000 + CYCLE_GRACE_MS,
    );
    // A cycle time already past (device clock ahead): read again soon, never spin.
    expect(nextRefreshDelay('2026-10-13T12:30:00Z', '2026-10-13T12:28:00Z', NOW)).toBe(1_000);
    expect(cyclePeriod('2026-10-13T12:40:00Z', '2026-10-13T12:42:00Z')).toBe(120_000);
    expect(cyclePeriod(null, '2026-10-13T12:42:00Z')).toBe(FALLBACK_REFRESH_MS);
  });

  it('retries in 15 s while the awaited cycle has not written, for one period at most', () => {
    const fresh = planNextRead(stateWith('2026-10-13T12:42:00Z'), INITIAL_REFRESH_TRACK, NOW);
    expect(fresh.track).toEqual({
      awaited: '2026-10-13T12:42:00Z',
      period: 120_000,
      retries: 0,
    });
    // Read at 12:42:05 — the 12:42 cycle has not written; the next fire is 12:44.
    const stale = stateWith('2026-10-13T12:44:00Z');
    const at = new Date('2026-10-13T12:42:05Z').getTime();
    let track = fresh.track;
    for (let i = 0; i < 8; i += 1) {
      const plan = planNextRead(stale, track, at);
      expect(plan.delay).toBe(STALE_RETRY_MS);
      track = plan.track;
    }
    // A period's worth spent: back to the normal schedule.
    expect(planNextRead(stale, track, at).delay).toBe(120_000);
    // A manual refresh mid-cycle never counts as stale.
    expect(planNextRead(stale, fresh.track, at, false).delay).toBe(120_000);
    expect(
      latestComputedAt([
        { ...stale.zones[0], computedAt: '2026-10-13T12:40:00Z' },
        { ...stale.zones[0], computedAt: '2026-10-13T12:42:01Z' },
        { ...stale.zones[0], computedAt: null },
      ]),
    ).toBe('2026-10-13T12:42:01Z');
  });

  it('parses the manual multiplier like money amounts: 1.0 … cap, at most 2 decimals', () => {
    expect(parseMultiplier('1.8', 2)).toEqual({ value: 1.8 });
    expect(parseMultiplier(' 2 ', 2)).toEqual({ value: 2 });
    expect(parseMultiplier('1.25', null)).toEqual({ value: 1.25 });
    expect(parseMultiplier('1.255', 2)).toEqual({ error: 'format' });
    expect(parseMultiplier('1e0', 2)).toEqual({ error: 'format' });
    expect(parseMultiplier('-1', 2)).toEqual({ error: 'format' });
    expect(parseMultiplier('', 2)).toEqual({ error: 'format' });
    expect(parseMultiplier('0.99', 2)).toEqual({ error: 'range' });
    expect(parseMultiplier('2.01', 2)).toEqual({ error: 'range' });
    expect(parseMultiplier('100', null)).toEqual({ error: 'range' });
  });

  it('formats multipliers with one decimal at least and Western digits in Arabic', () => {
    expect(formatMultiplier(2, 'en')).toBe('2.0×');
    expect(formatMultiplier(1.25, 'ar')).toBe('1.25×');
  });

  it('exposes the zones as a map overlay for the M10 live ops map', () => {
    expect(toSurgeOverlay(stateWith(null, 1.5))).toEqual([
      {
        id: 'z-1',
        name: 'Old City',
        polygon: ZONE_POLYGON,
        multiplier: 1.5,
        level: 2,
        band: 'surging',
        strength: 0.5,
        overridden: true,
        pending: false,
      },
    ]);
    expect(toSurgeOverlay(stateWith(null, 2))[0]).toMatchObject({
      level: 3,
      band: 'max',
      strength: 1,
    });
    expect(toSurgeOverlay(stateWith(null, 1))[0]).toMatchObject({
      level: 0,
      band: 'none',
      strength: 0,
    });
  });

  it("scales the overlay against the zone's effective cap, not the region cap", () => {
    // Zone cap 1.5 below the region cap 2.0, at 1.5: at its cap.
    const state = stateWith(null, 1.5);
    state.zones[0] = { ...state.zones[0], level: 2, effectiveCap: 1.5 };
    expect(toSurgeOverlay(state)[0]).toMatchObject({ level: 2, band: 'max', strength: 1 });
  });
});

describe('useSurgeState auto-refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    client.get.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-reads the state right after each announced cycle', async () => {
    client.get
      .mockResolvedValueOnce(stateWith('2026-10-13T12:42:00Z', 1.5))
      .mockResolvedValueOnce(stateWith('2026-10-13T12:44:00Z', 2, '2026-10-13T12:42:00.300Z'));
    const { result } = renderHook(() => useSurgeState('region-1'));
    await flush();

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('/api/v1/admin/regions/region-1/surge-state');
    expect(result.current.state?.zones[0].currentMultiplier).toBe(1.5);
    expect(result.current.overlay[0]).toMatchObject({ id: 'z-1', level: 2, band: 'surging' });

    await act(async () => {
      vi.advanceTimersByTime(90_000 + CYCLE_GRACE_MS - 1);
    });
    expect(client.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(result.current.state?.zones[0].currentMultiplier).toBe(2);
  });

  it('falls back to every 2 minutes when the cycle is off, and keeps the state on a failed read', async () => {
    client.get
      .mockResolvedValueOnce(stateWith(null))
      .mockRejectedValueOnce(new ApiError(500, '/x'))
      .mockResolvedValueOnce(stateWith(null, 1));
    const { result } = renderHook(() => useSurgeState('region-1'));
    await flush();
    expect(client.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(FALLBACK_REFRESH_MS);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe('failed');
    expect(result.current.state).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(FALLBACK_REFRESH_MS);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
    expect(result.current.state?.zones[0].currentMultiplier).toBe(1);
  });

  it('refresh() reads now and re-arms the timer; unmount stops it', async () => {
    client.get.mockResolvedValue(stateWith('2026-10-13T12:42:00Z'));
    const { result, unmount } = renderHook(() => useSurgeState('region-1'));
    await flush();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await result.current.refresh();
    });
    expect(client.get).toHaveBeenCalledTimes(2);

    // The re-armed timer is measured from the refresh, not the first read.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(client.get).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10 * FALLBACK_REFRESH_MS);
    });
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it('a device clock 10 min behind still re-reads within one period + grace', async () => {
    // Server time is 10 min ahead: the cycle ran at 12:50, the next at 12:52.
    client.get
      .mockResolvedValueOnce(stateWith('2026-10-13T12:52:00Z', 1.5, '2026-10-13T12:50:00Z'))
      .mockResolvedValueOnce(stateWith('2026-10-13T12:54:00Z', 2, '2026-10-13T12:52:00.300Z'));
    const { result } = renderHook(() => useSurgeState('region-1'));
    await flush();

    await act(async () => {
      vi.advanceTimersByTime(120_000 + CYCLE_GRACE_MS - 1);
    });
    expect(client.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(result.current.state?.zones[0].currentMultiplier).toBe(2);
  });

  it('retries after 15 s when the cycle has not written yet (computedAt not advanced)', async () => {
    client.get
      .mockResolvedValueOnce(stateWith('2026-10-13T12:42:00Z', 1.5))
      // 12:42:05: the 12:42 cycle is still running; the server announces 12:44.
      .mockResolvedValueOnce(stateWith('2026-10-13T12:44:00Z', 1.5))
      .mockResolvedValueOnce(stateWith('2026-10-13T12:44:00Z', 2, '2026-10-13T12:42:00.300Z'))
      .mockResolvedValue(stateWith('2026-10-13T12:46:00Z', 2, '2026-10-13T12:44:00.300Z'));
    const { result } = renderHook(() => useSurgeState('region-1'));
    await flush();

    await act(async () => {
      vi.advanceTimersByTime(90_000 + CYCLE_GRACE_MS);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(result.current.state?.zones[0].currentMultiplier).toBe(1.5);

    await act(async () => {
      vi.advanceTimersByTime(STALE_RETRY_MS - 1);
    });
    expect(client.get).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(3);
    expect(result.current.state?.zones[0].currentMultiplier).toBe(2);

    // Fresh again: the next read is at 12:44 + grace (now 12:42:20).
    await act(async () => {
      vi.advanceTimersByTime(105_000 - 1);
    });
    expect(client.get).toHaveBeenCalledTimes(3);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(4);
  });

  it('reports an unknown region as notFound and stays idle when disabled', async () => {
    client.get.mockRejectedValueOnce(new ApiError(404, '/x'));
    const { result } = renderHook(() => useSurgeState('missing'));
    await flush();
    expect(result.current.error).toBe('notFound');
    expect(result.current.state).toBeNull();

    client.get.mockClear();
    renderHook(() => useSurgeState('region-1', false));
    await flush();
    expect(client.get).not.toHaveBeenCalled();
  });
});

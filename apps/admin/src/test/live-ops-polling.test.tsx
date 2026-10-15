import { act, render, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/client';
import i18n from '../i18n/i18n';
import { useLiveOps } from '../pages/liveops/use-live-ops';
import { SOS_POLL_MS, SosAlertsProvider, useSosAlerts } from '../sos/SosAlertsProvider';
import { LIVE_OPS, OPEN_SOS } from './comms-fixtures';

const client = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ apiClient: client as unknown as ApiClient }),
}));
vi.mock('../auth/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}));
const show = vi.hoisted(() => vi.fn());
vi.mock('../toast/ToastProvider', () => ({
  useToast: () => ({ show }),
}));

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Lets pending fetch promises settle under fake timers. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  client.get.mockReset();
  show.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useLiveOps polling (A-W1)', () => {
  it('polls at the announced pace, pauses in a hidden tab, resumes on show, stops on unmount', async () => {
    vi.useFakeTimers();
    client.get.mockImplementation(() => Promise.resolve(LIVE_OPS));
    const { result, unmount } = renderHook(() => useLiveOps('region-1'));
    await flush();
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).toEqual(LIVE_OPS);

    // Visible: one read per announced 5 s.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(2);

    // Hidden: the due tick is skipped and nothing re-arms, however long it stays hidden.
    visibility = 'hidden';
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    // Shown again: reads at once, then resumes the 5 s pace.
    act(() => setVisibility('visible'));
    await flush();
    expect(client.get).toHaveBeenCalledTimes(3);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    await flush();
    expect(client.get).toHaveBeenCalledTimes(4);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(client.get).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** Navigates to `to` whenever it changes (a route change above the provider's children). */
function Navigator({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);
  return null;
}

let api: ReturnType<typeof useSosAlerts> | null = null;
function Probe() {
  api = useSosAlerts();
  return null;
}

function renderProvider(to: string) {
  return render(
    <MemoryRouter initialEntries={['/']} future={FUTURE}>
      <SosAlertsProvider>
        <Navigator to={to} />
        <Probe />
      </SosAlertsProvider>
    </MemoryRouter>,
  );
}

const sosCalls = () =>
  client.get.mock.calls.filter(([url]) => String(url).includes('/admin/sos-events'));

describe('SosAlertsProvider polling (A-W2)', () => {
  it('keeps one poll timer across route and language changes', async () => {
    vi.useFakeTimers();
    client.get.mockImplementation(() => Promise.resolve({ items: [OPEN_SOS], nextCursor: null }));
    const { rerender } = renderProvider('/');
    await flush();
    expect(sosCalls()).toHaveLength(1);

    // In-app navigation and a language switch must not re-poll or reset the timer.
    rerender(
      <MemoryRouter initialEntries={['/']} future={FUTURE}>
        <SosAlertsProvider>
          <Navigator to="/rides" />
          <Probe />
        </SosAlertsProvider>
      </MemoryRouter>,
    );
    await flush();
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await flush();
    expect(sosCalls()).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(SOS_POLL_MS);
    });
    await flush();
    expect(sosCalls()).toHaveLength(2);
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('never overlaps reads: a refresh during a read waits, then reads once more', async () => {
    const pending: ((value: unknown) => void)[] = [];
    client.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    renderProvider('/');
    await flush();
    expect(sosCalls()).toHaveLength(1);

    // Tab return fires focus AND visibilitychange; an acknowledgement refreshes too.
    act(() => {
      window.dispatchEvent(new Event('focus'));
      setVisibility('visible');
      void api!.refresh();
    });
    await flush();
    expect(sosCalls()).toHaveLength(1); // still only the first read in flight

    // The first (older) answer lands, then exactly one follow-up read runs.
    await act(async () => {
      pending[0]({ items: [OPEN_SOS], nextCursor: null });
    });
    await flush();
    expect(sosCalls()).toHaveLength(2);
    expect(api!.openCount).toBe(1);

    // The newest answer (alert acknowledged elsewhere) is the one that sticks.
    await act(async () => {
      pending[1]({ items: [], nextCursor: null });
    });
    await flush();
    expect(sosCalls()).toHaveLength(2);
    expect(api!.openCount).toBe(0);
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  axisMax,
  dashboardZone,
  fillDays,
  resolveRange,
  todayIn,
  zoneMidnight,
} from '../pages/dashboard/dashboard-utils';
import { RidesPerDayChart } from '../pages/dashboard/RidesPerDayChart';
import { ANALYST, DAMASCUS_ID, dashboard, stubAnalyticsRoutes } from './analytics-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
} from './test-utils';

const DAY_MS = 86_400_000;

/** Both fixture regions are in Damascus, so the dashboard counts Damascus days. */
const ZONE = 'Asia/Damascus';

function localDay(offset: number): string {
  const today = Date.parse(`${todayIn(new Date(), ZONE)}T00:00:00Z`);
  return new Date(today + offset * DAY_MS).toISOString().slice(0, 10);
}

function analyticsQuery(fetchMock: ReturnType<typeof stubAnalyticsRoutes>, index = -1): URL {
  const calls = callsTo(fetchMock, '/api/v1/admin/analytics');
  return new URL(String(calls.at(index)?.[0]));
}

/**
 * UC-A-30 against analytics-v1 mocks (approved boards "Admin · Dashboard"
 * EN + AR): the four ADM-02 groups, presets / custom range / region filter
 * in the request, the filled daily chart, Now / All regions badges, the
 * failure banner and the plain page for admins without analytics:view.
 */
describe('analytics dashboard', () => {
  beforeAll(async () => {
    await import('../pages/DashboardPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the four groups for the last 7 days by default', async () => {
    seedStoredSession(sessionFor(ANALYST));
    const fetchMock = stubAnalyticsRoutes(ANALYST, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/analytics'
        ? jsonResponse(
            200,
            dashboard({
              rides: {
                ...dashboard().rides,
                daily: [{ date: localDay(0), total: 337, completed: 300, cancelled: 20 }],
              },
            }),
          )
        : null,
    );
    renderShell();

    const rides = await screen.findByRole('region', { name: 'Rides' });
    expect(within(rides).getByText('3,482')).toBeInTheDocument();
    expect(within(rides).getByText('84.7% completion rate')).toBeInTheDocument();
    expect(within(rides).getByText('Rider 301 · Driver 111')).toBeInTheDocument();
    expect(within(rides).getByText('412')).toBeInTheDocument();
    expect(within(rides).getByRole('img', { name: 'Rides per day' })).toBeInTheDocument();
    // Seven days drawn, the empty ones filled; today's bar carries the API counts.
    expect(rides.querySelectorAll('[data-testid^="chart-day-"]')).toHaveLength(7);
    expect(within(rides).getByTestId(`chart-day-${localDay(0)}`)).toHaveTextContent(
      '337 rides · 300 completed · 20 cancelled',
    );
    const table = within(rides).getByRole('table');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Aleppo57847179');

    const revenue = screen.getByRole('region', { name: 'Revenue' });
    expect(within(revenue).getAllByText('SYP 148,125,000').length).toBeGreaterThan(0);
    expect(within(revenue).getAllByText('SYP 29,625,000').length).toBeGreaterThan(0);

    const users = screen.getByRole('region', { name: 'Users' });
    expect(within(users).getByText('All regions')).toBeInTheDocument();
    expect(within(users).getByText('Riders 214 · Drivers 18')).toBeInTheDocument();
    expect(within(users).getByText('47')).toBeInTheDocument();

    const ops = screen.getByRole('region', { name: 'Operations' });
    expect(within(ops).getByText('6 min 40 s')).toBeInTheDocument();
    expect(within(ops).getByText('78.4%')).toBeInTheDocument();
    expect(within(ops).getByText('3,120 of 3,979 answered offers')).toBeInTheDocument();
    expect(within(ops).getAllByText('Now')).toHaveLength(1);
    expect(within(users).getAllByText('Now')).toHaveLength(1);

    const query = analyticsQuery(fetchMock);
    const from = new Date(query.searchParams.get('from') ?? '');
    const to = new Date(query.searchParams.get('to') ?? '');
    // Region-local midnights (both regions share Asia/Damascus), whatever the browser zone.
    expect(from.toISOString()).toBe(zoneMidnight(localDay(-6), ZONE).toISOString());
    expect(to.getTime() - from.getTime()).toBe(7 * DAY_MS);
    expect(query.searchParams.has('regionId')).toBe(false);
  });

  it('sends the preset, custom range and region in the request', async () => {
    seedStoredSession(sessionFor(ANALYST));
    const fetchMock = stubAnalyticsRoutes(ANALYST);
    renderShell();
    const user = userEvent.setup();

    await screen.findByRole('region', { name: 'Rides' });
    await user.click(screen.getByRole('button', { name: 'Last 30 days' }));
    await waitFor(() => {
      const query = analyticsQuery(fetchMock);
      const span =
        new Date(query.searchParams.get('to') ?? '').getTime() -
        new Date(query.searchParams.get('from') ?? '').getTime();
      expect(Math.round(span / DAY_MS)).toBe(30);
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Region' }), 'Damascus');
    await waitFor(() =>
      expect(analyticsQuery(fetchMock).searchParams.get('regionId')).toBe(DAMASCUS_ID),
    );

    await user.click(screen.getByRole('button', { name: 'Custom…' }));
    const first = screen.getByLabelText('First day');
    const last = screen.getByLabelText('Last day');
    await user.clear(last);
    await user.type(last, localDay(-40));
    expect(
      await screen.findByText('Choose a first and last day in order, at most 366 days apart.'),
    ).toBeInTheDocument();
    await user.clear(first);
    await user.type(first, localDay(-41));
    await waitFor(() => {
      const query = analyticsQuery(fetchMock);
      const span =
        new Date(query.searchParams.get('to') ?? '').getTime() -
        new Date(query.searchParams.get('from') ?? '').getTime();
      expect(Math.round(span / DAY_MS)).toBe(2);
    });
  });

  it('shows a retryable banner when the dashboard fails to load', async () => {
    seedStoredSession(sessionFor(ANALYST));
    let fail = true;
    const fetchMock = stubAnalyticsRoutes(ANALYST, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/analytics' && fail
        ? jsonResponse(503, { code: 'query_timeout', message: 'slow' })
        : null,
    );
    renderShell();
    const user = userEvent.setup();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The dashboard could not be loaded.');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Rides' })).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/v1/admin/analytics')).toHaveLength(2);
  });

  it('renders the Arabic dashboard right-to-left with Western digits', async () => {
    await i18n.changeLanguage('ar');
    seedStoredSession(sessionFor(ANALYST));
    stubAnalyticsRoutes(ANALYST);
    renderShell();

    const rides = await screen.findByRole('region', { name: 'الرحلات' });
    expect(document.documentElement.dir).toBe('rtl');
    expect(within(rides).getByText('3,482')).toBeInTheDocument();
    expect(screen.getAllByText('الآن')).not.toHaveLength(0);
    expect(screen.getByText('كل المناطق', { selector: '.dashboard-badge' })).toBeInTheDocument();
  });

  it('keeps the plain page for admins without analytics:view', async () => {
    const viewer = adminUser(['rides:view']);
    seedStoredSession(sessionFor(viewer));
    const fetchMock = stubAnalyticsRoutes(viewer);
    renderShell();

    expect(
      await screen.findByText(
        'Your role does not include analytics. Use the menu to open the pages you can work on.',
      ),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/v1/admin/analytics')).toHaveLength(0);
  });
});

describe('dashboard range helpers', () => {
  it('resolves presets to whole local days and rejects bad custom ranges', () => {
    const now = new Date(2026, 9, 20, 15, 30);
    expect(resolveRange('today', '', '', { now })).toMatchObject({
      firstDay: '2026-10-20',
      lastDay: '2026-10-20',
    });
    expect(resolveRange('7d', '', '', { now })).toMatchObject({ firstDay: '2026-10-14' });
    expect(resolveRange('30d', '', '', { now })).toMatchObject({ firstDay: '2026-09-21' });
    expect(resolveRange('custom', '2026-10-10', '2026-10-01', { now })).toBeNull();
    expect(resolveRange('custom', '2025-01-01', '2026-10-01', { now })).toBeNull();
    expect(resolveRange('custom', '2026-02-30', '2026-03-01', { now })).toBeNull();
    expect(resolveRange('custom', '2026-10-01', '2026-10-03', { now })).toMatchObject({
      firstDay: '2026-10-01',
      lastDay: '2026-10-03',
    });
  });

  it('fills every day of the range and splits the rest from completed and cancelled', () => {
    const range = resolveRange('custom', '2026-10-01', '2026-10-03');
    expect(range).not.toBeNull();
    const days = fillDays(
      [{ date: '2026-10-02', total: 10, completed: 6, cancelled: 3 }],
      range!,
      'en',
    );
    expect(days.map((day) => [day.date, day.total, day.other])).toEqual([
      ['2026-10-01', 0, 0],
      ['2026-10-02', 10, 1],
      ['2026-10-03', 0, 0],
    ]);
  });

  it('counts the days in the region zone, not the browser zone (W5)', () => {
    // 22:30 UTC on 20 Oct is already 01:30 on 21 Oct in Damascus (UTC+3).
    const now = new Date('2026-10-20T22:30:00Z');
    expect(resolveRange('today', '', '', { now, timeZone: ZONE })).toEqual({
      firstDay: '2026-10-21',
      lastDay: '2026-10-21',
      from: '2026-10-20T21:00:00.000Z',
      to: '2026-10-21T21:00:00.000Z',
    });
    expect(resolveRange('7d', '', '', { now, timeZone: ZONE })).toMatchObject({
      firstDay: '2026-10-15',
      from: '2026-10-14T21:00:00.000Z',
    });
    // A UTC browser would have counted 20 Oct from 00:00 UTC instead.
    expect(resolveRange('today', '', '', { now, timeZone: 'UTC' })).toMatchObject({
      firstDay: '2026-10-20',
      from: '2026-10-20T00:00:00.000Z',
    });
  });

  it('finds zone midnights across DST shifts', () => {
    expect(zoneMidnight('2026-10-20', ZONE).toISOString()).toBe('2026-10-19T21:00:00.000Z');
    // Berlin springs forward at 02:00 on 29 Mar: that day is 23 hours long.
    expect(zoneMidnight('2026-03-29', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(zoneMidnight('2026-03-30', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T22:00:00.000Z',
    );
    // Beirut springs forward AT midnight: the day starts at 01:00 (UTC+3).
    expect(zoneMidnight('2026-03-29', 'Asia/Beirut').toISOString()).toBe(
      '2026-03-28T22:00:00.000Z',
    );
  });

  it('measures the 366-day limit exactly as the backend does (W6)', () => {
    // 366 days with two Berlin fall-backs and one spring-forward = 366 d + 1 h: rejected.
    expect(
      resolveRange('custom', '2025-10-25', '2026-10-25', { timeZone: 'Europe/Berlin' }),
    ).toBeNull();
    // 366 days whose DST shifts cancel out = exactly 366 d: accepted.
    expect(
      resolveRange('custom', '2026-01-01', '2027-01-01', { timeZone: 'Europe/Berlin' }),
    ).toMatchObject({ from: '2025-12-31T23:00:00.000Z', to: '2027-01-01T23:00:00.000Z' });
    expect(resolveRange('custom', '2025-10-21', '2026-10-21', { timeZone: ZONE })).not.toBeNull();
    expect(resolveRange('custom', '2025-10-20', '2026-10-21', { timeZone: ZONE })).toBeNull();
  });

  it('uses the selected region zone, or the one zone all regions share', () => {
    const shared = new Map([
      ['a', ZONE],
      ['b', ZONE],
    ]);
    const mixed = new Map([
      ['a', ZONE],
      ['b', 'Europe/Berlin'],
    ]);
    expect(dashboardZone('b', mixed)).toBe('Europe/Berlin');
    expect(dashboardZone('', shared)).toBe(ZONE);
    expect(dashboardZone('', mixed)).toBeUndefined();
    expect(dashboardZone('', new Map())).toBeUndefined();
    expect(dashboardZone('c', shared)).toBeUndefined();
  });

  it('keeps every y-axis tick a whole number of rides', () => {
    for (let peak = 0; peak <= 120; peak += 1) {
      expect(Number.isInteger(axisMax(peak) / 2)).toBe(true);
      expect(axisMax(peak)).toBeGreaterThanOrEqual(peak);
    }
    const quiet = fillDays(
      [{ date: '2026-10-02', total: 1, completed: 1, cancelled: 0 }],
      resolveRange('custom', '2026-10-01', '2026-10-03')!,
      'en',
    );
    const { container } = render(<RidesPerDayChart days={quiet} />);
    const ticks = [...container.querySelectorAll('svg > g > .rides-chart__tick')].map(
      (tick) => tick.textContent,
    );
    expect(ticks.slice(0, 3)).toEqual(['0', '1', '2']);
  });
});

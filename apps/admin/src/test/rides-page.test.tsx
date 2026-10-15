import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminRideSummary } from '../api/rides';
import i18n from '../i18n/i18n';
import { OPEN_SOS, RIDE_DETAIL, SOS_RIDE_ID, rideSummary, stubCommsRoutes } from './comms-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  type FetchRouteHandler,
} from './test-utils';

// The detail route's Leaflet seam (reached by the UUID jump test).
vi.mock('../pages/rides/RideTraceMap', () => ({ RideTraceMap: () => <div /> }));

const VIEWER = adminUser(['rides:view', 'regions:view']);
const SUPPORT_VIEWER = adminUser(['rides:view', 'regions:view', 'support:view']);

const RIDES_PATH = '/api/v1/admin/rides';

const ACTIVE_ROW = rideSummary({
  id: SOS_RIDE_ID,
  state: 'in_progress',
  riderName: 'Lina K.',
  driverName: 'Samer A.',
  total: null,
  pickup: { lat: 33.51, lng: 36.29, label: 'Abu Rummaneh' },
  destination: { lat: 33.52, lng: 36.31, label: 'Umayyad Sq' },
});
const COMPLETED_ROW = rideSummary();
const CANCELLED_ROW = rideSummary({
  id: 'cccccccc-0000-4000-8000-000000000003',
  state: 'cancelled_by_rider',
  riderName: 'Hadi R.',
  driverName: 'Samer A.',
  total: null,
  cancellationFee: 10000,
});

function page(items: AdminRideSummary[], totalItems = items.length, size = 25) {
  return jsonResponse(200, { items, page: 0, size, totalItems });
}

function stubRides(
  user = SUPPORT_VIEWER,
  {
    rides = () => [ACTIVE_ROW, COMPLETED_ROW, CANCELLED_ROW],
    extra,
  }: {
    rides?: (url: URL | undefined) => AdminRideSummary[];
    extra?: FetchRouteHandler;
  } = {},
) {
  seedStoredSession(sessionFor(user));
  return stubCommsRoutes(user, (method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === RIDES_PATH) {
      return page(rides(url));
    }
    if (method === 'GET' && path === '/api/v1/admin/sos-events') {
      return jsonResponse(200, { items: [OPEN_SOS], nextCursor: null });
    }
    return null;
  });
}

/** The state filters each /admin/rides call carried, in call order. */
function statesAsked(fetchMock: ReturnType<typeof stubRides>): (string | null)[] {
  return callsTo(fetchMock, `${RIDES_PATH}?`).map(([input]) =>
    new URL(String(input)).searchParams.get('state'),
  );
}

describe('rides search page (UC-A-18)', () => {
  beforeAll(async () => {
    await import('../pages/RidesPage');
    await import('../pages/RideDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/rides');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists rides with state chips, fares and the open-SOS red flag', async () => {
    const fetchMock = stubRides();
    renderShell();

    const table = (await screen.findByRole('table')).closest('section')!;
    expect(statesAsked(fetchMock)).toEqual([null]); // "All" sends no state filter.
    expect(screen.getByText('3 rides')).toBeInTheDocument();

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('R-AAAAAAAA');
    expect(rows[0]).toHaveTextContent('Lina K.');
    expect(rows[0]).toHaveTextContent('Abu Rummaneh → Umayyad Sq');
    expect(rows[0]).toHaveTextContent('In progress');
    // The open-SOS flag comes from the alert list (support:view).
    expect(within(rows[0]).getByRole('img', { name: 'Open SOS' })).toBeInTheDocument();
    expect(rows[0]).toHaveClass('table__row--sos');

    expect(rows[1]).toHaveTextContent('Completed');
    expect(rows[1]).toHaveTextContent('SYP 61,000');
    expect(within(rows[1]).queryByRole('img', { name: 'Open SOS' })).toBeNull();
    expect(rows[2]).toHaveTextContent('Cancelled by rider');
    expect(rows[2]).toHaveTextContent('SYP 10,000 fee');

    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', `/rides/${SOS_RIDE_ID}`);
  });

  it('maps single-state chips to the contract state filter', async () => {
    const fetchMock = stubRides(SUPPORT_VIEWER, {
      rides: (url) =>
        url?.searchParams.get('state') === 'completed' ? [COMPLETED_ROW] : [ACTIVE_ROW],
    });
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(statesAsked(fetchMock)).toContain('completed'));
    expect(await screen.findByText('Omar H.')).toBeInTheDocument();
  });

  it('merges one search per member state for grouped chips (Cancelled, Active)', async () => {
    const fetchMock = stubRides(SUPPORT_VIEWER, {
      rides: (url) => {
        const state = url?.searchParams.get('state');
        if (state === 'cancelled_by_rider') {
          return [CANCELLED_ROW];
        }
        if (state === null) {
          return [ACTIVE_ROW, COMPLETED_ROW, CANCELLED_ROW];
        }
        return [];
      },
    });
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Cancelled' }));
    await screen.findByText('Hadi R.');
    expect(
      statesAsked(fetchMock)
        .filter((s) => s !== null)
        .sort(),
    ).toEqual(['cancelled_by_driver', 'cancelled_by_rider']);

    await user.click(screen.getByRole('button', { name: 'Active' }));
    await waitFor(() =>
      expect(statesAsked(fetchMock)).toEqual(
        expect.arrayContaining([
          'requested',
          'offering',
          'accepted',
          'driver_arrived',
          'in_progress',
        ]),
      ),
    );
  });

  it('shows the rides behind open alerts under the SOS chip', async () => {
    stubRides(SUPPORT_VIEWER, {
      extra: (method, path) =>
        method === 'GET' && path === `/api/v1/admin/rides/${SOS_RIDE_ID}`
          ? jsonResponse(200, RIDE_DETAIL)
          : null,
    });
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'SOS' }));
    const row = (await screen.findByText('R-AAAAAAAA')).closest('tr')!;
    expect(row).toHaveTextContent('Lina K.');
    expect(row).toHaveTextContent('In progress');
    // No final fare yet — the estimate from the detail shows instead.
    expect(row).toHaveTextContent('SYP 23,000 est.');
    expect(screen.getByText('1 rides')).toBeInTheDocument();
  });

  it('hides the SOS chip and red flags without support:view', async () => {
    const fetchMock = stubRides(VIEWER);
    renderShell();

    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'SOS' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Open SOS' })).toBeNull();
    expect(callsTo(fetchMock, '/api/v1/admin/sos-events')).toHaveLength(0);
  });

  it('searches by exact phone, and filters by region and day', async () => {
    const fetchMock = stubRides();
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('table');

    await user.type(screen.getByLabelText('Search'), '+963 911 111 111');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      const urls = callsTo(fetchMock, `${RIDES_PATH}?`).map(([input]) => new URL(String(input)));
      expect(urls.at(-1)?.searchParams.get('phone')).toBe('+963911111111');
    });

    await user.selectOptions(screen.getByLabelText('Region'), 'region-1');
    await waitFor(() => {
      const urls = callsTo(fetchMock, `${RIDES_PATH}?`).map(([input]) => new URL(String(input)));
      expect(urls.at(-1)?.searchParams.get('regionId')).toBe('region-1');
    });

    await user.type(screen.getByLabelText('On day'), '2026-10-13');
    await waitFor(() => {
      const last = callsTo(fetchMock, `${RIDES_PATH}?`)
        .map(([input]) => new URL(String(input)))
        .at(-1)!;
      const from = new Date(last.searchParams.get('from')!);
      const to = new Date(last.searchParams.get('to')!);
      expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });

  it('jumps straight to the detail when a ride UUID is pasted', async () => {
    stubRides(SUPPORT_VIEWER, {
      extra: (method, path) => {
        if (method === 'GET' && path === `/api/v1/admin/rides/${SOS_RIDE_ID}`) {
          return jsonResponse(200, RIDE_DETAIL);
        }
        if (method === 'GET' && path.startsWith('/api/v1/admin/rides/') && path.endsWith('/chat')) {
          return jsonResponse(404, { status: 404, message: 'No thread' });
        }
        return null;
      },
    });
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('table');

    await user.type(screen.getByLabelText('Search'), SOS_RIDE_ID);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(window.location.pathname).toBe(`/rides/${SOS_RIDE_ID}`));
  });

  it('paginates with the shared pager', async () => {
    const fetchMock = stubRides(SUPPORT_VIEWER, {
      rides: () => [COMPLETED_ROW],
      extra: (method, path, _init, url) =>
        method === 'GET' && path === RIDES_PATH
          ? jsonResponse(200, {
              items: [COMPLETED_ROW],
              page: Number(url?.searchParams.get('page') ?? 0),
              size: 25,
              totalItems: 60,
            })
          : null,
    });
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('table');

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      const last = callsTo(fetchMock, `${RIDES_PATH}?`)
        .map(([input]) => new URL(String(input)))
        .at(-1)!;
      expect(last.searchParams.get('page')).toBe('1');
    });
  });

  it('renders Arabic with Western digits', async () => {
    await i18n.changeLanguage('ar');
    stubRides();
    renderShell();

    await screen.findByRole('table');
    expect(screen.getByText('3 رحلة')).toBeInTheDocument();
    // Arabic uses Western digits with the Arabic currency label (owner ruling).
    expect(screen.getByText('ل.س 61,000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'مكتملة' })).toBeInTheDocument();
    // The route arrow follows the reading direction (A-W4).
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Abu Rummaneh ← Umayyad Sq');
  });

  it("reads each member state's leading rows for a grouped chip's later page (A-W3)", async () => {
    const fetchMock = stubRides(SUPPORT_VIEWER, { rides: () => [] });
    window.history.pushState({}, '', '/rides?state=cancelled&page=1');
    renderShell();

    await waitFor(() =>
      expect(
        statesAsked(fetchMock)
          .filter((s) => s !== null)
          .sort(),
      ).toEqual(['cancelled_by_driver', 'cancelled_by_rider']),
    );
    // Page 2 of 25 = the first 50 rows of each member, merged and sliced.
    for (const [input] of callsTo(fetchMock, `${RIDES_PATH}?`)) {
      const url = new URL(String(input));
      if (url.searchParams.get('state')) {
        expect(url.searchParams.get('page')).toBe('0');
        expect(url.searchParams.get('size')).toBe('50');
      }
    }
  });
});

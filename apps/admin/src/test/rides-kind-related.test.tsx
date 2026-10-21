import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminRideRelated, AdminRideSummary } from '../api/rides';
import i18n from '../i18n/i18n';
import { RIDE_DETAIL, SOS_RIDE_ID, rideSummary, stubCommsRoutes } from './comms-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  type FetchRouteHandler,
} from './test-utils';

/**
 * V1 audit W15 (UC-A-18): the rides list's Kind filter and column (board
 * V1FAdminRidesKind) and the ride detail's Related card (board
 * V1FAdminRideRelated) over GET /admin/rides/{id}/related.
 */

vi.mock('../pages/rides/RideTraceMap', () => ({ RideTraceMap: () => <div /> }));

const VIEWER = adminUser(['rides:view', 'regions:view']);
const FULL = adminUser(['rides:view', 'regions:view', 'reports:view', 'support:view']);
const RIDES_PATH = '/api/v1/admin/rides';
const RELATED_PATH = `${RIDES_PATH}/${SOS_RIDE_ID}/related`;

const SHARED_ROW = rideSummary({
  id: 'eeeeeeee-0000-4000-8000-000000000005',
  kind: 'shared',
  riderName: 'Nour S.',
  sharedSeats: 3,
  sharedParties: 3,
});
const SCHEDULED_ROW = rideSummary({
  id: 'ffffffff-0000-4000-8000-000000000006',
  kind: 'scheduled',
  riderName: 'Omar T.',
});

const RELATED: AdminRideRelated = {
  rideId: SOS_RIDE_ID,
  reports: [
    {
      id: 'r0000000-0000-4000-8000-000000000001',
      ref: 'R0000000',
      category: 'vehicle_damage',
      status: 'open',
      reporter: { userId: 'driver-samer', name: 'Samer Haddad', role: 'driver' },
      reported: { userId: 'user-rana', name: 'Rana Khoury', role: 'rider' },
      createdAt: '2026-10-19T19:10:00Z',
    },
  ],
  tickets: [
    {
      id: '3f9a21c0-0000-4000-8000-000000000009',
      ref: '3F9A21C0',
      categoryId: 'cat-payments',
      categoryNameEn: 'Payments',
      categoryNameAr: 'المدفوعات',
      summary: 'Charged twice for one ride',
      status: 'waiting_on_user',
      priority: 'normal',
      user: { userId: 'user-rana', name: 'Rana Khoury', role: 'rider' },
      sosEventId: null,
      createdAt: '2026-10-20T06:05:00Z',
    },
  ],
  lostItems: [
    {
      id: '7c21b0e4-0000-4000-8000-000000000010',
      ref: '7C21B0E4',
      summary: 'Black backpack on the back seat',
      caseStatus: 'found',
      status: 'in_progress',
      user: { userId: 'user-rana', name: 'Rana Khoury', role: 'rider' },
      createdAt: '2026-10-19T19:20:00Z',
    },
  ],
  sos: [],
};

function stub(
  user: ReturnType<typeof adminUser>,
  {
    rows = [SHARED_ROW, SCHEDULED_ROW],
    related = RELATED,
    extra,
  }: {
    rows?: AdminRideSummary[];
    related?: AdminRideRelated;
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
      return jsonResponse(200, { items: rows, page: 0, size: 25, totalItems: rows.length });
    }
    if (method === 'GET' && path === `${RIDES_PATH}/${SOS_RIDE_ID}`) {
      return jsonResponse(200, RIDE_DETAIL);
    }
    if (method === 'GET' && path === RELATED_PATH) {
      return jsonResponse(200, related);
    }
    if (method === 'GET' && path === '/api/v1/admin/sos-events') {
      return jsonResponse(200, { items: [], nextCursor: null });
    }
    return null;
  });
}

function lastRidesQuery(fetchMock: ReturnType<typeof stub>): URL {
  return new URL(String(callsTo(fetchMock, `${RIDES_PATH}?`).at(-1)?.[0]));
}

describe('rides kind filter and related records (V1 audit W15)', () => {
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

  it('filters by kind through ?kind= and names each row’s kind', async () => {
    const fetchMock = stub(VIEWER);
    const user = userEvent.setup();
    renderShell();

    const table = await screen.findByRole('table');
    expect(lastRidesQuery(fetchMock).searchParams.has('kind')).toBe(false);
    const rows = within(table).getAllByRole('row');
    expect(within(rows[0]).getByRole('columnheader', { name: 'Kind' })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Shared · 3 seats');
    expect(rows[1]).toHaveTextContent('Nour S. + 2');
    expect(rows[2]).toHaveTextContent('Scheduled');

    const kind = screen.getByRole('combobox', { name: 'Kind' });
    expect(
      within(kind)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All kinds', 'On-demand', 'Scheduled', 'Shared']);
    await user.selectOptions(kind, 'shared');

    await waitFor(() => expect(lastRidesQuery(fetchMock).searchParams.get('kind')).toBe('shared'));
    expect(window.location.search).toContain('kind=shared');
  });

  it('passes the kind to Export CSV', async () => {
    const exporter = adminUser(['rides:view', 'regions:view', 'analytics:export']);
    window.history.pushState({}, '', '/rides?state=completed&kind=scheduled');
    const fetchMock = stub(exporter);
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(callsTo(fetchMock, '/api/v1/admin/exports/rides')).toHaveLength(1));
    const [call] = callsTo(fetchMock, '/api/v1/admin/exports/rides');
    expect(new URL(String(call[0])).searchParams.get('kind')).toBe('scheduled');
  });

  it('lists the ride’s reports, tickets and lost items, each opening its record', async () => {
    window.history.pushState({}, '', `/rides/${SOS_RIDE_ID}`);
    stub(FULL);
    renderShell();

    const related = await screen.findByRole('region', { name: 'Related' });
    expect(within(related).getByText('Reports · 1')).toBeInTheDocument();
    const report = within(related).getByRole('link', { name: /Damage to vehicle · by driver/ });
    expect(report).toHaveAttribute('href', '/reports/r0000000-0000-4000-8000-000000000001');
    expect(report).toHaveTextContent('About rider Rana Khoury · filed');
    expect(report).toHaveTextContent('Open');

    const ticket = within(related).getByRole('link', { name: /Payments · Charged twice/ });
    expect(ticket).toHaveAttribute('href', '/support/3f9a21c0-0000-4000-8000-000000000009');
    expect(ticket).toHaveTextContent('T-3F9A21C0 · by rider Rana Khoury');
    expect(ticket).toHaveTextContent('Waiting on user');

    const lost = within(related).getByRole('link', { name: /Black backpack/ });
    expect(lost).toHaveAttribute('href', '/lost-items/7c21b0e4-0000-4000-8000-000000000010');
    expect(lost).toHaveTextContent('L-7C21B0E4');
    expect(lost).toHaveTextContent('Found');

    expect(within(related).getByText('SOS · 0')).toBeInTheDocument();
    expect(within(related).getByText('No SOS on this ride.')).toBeInTheDocument();
  });

  it('shows only the sections the server served, and the empty state', async () => {
    window.history.pushState({}, '', `/rides/${SOS_RIDE_ID}`);
    stub(VIEWER, { related: { rideId: SOS_RIDE_ID, reports: [] } });
    renderShell();

    const related = await screen.findByRole('region', { name: 'Related' });
    expect(
      within(related).getByText(
        'No reports, support tickets, lost-item cases or SOS for this ride.',
      ),
    ).toBeInTheDocument();
    expect(within(related).queryByText(/Support tickets/)).toBeNull();
  });

  it('hides the card when the admin may see none of the sections', async () => {
    window.history.pushState({}, '', `/rides/${SOS_RIDE_ID}`);
    const fetchMock = stub(VIEWER, { related: { rideId: SOS_RIDE_ID } });
    renderShell();

    await screen.findByRole('heading', { level: 1, name: 'Ride R-AAAAAAAA' });
    await waitFor(() => expect(callsTo(fetchMock, RELATED_PATH)).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Related' })).toBeNull();
  });

  it('renders Related in Arabic', async () => {
    await i18n.changeLanguage('ar');
    window.history.pushState({}, '', `/rides/${SOS_RIDE_ID}`);
    stub(FULL);
    renderShell();

    const related = await screen.findByRole('region', { name: 'مرتبط بالرحلة' });
    expect(within(related).getByText('البلاغات · 1')).toBeInTheDocument();
    expect(within(related).getByRole('link', { name: /المدفوعات/ })).toHaveTextContent(
      'T-3F9A21C0',
    );
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DriverLedgerView } from '../api/money';
import i18n from '../i18n/i18n';
import { SOS_RIDE_ID } from './comms-fixtures';
import {
  OMAR_ID,
  RANA_ID,
  REPORT_1,
  REPORT_2,
  reportPage,
  reportSummary,
  SAMER_ID,
  stubTrustRoutes,
  userTrust,
} from './trust-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
} from './test-utils';

/**
 * V1 audit W4 (UC-A-13 "driver ledger (if driver), reports (made/received)";
 * board V1FAdminUserReportsLedger): the profile's "Reports made" section over
 * GET /admin/reports?reporterUserId=, and for drivers with settlements:view
 * the driver ledger card and tab.
 */

const PROFILE_ADMIN = adminUser(['users:view', 'reports:view', 'rides:view', 'settlements:view']);
const TRUST_PATH = `/api/v1/admin/users/${SAMER_ID}/trust`;
const LEDGER_PATH = `/api/v1/admin/drivers/${SAMER_ID}/ledger`;

const LEDGER: DriverLedgerView = {
  balances: [
    {
      currency: 'SYP',
      balance: -430000,
      floor: -500000,
      status: 'warning',
      floorRegionId: 'region-1',
      floorRegionName: 'Damascus',
    },
  ],
  entries: [],
  page: 0,
  size: 1,
  totalItems: 0,
  totalPages: 0,
};

function stub(user = PROFILE_ADMIN, trust = userTrust()) {
  seedStoredSession(sessionFor(user));
  return stubTrustRoutes(user, (method, path, _init, url) => {
    if (method === 'GET' && path === TRUST_PATH) {
      return jsonResponse(200, trust);
    }
    if (method === 'GET' && path === LEDGER_PATH) {
      return jsonResponse(200, LEDGER);
    }
    if (
      method === 'GET' &&
      path === '/api/v1/admin/reports' &&
      url?.searchParams.get('reporterUserId') === SAMER_ID
    ) {
      const status = url.searchParams.get('status');
      if (status === 'open') {
        return jsonResponse(
          200,
          reportPage([
            reportSummary({
              id: REPORT_1,
              category: 'vehicle_damage',
              reporter: { userId: SAMER_ID, name: 'Samer Haddad', role: 'driver' },
              reported: { userId: RANA_ID, name: 'Rana Khoury', role: 'rider' },
              createdAt: '2026-10-19T19:10:00Z',
            }),
          ]),
        );
      }
      if (status === 'substantiated') {
        return jsonResponse(
          200,
          reportPage(
            [
              reportSummary({
                id: REPORT_2,
                status: 'substantiated',
                reporter: { userId: SAMER_ID, name: 'Samer Haddad', role: 'rider' },
                reported: { userId: OMAR_ID, name: 'Yara Mansour', role: 'driver' },
                createdAt: '2026-10-18T10:00:00Z',
              }),
            ],
            2,
          ),
        );
      }
      return jsonResponse(200, reportPage([]));
    }
    return null;
  });
}

describe('profile reports made and driver ledger (V1 audit W4)', () => {
  beforeAll(async () => {
    await import('../pages/UserTrustPage');
    await import('../pages/DriverLedgerPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/users/${SAMER_ID}/trust`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the reports the user filed, newest first, with the total', async () => {
    const fetchMock = stub();
    renderShell();

    const heading = await screen.findByRole('heading', { name: 'Reports made' });
    const section = heading.closest('section')!;
    expect(
      within(section).getByText('Reports this user filed, as rider or driver · 3 total'),
    ).toBeInTheDocument();
    const rows = within(section).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('link', { name: 'Damage to vehicle' })).toHaveAttribute(
      'href',
      `/reports/${REPORT_1}`,
    );
    expect(rows[0]).toHaveTextContent('Rana Khoury · rider');
    expect(within(rows[0]).getByRole('link', { name: 'R-AAAAAAAA' })).toHaveAttribute(
      'href',
      `/rides/${SOS_RIDE_ID}`,
    );
    expect(rows[0]).toHaveTextContent('Open');
    expect(rows[1]).toHaveTextContent('Yara Mansour · driver');
    expect(rows[1]).toHaveTextContent('Substantiated');

    const statuses = callsTo(fetchMock, 'reporterUserId=')
      .map(([input]) => new URL(String(input)).searchParams.get('status'))
      .sort();
    expect(statuses).toEqual(['open', 'substantiated', 'unsubstantiated']);
  });

  it('says so when the user filed none', async () => {
    seedStoredSession(sessionFor(PROFILE_ADMIN));
    stubTrustRoutes(PROFILE_ADMIN, (method, path) =>
      method === 'GET' && path === TRUST_PATH ? jsonResponse(200, userTrust()) : null,
    );
    renderShell();

    expect(await screen.findByText("This user hasn't filed any reports.")).toBeInTheDocument();
  });

  it('hides Reports made without reports:view', async () => {
    const fetchMock = stub(adminUser(['users:view']));
    renderShell();

    await screen.findByRole('region', { name: 'Driver role' });
    expect(screen.queryByRole('heading', { name: 'Reports made' })).toBeNull();
    expect(callsTo(fetchMock, 'reporterUserId=')).toHaveLength(0);
  });

  it('shows the driver ledger card and tab for a driver with settlements:view', async () => {
    stub();
    renderShell();

    const card = (await screen.findByRole('heading', { name: 'Driver ledger' })).closest(
      'section',
    )!;
    expect(within(card).getByText('SYP −430,000')).toBeInTheDocument();
    expect(card).toHaveTextContent('Floor · Damascus');
    expect(within(card).getByText('SYP −500,000')).toBeInTheDocument();
    expect(within(card).getByText('Near the floor')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Open driver ledger' })).toHaveAttribute(
      'href',
      `/driver-ledgers/${SAMER_ID}`,
    );

    const tabs = screen.getByRole('navigation', { name: 'Profile sections' });
    expect(within(tabs).getByRole('link', { name: 'Driver ledger' })).toHaveAttribute(
      'href',
      `/driver-ledgers/${SAMER_ID}`,
    );
  });

  it('shows no ledger for a rider-only account or without settlements:view', async () => {
    const riderOnly = userTrust({ roles: [userTrust().roles[1]] });
    const fetchMock = stub(PROFILE_ADMIN, riderOnly);
    const { unmount } = renderShell();

    await screen.findByRole('region', { name: 'Rider role' });
    expect(screen.queryByRole('heading', { name: 'Driver ledger' })).toBeNull();
    expect(callsTo(fetchMock, LEDGER_PATH)).toHaveLength(0);
    unmount();
    vi.unstubAllGlobals();

    const noLedger = stub(adminUser(['users:view', 'reports:view']));
    renderShell();
    await screen.findByRole('region', { name: 'Driver role' });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Reports made' })).not.toBeNull(),
    );
    expect(screen.queryByRole('heading', { name: 'Driver ledger' })).toBeNull();
    expect(callsTo(noLedger, LEDGER_PATH)).toHaveLength(0);
  });

  it('renders Reports made and the ledger card in Arabic', async () => {
    await i18n.changeLanguage('ar');
    stub();
    renderShell();

    expect(await screen.findByRole('heading', { name: 'البلاغات المقدَّمة' })).toBeInTheDocument();
    const card = (await screen.findByRole('heading', { name: 'سجل السائق' })).closest('section')!;
    expect(card).toHaveTextContent('الحد · Damascus');
  });
});

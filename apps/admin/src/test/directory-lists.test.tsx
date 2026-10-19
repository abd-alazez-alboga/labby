import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import { DAMASCUS_ID, EXPORTER, RANA, stubAnalyticsRoutes, USERS_ONLY } from './analytics-fixtures';
import { adminUser, callsTo, renderShell, seedStoredSession, sessionFor } from './test-utils';

function lastQuery(fetchMock: ReturnType<typeof stubAnalyticsRoutes>, path: string): URL {
  return new URL(String(callsTo(fetchMock, path).at(-1)?.[0]));
}

/**
 * The M15 users / drivers / transactions lists (approved boards) against
 * analytics-v1 mocks: rows, URL-backed filters sent to the server, phones
 * only when served, Export CSV only for analytics:export, and the gated
 * sidebar entries.
 */
describe('admin directory lists', () => {
  beforeAll(async () => {
    await Promise.all([
      import('../pages/UsersPage'),
      import('../pages/DriversPage'),
      import('../pages/TransactionsPage'),
    ]);
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists users under the lookup and filters by role and sign-up days', async () => {
    window.history.pushState({}, '', '/users');
    seedStoredSession(sessionFor(EXPORTER));
    const fetchMock = stubAnalyticsRoutes(EXPORTER);
    renderShell();
    const user = userEvent.setup();

    expect(await screen.findByLabelText('Phone or user ID')).toBeInTheDocument();
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Rana Khoury');
    expect(rows[0]).toHaveTextContent('+963944120551');
    expect(within(rows[0]).getByText('Rider')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Active')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Suspended')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Driver')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `/users/${RANA.userId}/trust`,
    );
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.getByText(/Export CSV downloads all 2 matching users/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Drivers' }));
    await waitFor(() =>
      expect(lastQuery(fetchMock, '/api/v1/admin/users').searchParams.get('role')).toBe('driver'),
    );
    await user.type(screen.getByLabelText('Signed up from'), '2026-10-01');
    await waitFor(() => {
      const from = lastQuery(fetchMock, '/api/v1/admin/users').searchParams.get('from');
      expect(from).toBe(new Date('2026-10-01T00:00:00').toISOString());
    });
    expect(window.location.search).toContain('role=driver');
  });

  it('hides Export CSV without analytics:export and keeps the lookup for wallet-only admins', async () => {
    window.history.pushState({}, '', '/users');
    seedStoredSession(sessionFor(USERS_ONLY));
    stubAnalyticsRoutes(USERS_ONLY);
    const { unmount } = renderShell();

    expect((await screen.findAllByRole('row')).length).toBe(3);
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    unmount();

    const walletOnly = adminUser(['wallets:view']);
    seedStoredSession(sessionFor(walletOnly));
    const fetchMock = stubAnalyticsRoutes(walletOnly);
    renderShell();
    expect(await screen.findByLabelText('Phone or user ID')).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/v1/admin/users')).toHaveLength(0);
  });

  it('lists drivers with online state, region and plate, and filters them', async () => {
    window.history.pushState({}, '', '/drivers');
    seedStoredSession(sessionFor(EXPORTER));
    const fetchMock = stubAnalyticsRoutes(EXPORTER);
    renderShell();
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { level: 1, name: 'Drivers' })).toBeInTheDocument();
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows[0]).toHaveTextContent('Khaled Masri');
    expect(rows[0]).toHaveTextContent('Approved');
    expect(rows[0]).toHaveTextContent('Online');
    expect(rows[0]).toHaveTextContent('Damascus');
    expect(rows[0]).toHaveTextContent('دمشق 482173');
    expect(rows[1]).toHaveTextContent('Under review');
    expect(rows[1]).toHaveTextContent('Offline');

    await user.click(screen.getByRole('button', { name: 'Online' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Region' }), 'Damascus');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Application status' }),
      'Approved',
    );
    await waitFor(() => {
      const query = lastQuery(fetchMock, '/api/v1/admin/drivers');
      expect(query.searchParams.get('online')).toBe('true');
      expect(query.searchParams.get('regionId')).toBe(DAMASCUS_ID);
      expect(query.searchParams.get('status')).toBe('approved');
    });
  });

  it('lists wallet and ledger rows together with signed amounts and filters', async () => {
    window.history.pushState({}, '', '/transactions');
    seedStoredSession(sessionFor(EXPORTER));
    const fetchMock = stubAnalyticsRoutes(EXPORTER);
    renderShell();
    const user = userEvent.setup();

    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows[0]).toHaveTextContent('Rana Khoury');
    expect(rows[0]).toHaveTextContent('Rider wallet');
    expect(rows[0]).toHaveTextContent('Credit grant');
    expect(rows[0]).toHaveTextContent('Support ticket T-8F2A1C09');
    expect(rows[0]).toHaveTextContent('SYP +25,000');
    expect(rows[1]).toHaveTextContent('Driver ledger');
    expect(rows[1]).toHaveTextContent('SYP −8,800');
    expect(within(rows[1]).getByRole('link', { name: 'R-RRRRRRRR' })).toBeInTheDocument();
    expect(screen.getByText(/Export CSV downloads all 9,214 matching rows/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Driver ledgers' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'Commission due');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'SYP');
    await waitFor(() => {
      const query = lastQuery(fetchMock, '/api/v1/admin/transactions');
      expect(query.searchParams.get('source')).toBe('driver_ledger');
      expect(query.searchParams.get('type')).toBe('commission_due');
      expect(query.searchParams.get('currency')).toBe('SYP');
    });
  });

  it('gates the Drivers and Transactions menu entries', async () => {
    window.history.pushState({}, '', '/');
    const walletOnly = adminUser(['wallets:view']);
    seedStoredSession(sessionFor(walletOnly));
    stubAnalyticsRoutes(walletOnly);
    const { unmount } = renderShell();
    await screen.findByRole('link', { name: 'Users' });
    const nav = document.querySelector<HTMLElement>('.sidenav__nav');
    if (!nav) {
      throw new Error('sidenav missing');
    }
    expect(within(nav).queryByRole('link', { name: 'Drivers' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Transactions' })).not.toBeInTheDocument();
    unmount();

    seedStoredSession(sessionFor(EXPORTER));
    stubAnalyticsRoutes(EXPORTER);
    renderShell();
    expect(await screen.findByRole('link', { name: 'Drivers' })).toHaveAttribute(
      'href',
      '/drivers',
    );
    expect(screen.getByRole('link', { name: 'Transactions' })).toHaveAttribute(
      'href',
      '/transactions',
    );
  });
});

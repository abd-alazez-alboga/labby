import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminUser } from '../api/analytics';
import i18n from '../i18n/i18n';
import { page } from './analytics-fixtures';
import { DRIVER_ID, SETTLER, stubMoneyRoutes } from './money-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
} from './test-utils';

/**
 * Owner decision (UC-A-27): with users:view the Driver ledgers lookup finds a
 * driver by name or phone over GET /admin/users `q` + `role=driver` — the
 * Users page's search — instead of the ride history; a pasted ID opens the
 * ledger. Admins without users:view keep the ride-history lookup.
 */

const LEDGER_SEARCHER = adminUser(['settlements:view', 'users:view', 'rides:view']);

const KHALED: AdminUser = {
  userId: DRIVER_ID,
  name: 'Khaled Darwish',
  phone: '+963955101334',
  state: 'active',
  roles: [
    { role: 'rider', state: 'active' },
    { role: 'driver', state: 'active' },
  ],
  createdAt: '2026-09-02T08:15:00Z',
};

const OTHER: AdminUser = {
  ...KHALED,
  userId: '11111111-2222-4333-8444-555555555555',
  name: 'Maher Saleh',
  phone: '+963955101999',
};

function usersQueries(fetchMock: ReturnType<typeof stubMoneyRoutes>): URL[] {
  return callsTo(fetchMock, '/api/v1/admin/users')
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === '/api/v1/admin/users');
}

function stub() {
  seedStoredSession(sessionFor(LEDGER_SEARCHER));
  return stubMoneyRoutes(LEDGER_SEARCHER, (method, path, _init, url) => {
    if (method === 'GET' && path === '/api/v1/admin/users') {
      const q = url?.searchParams.get('q');
      if (q === 'darwish' || q === '0955 101 334') {
        return jsonResponse(200, page([KHALED]));
      }
      if (q === null) {
        return jsonResponse(200, page([KHALED, OTHER]));
      }
      return jsonResponse(200, page([]));
    }
    return null;
  });
}

describe('driver ledgers name / phone search', () => {
  beforeAll(async () => {
    await import('../pages/DriverLedgersPage');
    await import('../pages/DriverLedgerPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/driver-ledgers');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
  });

  it('searches drivers by name with q and role=driver, then opens the ledger', async () => {
    const fetchMock = stub();
    const user = userEvent.setup();
    renderShell();

    const box = await screen.findByRole('textbox', { name: 'Search drivers by name or phone' });
    expect(screen.getByRole('search')).toHaveTextContent('Find a driver');
    expect(box).toHaveAttribute('placeholder', 'Name or phone number');
    expect(
      screen.getByText(
        'Searches every driver by name or phone number. A pasted user ID opens that driver’s ledger directly.',
      ),
    ).toBeInTheDocument();
    // Every driver is listed before a search (owner decision 2026-11-09).
    expect(await screen.findByText('2 drivers')).toBeInTheDocument();
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);
    const initial = usersQueries(fetchMock).at(-1);
    expect(initial?.searchParams.get('q')).toBeNull();
    expect(initial?.searchParams.get('role')).toBe('driver');

    await user.type(box, 'darwish');

    expect(await screen.findByText(/^1 driver matches “darwish”/)).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Darwish').tagName).toBe('MARK');
    expect(rows[0]).toHaveTextContent('+963955101334');
    const last = usersQueries(fetchMock).at(-1);
    expect(last?.searchParams.get('q')).toBe('darwish');
    expect(last?.searchParams.get('role')).toBe('driver');
    expect(window.location.search).toContain('q=darwish');
    // The ride history is never consulted.
    expect(callsTo(fetchMock, '/api/v1/admin/rides')).toHaveLength(0);

    await user.click(within(rows[0]).getByRole('link', { name: 'Open ledger' }));
    expect(await screen.findByRole('heading', { name: 'Ledger' })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/driver-ledgers/${DRIVER_ID}`);
    expect(screen.getByRole('heading', { name: 'Khaled Darwish' })).toBeInTheDocument();
  });

  it('searches a typed phone on Enter and leaves normalization to the server', async () => {
    const fetchMock = stub();
    const user = userEvent.setup();
    renderShell();

    await user.type(
      await screen.findByRole('textbox', { name: 'Search drivers by name or phone' }),
      '0955 101 334{Enter}',
    );

    await waitFor(() =>
      expect(usersQueries(fetchMock).at(-1)?.searchParams.get('q')).toBe('0955 101 334'),
    );
    expect(await screen.findByText('Khaled Darwish')).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/v1/admin/rides')).toHaveLength(0);
  });

  it('shows the no-match state and clears the search', async () => {
    const fetchMock = stub();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/driver-ledgers?q=Yousef+Kh');
    renderShell();

    expect(await screen.findByText('No drivers match “Yousef Kh”')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Check the spelling or search by phone number. Search covers every driver, including drivers who have never completed a ride.',
      ),
    ).toBeInTheDocument();

    const empty = screen.getByText('No drivers match “Yousef Kh”').closest('.search-empty')!;
    await user.click(within(empty as HTMLElement).getByRole('button', { name: 'Clear search' }));

    expect(screen.getByRole('textbox', { name: 'Search drivers by name or phone' })).toHaveValue(
      '',
    );
    await waitFor(() => expect(window.location.search).not.toContain('q='));
    expect(screen.queryByText('No drivers match “Yousef Kh”')).not.toBeInTheDocument();
    // Clearing goes back to the full list (opened on a search, so two fetches).
    expect(await screen.findByText('2 drivers')).toBeInTheDocument();
    expect(usersQueries(fetchMock)).toHaveLength(2);
  });

  it('opens a pasted user ID directly on Enter, without a search', async () => {
    const fetchMock = stub();
    const user = userEvent.setup();
    renderShell();

    await user.type(
      await screen.findByRole('textbox', { name: 'Search drivers by name or phone' }),
      `${DRIVER_ID}{Enter}`,
    );

    expect(await screen.findByRole('heading', { name: 'Ledger' })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/driver-ledgers/${DRIVER_ID}`);
    // Only the initial list was fetched; the ID was never searched.
    expect(usersQueries(fetchMock)).toHaveLength(1);
  });

  it('renders the search in Arabic', async () => {
    await i18n.changeLanguage('ar');
    stub();
    window.history.pushState({}, '', '/driver-ledgers?q=darwish');
    renderShell();

    expect(
      await screen.findByRole('textbox', { name: 'ابحث عن السائقين بالاسم أو رقم الهاتف' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/^1 سائق يطابق «darwish»/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'فتح السجل' })).toBeInTheDocument();
  });

  it('keeps the ride-history lookup without users:view', async () => {
    seedStoredSession(sessionFor(SETTLER));
    const fetchMock = stubMoneyRoutes(SETTLER);
    renderShell();

    expect(await screen.findByLabelText('Phone or user ID')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Search drivers by name or phone' }),
    ).not.toBeInTheDocument();
    expect(usersQueries(fetchMock)).toHaveLength(0);
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminRideSummary } from '../api/rides';
import i18n from '../i18n/i18n';
import { candidatesFromRides } from '../pages/money/lookup-utils';
import {
  adminRide,
  DRIVER_ID,
  ridePage,
  stubMoneyRoutes,
  USER_ID,
  WALLET_MANAGER,
} from './money-fixtures';
import { adminUser, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

const PHONE = '+963955101334';

/**
 * The minimal M8 lookup pages: a phone resolves through the admin ride
 * search (rides:view), a pasted ID opens the detail directly, and the
 * ledger lookup only lists drivers.
 */
describe('money user lookup', () => {
  beforeAll(async () => {
    await import('../pages/UsersPage');
    await import('../pages/UserWalletPage');
    await import('../pages/DriverLedgersPage');
    await import('../pages/DriverLedgerPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dedupes the matched rides into users and opens the wallet', async () => {
    seedStoredSession(sessionFor(WALLET_MANAGER));
    const fetchMock = stubMoneyRoutes(WALLET_MANAGER, (method, path, _init, url) =>
      method === 'GET' && path === '/api/v1/admin/rides' && url?.searchParams.get('phone') === PHONE
        ? jsonResponse(200, ridePage([adminRide(), adminRide({ id: 'ride-x' })]))
        : null,
    );
    window.history.pushState({}, '', '/users');
    renderShell();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Phone or user ID'), PHONE);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // Two rides, two distinct users — each listed once.
    expect(await screen.findByText('Rana Khoury')).toBeInTheDocument();
    expect(screen.getByText('Khaled Darwish')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open wallet' })).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Open wallet' })[0]);
    expect(await screen.findByRole('heading', { name: 'Wallet activity' })).toBeInTheDocument();
    // The lookup passed the name along to the wallet header.
    expect(screen.getByRole('heading', { name: 'Rana Khoury' })).toBeInTheDocument();
    const walletCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(`/api/v1/admin/users/${USER_ID}/wallet`),
    );
    expect(walletCalls.length).toBeGreaterThan(0);
  });

  it('opens a pasted user ID directly, without a ride search', async () => {
    seedStoredSession(sessionFor(WALLET_MANAGER));
    const fetchMock = stubMoneyRoutes(WALLET_MANAGER);
    window.history.pushState({}, '', '/users');
    renderShell();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Phone or user ID'), USER_ID);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('heading', { name: 'Wallet activity' })).toBeInTheDocument();
    const phoneSearches = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('phone='),
    );
    expect(phoneSearches).toHaveLength(0);
  });

  it('asks for a user ID when the admin cannot search rides', async () => {
    const viewerOnly = adminUser(['wallets:view']);
    seedStoredSession(sessionFor(viewerOnly));
    const fetchMock = stubMoneyRoutes(viewerOnly);
    window.history.pushState({}, '', '/users');
    renderShell();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Phone or user ID'), PHONE);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/needs the .View rides. permission/)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/admin/rides')),
    ).toHaveLength(0);
  });

  it('lists only drivers in the ledger lookup and opens the ledger', async () => {
    const settler = adminUser(['settlements:view', 'settlements:record', 'rides:view']);
    seedStoredSession(sessionFor(settler));
    stubMoneyRoutes(settler, (method, path, _init, url) =>
      method === 'GET' && path === '/api/v1/admin/rides' && url?.searchParams.has('phone')
        ? jsonResponse(200, ridePage([adminRide()]))
        : null,
    );
    window.history.pushState({}, '', '/driver-ledgers');
    renderShell();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Phone or user ID'), PHONE);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Khaled Darwish')).toBeInTheDocument();
    expect(screen.queryByText('Rana Khoury')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open ledger' }));
    expect(await screen.findByRole('heading', { name: 'Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Khaled Darwish' })).toBeInTheDocument();
  });

  it('shows the empty state when no ride matches the phone', async () => {
    seedStoredSession(sessionFor(WALLET_MANAGER));
    stubMoneyRoutes(WALLET_MANAGER, (method, path, _init, url) =>
      method === 'GET' && path === '/api/v1/admin/rides' && url?.searchParams.has('phone')
        ? jsonResponse(200, ridePage([]))
        : null,
    );
    window.history.pushState({}, '', '/users');
    renderShell();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Phone or user ID'), PHONE);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/No rides matched this phone/)).toBeInTheDocument();
  });
});

describe('candidatesFromRides', () => {
  it('counts appearances and keeps rider/driver roles apart', () => {
    const rides: AdminRideSummary[] = [
      adminRide(),
      adminRide({ id: 'r2', driverUserId: null, driverName: null }),
      adminRide({
        id: 'r3',
        riderUserId: DRIVER_ID,
        riderName: 'Khaled Darwish',
        driverUserId: null,
        driverName: null,
      }),
    ];
    const all = candidatesFromRides(rides, false);
    expect(all.map((c) => c.userId)).toEqual([USER_ID, DRIVER_ID]);
    expect(all[0]).toMatchObject({ rider: true, driver: false, rides: 2 });
    expect(all[1]).toMatchObject({ rider: true, driver: true, rides: 2 });

    const driversOnly = candidatesFromRides(rides, true);
    expect(driversOnly.map((c) => c.userId)).toEqual([DRIVER_ID]);
    expect(driversOnly[0]).toMatchObject({ rider: false, driver: true, rides: 1 });
  });
});

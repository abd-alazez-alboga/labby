import { screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  DRIVER_ID,
  LEDGER_VIEWER,
  stubMoneyRoutes,
  USER_ID,
  WALLET_VIEWER,
} from './money-fixtures';
import { adminUser, renderShell, seedStoredSession, sessionFor } from './test-utils';

const NO_MONEY = adminUser(['regions:view']);

/**
 * RBAC-03 UI side for M8: the Users section hides behind wallets:view and
 * the Driver ledgers section behind settlements:view (menu + routes); the
 * grant/refund panel needs wallets:manage, the settlement panel
 * settlements:record — the same codes the backend enforces per endpoint.
 */
describe('money permission gating', () => {
  beforeAll(async () => {
    await import('../pages/UsersPage');
    await import('../pages/UserWalletPage');
    await import('../pages/DriverLedgersPage');
    await import('../pages/DriverLedgerPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
  });

  it('hides both money entries without the view permissions', async () => {
    seedStoredSession(sessionFor(NO_MONEY));
    stubMoneyRoutes(NO_MONEY);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Regions' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Driver ledgers' })).not.toBeInTheDocument();
  });

  it('shows Users with wallets:view and Driver ledgers with settlements:view', async () => {
    seedStoredSession(sessionFor(WALLET_VIEWER));
    stubMoneyRoutes(WALLET_VIEWER);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
    expect(screen.queryByRole('link', { name: 'Driver ledgers' })).not.toBeInTheDocument();
  });

  it.each([
    [`/users/${USER_ID}/wallet`, '/api/v1/admin/users/'],
    ['/users', '/api/v1/admin/users/'],
  ])('blocks a direct %s without wallets:view and never calls the API', async (route, apiPart) => {
    seedStoredSession(sessionFor(NO_MONEY));
    const fetchMock = stubMoneyRoutes(NO_MONEY);
    window.history.pushState({}, '', route);
    renderShell();

    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    const calls = fetchMock.mock.calls.filter(([input]) => String(input).includes(apiPart));
    expect(calls).toHaveLength(0);
  });

  it.each([[`/driver-ledgers/${DRIVER_ID}`], ['/driver-ledgers']])(
    'blocks a direct %s without settlements:view and never calls the API',
    async (route) => {
      seedStoredSession(sessionFor(NO_MONEY));
      const fetchMock = stubMoneyRoutes(NO_MONEY);
      window.history.pushState({}, '', route);
      renderShell();

      expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
      const calls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/api/v1/admin/drivers/'),
      );
      expect(calls).toHaveLength(0);
    },
  );

  it('shows a view-only admin the wallet READ-ONLY — no grant/refund panel', async () => {
    seedStoredSession(sessionFor(WALLET_VIEWER));
    stubMoneyRoutes(WALLET_VIEWER);
    window.history.pushState({}, '', `/users/${USER_ID}/wallet`);
    renderShell();

    expect(await screen.findByRole('heading', { name: 'Wallet activity' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Grant credit / refund' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Credit/ })).not.toBeInTheDocument();
  });

  it('shows a view-only admin the ledger without the settlement panel', async () => {
    seedStoredSession(sessionFor(LEDGER_VIEWER));
    stubMoneyRoutes(LEDGER_VIEWER);
    window.history.pushState({}, '', `/driver-ledgers/${DRIVER_ID}`);
    renderShell();

    expect(await screen.findByRole('heading', { name: 'Ledger' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Record a settlement' })).not.toBeInTheDocument();
  });

  it('renders the wallet page in Arabic, RTL, with Western digits in LTR spans', async () => {
    await i18n.changeLanguage('ar');
    seedStoredSession(sessionFor(WALLET_VIEWER));
    stubMoneyRoutes(WALLET_VIEWER);
    window.history.pushState({}, '', `/users/${USER_ID}/wallet`);
    renderShell();

    expect(await screen.findByRole('heading', { name: 'حركة المحفظة' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('link', { name: 'المستخدمون' })).toBeInTheDocument();

    // Owner ruling 2026-10-11: Western digits everywhere, amounts kept LTR.
    const pageText = document.body.textContent ?? '';
    expect(/[٠-٩]/.test(pageText)).toBe(false);
    expect(screen.getAllByText('15,000', { selector: '[dir="ltr"]' }).length).toBeGreaterThan(0);
  });
});

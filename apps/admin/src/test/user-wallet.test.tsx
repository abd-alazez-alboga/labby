import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WalletCreditRequest } from '../api/money';
import i18n from '../i18n/i18n';
import {
  RIDE_1,
  stubMoneyRoutes,
  transaction,
  transactionPage,
  transactions,
  USER_ID,
  WALLET_MANAGER,
  walletView,
} from './money-fixtures';
import { bodyOf } from './onboarding-fixtures';
import { jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

/**
 * UC-A-15 against contract mocks (money-v1.yaml): wallet inspection with
 * dues, a grant happy path updating balances instantly, the mandatory
 * refund ride link, an inline 400, and transaction pagination.
 */
describe('user wallet page', () => {
  beforeAll(async () => {
    await import('../pages/UserWalletPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/users/${USER_ID}/wallet`);
    seedStoredSession(sessionFor(WALLET_MANAGER));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows balances, the pending due, and the typed history with ride links', async () => {
    stubMoneyRoutes(WALLET_MANAGER);
    renderShell();

    expect(await screen.findByText('Wallet balance · SYP')).toBeInTheDocument();
    expect(screen.getAllByText('15,000', { selector: '[dir="ltr"]' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Pending due · SYP')).toBeInTheDocument();
    expect(screen.getByText(/collects on next ride/)).toBeInTheDocument();

    // Typed entries: a refund with its reason, a tip debit, a ride payment.
    expect(await screen.findByText('Refund', { selector: '.entry__type' })).toBeInTheDocument();
    expect(screen.getByText('overcharged wait')).toBeInTheDocument();
    expect(screen.getByText('Tip', { selector: '.entry__type' })).toBeInTheDocument();
    expect(screen.getByText('Ride payment')).toBeInTheDocument();
    expect(screen.getByText('+20,000')).toBeInTheDocument();
    expect(screen.getByText('−27,250')).toBeInTheDocument();
    // The linked ride is labelled by its request moment (rides:view loaded).
    expect(screen.getAllByText(/^Ride Oct 8/).length).toBeGreaterThan(0);
  });

  it('grants credit and updates the balances instantly', async () => {
    let credited = false;
    const fetchMock = stubMoneyRoutes(WALLET_MANAGER, (method, path) => {
      if (method === 'POST' && path === `/api/v1/admin/users/${USER_ID}/wallet/credits`) {
        credited = true;
        return jsonResponse(
          201,
          transaction({ id: 'tx-new', type: 'admin_grant', amount: 5000, balanceAfter: 20000 }),
        );
      }
      if (method === 'GET' && path === `/api/v1/admin/users/${USER_ID}/wallet` && credited) {
        return jsonResponse(200, walletView({ balances: [{ currency: 'SYP', balance: 20000 }] }));
      }
      return null;
    });
    renderShell();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Grant credit / refund' });
    await user.type(screen.getByLabelText('Amount · SYP'), '5000');
    await user.type(screen.getByLabelText(/Reason/), 'goodwill');
    await user.click(screen.getByRole('button', { name: 'Credit SYP 5,000' }));

    expect(await screen.findByText(/Credited SYP 5,000/)).toBeInTheDocument();
    const body = bodyOf(
      fetchMock,
      'POST',
      `/api/v1/admin/users/${USER_ID}/wallet/credits`,
    ) as WalletCreditRequest;
    expect(body).toEqual({
      type: 'grant',
      amount: 5000,
      currency: 'SYP',
      reason: 'goodwill',
      rideId: null,
    });
    // UC-A-15: the new balance shows without a manual refresh.
    expect(
      (await screen.findAllByText('20,000', { selector: '[dir="ltr"]' })).length,
    ).toBeGreaterThan(0);
  });

  it('refuses a refund without a linked ride, then sends it with one', async () => {
    const fetchMock = stubMoneyRoutes(WALLET_MANAGER, (method, path) =>
      method === 'POST' && path === `/api/v1/admin/users/${USER_ID}/wallet/credits`
        ? jsonResponse(201, transaction({ id: 'tx-r', amount: 20000 }))
        : null,
    );
    renderShell();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Grant credit / refund' });
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    await user.type(screen.getByLabelText('Amount · SYP'), '20000');
    await user.type(screen.getByLabelText(/Reason/), 'overcharged wait');
    await user.click(screen.getByRole('button', { name: 'Credit SYP 20,000' }));

    // PAY-03: the ride link is mandatory for refunds — nothing was sent.
    expect(
      await screen.findByText("A refund must be linked to one of the user's rides."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'POST'),
    ).toHaveLength(0);

    await user.selectOptions(
      screen.getByLabelText(/Linked ride/),
      await screen.findByRole('option', { name: /Umayyad Square/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Credit SYP 20,000' }));

    await waitFor(() => {
      const body = bodyOf(
        fetchMock,
        'POST',
        `/api/v1/admin/users/${USER_ID}/wallet/credits`,
      ) as WalletCreditRequest;
      expect(body.type).toBe('refund');
      expect(body.rideId).toBe(RIDE_1);
      expect(body.reason).toBe('overcharged wait');
    });
  });

  it('surfaces a server 400 (bad ride link) inline', async () => {
    stubMoneyRoutes(WALLET_MANAGER, (method, path) =>
      method === 'POST' && path === `/api/v1/admin/users/${USER_ID}/wallet/credits`
        ? jsonResponse(400, { status: 400, message: 'Not a ride of this user' })
        : null,
    );
    renderShell();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Grant credit / refund' });
    await user.type(screen.getByLabelText('Amount · SYP'), '1000');
    await user.type(screen.getByLabelText(/Reason/), 'test');
    await user.click(screen.getByRole('button', { name: 'Credit SYP 1,000' }));

    expect(
      await screen.findByText(
        'The server rejected the entry — check the amount, currency and ride link.',
      ),
    ).toBeInTheDocument();
  });

  it('pages through the transaction history', async () => {
    const secondPage = [
      transaction({ id: 'tx-old', type: 'promo', amount: 12250, reason: 'welcome credit' }),
    ];
    stubMoneyRoutes(WALLET_MANAGER, (method, path, _init, url) => {
      if (method === 'GET' && path === `/api/v1/admin/users/${USER_ID}/wallet/transactions`) {
        const page = Number(url?.searchParams.get('page') ?? '0');
        return jsonResponse(
          200,
          transactionPage({
            items: page === 0 ? transactions() : secondPage,
            page,
            totalItems: 23,
            totalPages: 2,
          }),
        );
      }
      return null;
    });
    renderShell();
    const user = userEvent.setup();

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Promotion')).toBeInTheDocument();
    expect(screen.getByText('welcome credit')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });
});

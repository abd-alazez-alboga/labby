import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SettlementRequest, SettlementResponse } from '../api/money';
import i18n from '../i18n/i18n';
import {
  blockedLedgerView,
  DRIVER_ID,
  ledgerEntry,
  ledgerView,
  SETTLER,
  stubMoneyRoutes,
} from './money-fixtures';
import { bodyOf } from './onboarding-fixtures';
import { jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

function settlementResponse(overrides: Partial<SettlementResponse> = {}): SettlementResponse {
  return {
    id: 'set-new',
    driverUserId: DRIVER_ID,
    currency: 'SYP',
    amount: 500000,
    direction: 'pay_in',
    note: null,
    createdAt: '2026-10-11T13:00:00Z',
    balance: 70000,
    floorStatus: 'ok',
    ...overrides,
  };
}

/**
 * UC-A-27 against contract mocks (money-v1.yaml): the typed ledger with
 * floor-status chips, settlement recording with instant floor feedback —
 * including the blocked → ok transition resuming offers — pagination and
 * the per-currency filter.
 */
describe('driver ledger page', () => {
  beforeAll(async () => {
    await import('../pages/DriverLedgerPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/driver-ledgers/${DRIVER_ID}`);
    seedStoredSession(sessionFor(SETTLER));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows balance, floor, the warning chip and typed entries', async () => {
    stubMoneyRoutes(SETTLER);
    renderShell();

    expect(await screen.findByText('Balance · SYP')).toBeInTheDocument();
    expect(screen.getAllByText('−430,000', { selector: '[dir="ltr"]' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Floor · SYP')).toBeInTheDocument();
    expect(screen.getByText('−500,000', { selector: '[dir="ltr"]' })).toBeInTheDocument();
    expect(screen.getByText('Near the floor')).toBeInTheDocument();

    expect(screen.getByText('Commission due')).toBeInTheDocument();
    expect(screen.getByText('fare 28,000 · 25%')).toBeInTheDocument();
    expect(screen.getByText('Tip')).toBeInTheDocument();
    expect(screen.getByText('commission-free')).toBeInTheDocument();
    expect(screen.getByText('Settlement · pay-in')).toBeInTheDocument();
    expect(screen.getByText('+150,000')).toBeInTheDocument();
  });

  it('labels the M13 promo compensation entry as platform-funded', async () => {
    stubMoneyRoutes(SETTLER, (method, path) => {
      if (method === 'GET' && path === `/api/v1/admin/drivers/${DRIVER_ID}/ledger`) {
        return jsonResponse(
          200,
          ledgerView({
            entries: [
              ledgerEntry(),
              ledgerEntry({
                id: 'led-promo',
                amount: 2800,
                type: 'promo_compensation',
                fareAmount: null,
                commissionRate: null,
                commissionAmount: null,
                balanceAfter: -427200,
                createdAt: '2026-10-11T12:24:01Z',
              }),
            ],
          }),
        );
      }
      return null;
    });
    renderShell();

    expect(await screen.findByText('Promo top-up · platform-funded')).toBeInTheDocument();
    expect(screen.getByText('promo discount on this ride, covered by Labby')).toBeInTheDocument();
    expect(screen.getByText('+2,800')).toBeInTheDocument();
  });

  it('records a pay-in with a floor preview and instant feedback', async () => {
    let recorded = false;
    const fetchMock = stubMoneyRoutes(SETTLER, (method, path) => {
      if (method === 'POST' && path === `/api/v1/admin/drivers/${DRIVER_ID}/settlements`) {
        recorded = true;
        return jsonResponse(201, settlementResponse());
      }
      if (method === 'GET' && path === `/api/v1/admin/drivers/${DRIVER_ID}/ledger` && recorded) {
        return jsonResponse(
          200,
          ledgerView({
            balances: [{ currency: 'SYP', balance: 70000, floor: -500000, status: 'ok' }],
          }),
        );
      }
      return null;
    });
    renderShell();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Record a settlement' });
    await user.type(screen.getByLabelText('Amount · SYP'), '500000');

    // "After recording" preview: −430,000 + 500,000 = 70,000, above the floor.
    expect(await screen.findByText('After recording')).toBeInTheDocument();
    expect(screen.getByText(/SYP 70,000 · above the floor\./)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Note'), 'Office cash · receipt #2214');
    await user.click(screen.getByRole('button', { name: 'Record pay-in of SYP 500,000' }));

    expect(
      await screen.findByText('Settlement recorded — new balance SYP 70,000.'),
    ).toBeInTheDocument();
    const body = bodyOf(
      fetchMock,
      'POST',
      `/api/v1/admin/drivers/${DRIVER_ID}/settlements`,
    ) as SettlementRequest;
    expect(body).toEqual({
      amount: 500000,
      direction: 'pay_in',
      currency: 'SYP',
      note: 'Office cash · receipt #2214',
    });
    // The response's balance shows immediately in the KPI tile.
    expect(screen.getAllByText('70,000', { selector: '[dir="ltr"]' }).length).toBeGreaterThan(0);
  });

  it('flips a BLOCKED driver back to ok: offers-resume note + chip update', async () => {
    let recorded = false;
    stubMoneyRoutes(SETTLER, (method, path) => {
      if (method === 'GET' && path === `/api/v1/admin/drivers/${DRIVER_ID}/ledger`) {
        return jsonResponse(
          200,
          recorded
            ? ledgerView({
                balances: [{ currency: 'SYP', balance: -10000, floor: -500000, status: 'ok' }],
              })
            : blockedLedgerView(),
        );
      }
      if (method === 'POST' && path === `/api/v1/admin/drivers/${DRIVER_ID}/settlements`) {
        recorded = true;
        return jsonResponse(201, settlementResponse({ balance: -10000, floorStatus: 'ok' }));
      }
      return null;
    });
    renderShell();
    const user = userEvent.setup();

    // Blocked state is unmistakable before the settlement.
    expect(await screen.findByText('Blocked — offers paused')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Amount · SYP'), '500000');
    // Preview already names the resume effect for a blocked driver.
    expect(
      await screen.findByText(/above the floor — ride offers resume and the driver is notified/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Record pay-in of SYP 500,000' }));

    expect(
      await screen.findByText(
        /new balance SYP −10,000\. Above the floor again: ride offers resume and the driver is notified\./,
      ),
    ).toBeInTheDocument();
    // Instant floor-status feedback: the chip leaves "blocked".
    await waitFor(() =>
      expect(screen.queryByText('Blocked — offers paused')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Above the floor')).toBeInTheDocument();
  });

  it('records a pay-out with the direction in the request', async () => {
    const fetchMock = stubMoneyRoutes(SETTLER, (method, path) =>
      method === 'POST' && path === `/api/v1/admin/drivers/${DRIVER_ID}/settlements`
        ? jsonResponse(
            201,
            settlementResponse({ amount: 50000, direction: 'pay_out', balance: -480000 }),
          )
        : null,
    );
    renderShell();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Record a settlement' });
    await user.click(screen.getByRole('button', { name: 'Pay-out' }));
    await user.type(screen.getByLabelText('Amount · SYP'), '50000');
    await user.click(screen.getByRole('button', { name: 'Record pay-out of SYP 50,000' }));

    await waitFor(() => {
      const body = bodyOf(
        fetchMock,
        'POST',
        `/api/v1/admin/drivers/${DRIVER_ID}/settlements`,
      ) as SettlementRequest;
      expect(body.direction).toBe('pay_out');
      expect(body.note).toBeNull();
    });
  });

  it('pages the ledger and filters by currency', async () => {
    stubMoneyRoutes(SETTLER, (method, path, _init, url) => {
      if (method === 'GET' && path === `/api/v1/admin/drivers/${DRIVER_ID}/ledger`) {
        const page = Number(url?.searchParams.get('page') ?? '0');
        const currency = url?.searchParams.get('currency');
        if (currency === 'USD') {
          return jsonResponse(
            200,
            ledgerView({
              balances: [
                { currency: 'SYP', balance: -430000, floor: -500000, status: 'warning' },
                { currency: 'USD', balance: 25, floor: -50, status: 'ok' },
              ],
              entries: [
                ledgerEntry({
                  id: 'led-usd',
                  currency: 'USD',
                  amount: 25,
                  type: 'bonus',
                  fareAmount: null,
                  commissionRate: null,
                  balanceAfter: 25,
                }),
              ],
              totalItems: 1,
              totalPages: 1,
            }),
          );
        }
        return jsonResponse(
          200,
          ledgerView({
            balances: [
              { currency: 'SYP', balance: -430000, floor: -500000, status: 'warning' },
              { currency: 'USD', balance: 25, floor: -50, status: 'ok' },
            ],
            entries:
              page === 0
                ? ledgerView().entries
                : [ledgerEntry({ id: 'led-old', type: 'ride_earning', amount: 21000 })],
            page,
            totalItems: 22,
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
    expect(await screen.findByText('Ride earning')).toBeInTheDocument();

    // Per-currency filter: picking USD refetches with ?currency=USD.
    await user.click(screen.getByRole('button', { name: 'USD' }));
    expect(await screen.findByText('Bonus')).toBeInTheDocument();
    expect(screen.getByText('Balance · USD')).toBeInTheDocument();
  });
  it('always requests the selected currency once the balances are known', async () => {
    const fetchMock = stubMoneyRoutes(SETTLER);
    renderShell();

    expect(await screen.findByText('Balance · SYP')).toBeInTheDocument();
    await waitFor(() => {
      const ledgerUrls = fetchMock.mock.calls
        .map(([input]) => new URL(String(input)))
        .filter((url) => url.pathname === `/api/v1/admin/drivers/${DRIVER_ID}/ledger`);
      // The first load cannot know the currencies; every later one names one.
      expect(ledgerUrls.length).toBeGreaterThan(1);
      expect(ledgerUrls[0].searchParams.get('currency')).toBeNull();
      expect(ledgerUrls.at(-1)?.searchParams.get('currency')).toBe('SYP');
    });
  });

  it('starts fresh when the route switches to another driver', async () => {
    const OTHER = '00000000-0000-4000-8000-00000000bb09';
    const fetchMock = stubMoneyRoutes(SETTLER, (method, path) => {
      if (method === 'GET' && path === `/api/v1/admin/drivers/${DRIVER_ID}/ledger`) {
        return jsonResponse(
          200,
          ledgerView({
            balances: [
              { currency: 'SYP', balance: -430000, floor: -500000, status: 'warning' },
              { currency: 'USD', balance: 25, floor: -50, status: 'ok' },
            ],
          }),
        );
      }
      if (method === 'GET' && path === `/api/v1/admin/drivers/${OTHER}/ledger`) {
        return jsonResponse(
          200,
          ledgerView({
            balances: [{ currency: 'SYP', balance: 1000, floor: -500000, status: 'ok' }],
            entries: [],
            totalItems: 0,
          }),
        );
      }
      return null;
    });
    renderShell();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'USD' }));
    expect(await screen.findByText('Balance · USD')).toBeInTheDocument();

    act(() => {
      window.history.pushState({}, '', `/driver-ledgers/${OTHER}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // The previous driver's USD filter does not leak into the new driver.
    expect(await screen.findByText('Balance · SYP')).toBeInTheDocument();
    const otherUrls = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === `/api/v1/admin/drivers/${OTHER}/ledger`);
    expect(otherUrls.some((url) => url.searchParams.get('currency') === 'USD')).toBe(false);
  });
});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  PROMO_FLASH,
  PROMO_WELCOME,
  PROMOS_ADMIN,
  PROMOS_VIEWER,
  promoFixture,
  promoPage,
  stubGrowthRoutes,
} from './growth-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
} from './test-utils';

/**
 * UC-A-26 against contract mocks (growth-v1.yaml): the promotions queue with
 * redemption counters, the Active KPI, Deactivate with its confirm (reserved
 * rides keep their discount), and `promos:view` / `promos:manage` gating.
 */
describe('promotions queue', () => {
  beforeAll(async () => {
    await import('../pages/PromosPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/promos');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubQueue(user = PROMOS_ADMIN, deactivated?: { status: number; body: unknown }) {
    seedStoredSession(sessionFor(user));
    return stubGrowthRoutes(user, (method, path, _init, url) => {
      if (method === 'GET' && path === '/api/v1/admin/promos') {
        if (url?.searchParams.get('active') === 'true' && url.searchParams.get('size') === '1') {
          return jsonResponse(200, { ...promoPage([], 3), size: 1 });
        }
        return jsonResponse(
          200,
          promoPage([
            promoFixture(),
            promoFixture({
              promoId: PROMO_FLASH,
              code: 'FLASH30',
              value: '30',
              maxDiscount: '15000',
              active: false,
              firstRideOnly: false,
              totalCap: 200,
              redemptionCount: 61,
              redeemedAmount: null,
            }),
          ]),
        );
      }
      if (method === 'PATCH' && path === `/api/v1/admin/promos/${PROMO_WELCOME}`) {
        if (deactivated) {
          return jsonResponse(deactivated.status, deactivated.body);
        }
        return jsonResponse(200, promoFixture({ active: false }));
      }
      return null;
    });
  }

  it('lists promos with discount, limits, redemption counters and status', async () => {
    stubQueue();
    renderShell();

    const row = (await screen.findByText('WELCOME20')).closest('tr')!;
    expect(within(row).getByText('20% · max SYP 10,000')).toBeInTheDocument();
    expect(within(row).getByText('1 / user · first ride only · Damascus')).toBeInTheDocument();
    expect(within(row).getByText(/188 of 1,000/)).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();

    const flash = screen.getByText('FLASH30').closest('tr')!;
    expect(within(flash).getByText('Deactivated')).toBeInTheDocument();
    // A deactivated promo has no further action.
    expect(within(flash).queryByRole('button', { name: 'Deactivate' })).toBeNull();

    // The Active KPI comes from the totalItems-only query.
    expect(screen.getByText('Active promos')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('deactivates after an inline confirm; reserved rides keep their discount', async () => {
    const fetchMock = stubQueue();
    renderShell();
    const user = userEvent.setup();

    const row = (await screen.findByText('WELCOME20')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Deactivate' }));
    expect(within(row).getByText('Stop new redemptions?')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText('WELCOME20 deactivated — reserved rides keep their discount.'),
    ).toBeInTheDocument();
    const patches = callsTo(fetchMock, `/api/v1/admin/promos/${PROMO_WELCOME}`);
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0][1]?.body))).toEqual({ active: false });
    expect(within(row).getByText('Deactivated')).toBeInTheDocument();
  });

  it('hides New promo and Deactivate without promos:manage', async () => {
    stubQueue(PROMOS_VIEWER);
    renderShell();

    await screen.findByText('WELCOME20');
    expect(screen.queryByRole('link', { name: 'New promo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull();
  });

  it('refuses the route without promos:view', async () => {
    const user = adminUser(['rides:view']);
    seedStoredSession(sessionFor(user));
    stubGrowthRoutes(user);
    renderShell();

    expect(await screen.findByText('No access')).toBeInTheDocument();
  });
});

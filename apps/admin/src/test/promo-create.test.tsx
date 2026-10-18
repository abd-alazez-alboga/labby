import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  DAMASCUS_ID,
  ECONOMY_ID,
  PROMOS_ADMIN,
  promoFixture,
  promoPage,
  stubGrowthRoutes,
} from './growth-fixtures';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

const STARTS_LOCAL = '2026-11-01T00:00';
const ENDS_LOCAL = '2026-11-15T23:59';

/**
 * UC-A-26 — the New promo form (growth-v1.yaml POST /admin/promos): the
 * request body (code uppercased, window as ISO, caps, restrictions,
 * first-ride-only), the fixed-needs-region rule and the taken-code conflict.
 */
describe('new promo form', () => {
  beforeAll(async () => {
    await import('../pages/PromoCreatePage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/promos/new');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCreate(response?: { status: number; body: unknown }) {
    seedStoredSession(sessionFor(PROMOS_ADMIN));
    return stubGrowthRoutes(PROMOS_ADMIN, (method, path) => {
      if (method === 'POST' && path === '/api/v1/admin/promos') {
        if (response) {
          return jsonResponse(response.status, response.body);
        }
        return jsonResponse(201, promoFixture({ code: 'EID26' }));
      }
      if (method === 'GET' && path === '/api/v1/admin/promos') {
        return jsonResponse(200, promoPage([]));
      }
      return null;
    });
  }

  async function fillCommonFields(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText('Code'), 'eid26');
    await user.type(screen.getByLabelText('Percent'), '15');
    await user.type(screen.getByLabelText('Max discount'), '8000');
    await user.type(screen.getByLabelText('Starts'), STARTS_LOCAL);
    await user.type(screen.getByLabelText('Ends'), ENDS_LOCAL);
    await user.type(screen.getByLabelText('Total uses (blank = no cap)'), '1000');
  }

  it('creates a percent promo: uppercased code, ISO window, caps and restrictions', async () => {
    const fetchMock = stubCreate();
    renderShell();
    const user = userEvent.setup();

    await fillCommonFields(user);
    await user.selectOptions(screen.getByLabelText('Region'), DAMASCUS_ID);
    await user.selectOptions(await screen.findByLabelText('Ride type'), ECONOMY_ID);
    await user.click(screen.getByLabelText(/First ride only/));
    await user.click(screen.getByRole('button', { name: 'Create promo' }));

    expect(await screen.findByText('EID26 created.')).toBeInTheDocument();
    const posts = callsTo(fetchMock, '/api/v1/admin/promos').filter(
      ([, init]) => init?.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
      code: 'EID26',
      type: 'percent',
      value: '15',
      maxDiscount: '8000',
      startsAt: new Date(STARTS_LOCAL).toISOString(),
      endsAt: new Date(ENDS_LOCAL).toISOString(),
      perUserLimit: 1,
      totalCap: 1000,
      regionId: DAMASCUS_ID,
      serviceTypeId: ECONOMY_ID,
      firstRideOnly: true,
    });
  });

  it('refuses a fixed amount without a region before calling the backend', async () => {
    const fetchMock = stubCreate();
    renderShell();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Code'), 'SHAM5000');
    await user.selectOptions(screen.getByLabelText('Discount type'), 'fixed');
    await user.type(screen.getByLabelText('Amount'), '5000');
    await user.type(screen.getByLabelText('Starts'), STARTS_LOCAL);
    await user.type(screen.getByLabelText('Ends'), ENDS_LOCAL);
    await user.click(screen.getByRole('button', { name: 'Create promo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A fixed-amount promo needs a region.',
    );
    expect(
      callsTo(fetchMock, '/api/v1/admin/promos').filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(0);
  });

  it('shows the conflict message when the code is taken', async () => {
    stubCreate({
      status: 409,
      body: { status: 409, message: 'promo_code_taken', code: 'promo_code_taken' },
    });
    renderShell();
    const user = userEvent.setup();

    await fillCommonFields(user);
    await user.click(screen.getByRole('button', { name: 'Create promo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is already in use by another promo.',
    );
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WalletCreditRequest } from '../api/money';
import type { AdminRideDetail } from '../api/rides';
import i18n from '../i18n/i18n';
import { RIDE_DETAIL, SOS_RIDE_ID } from './comms-fixtures';
import {
  adminRide,
  RIDE_1,
  ridePage,
  stubMoneyRoutes,
  transaction,
  USER_ID,
} from './money-fixtures';
import { bodyOf } from './onboarding-fixtures';
import {
  adminUser,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  stubFetchRoutes,
} from './test-utils';

/**
 * V1 audit W28 (M8-T5 "from ride detail"; boards V1FAdminRideRefund and
 * V1FAdminRideRefundWallet): "Refund rider" on the ride detail opens the
 * rider's wallet with Refund selected and the ride already linked.
 */

vi.mock('../pages/rides/RideTraceMap', () => ({
  RideTraceMap: () => <div role="region" aria-label="trace" />,
}));

const REFUNDER = adminUser(['rides:view', 'wallets:view', 'wallets:manage', 'users:view']);
const VIEW_ONLY = adminUser(['rides:view', 'wallets:view']);
/** wallets:manage without wallets:view could not open the wallet page. */
const MANAGE_ONLY = adminUser(['rides:view', 'wallets:manage']);

const DETAIL_PATH = `/api/v1/admin/rides/${SOS_RIDE_ID}`;

function stubRide(user = REFUNDER, detail: AdminRideDetail = RIDE_DETAIL) {
  seedStoredSession(sessionFor(user));
  return stubFetchRoutes((method, path) => {
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'GET' && path === DETAIL_PATH) {
      return jsonResponse(200, detail);
    }
    return null;
  });
}

/** The completed, wallet-paid ride the wallet page was opened from. */
function paidRide(overrides: Partial<AdminRideDetail['ride']> = {}): AdminRideDetail {
  return {
    ...RIDE_DETAIL,
    riderUserId: USER_ID,
    riderName: 'Rana Khoury',
    ride: {
      ...RIDE_DETAIL.ride,
      id: RIDE_1,
      state: 'completed',
      paymentMethod: 'wallet',
      paymentStatus: 'paid_wallet',
      fare: {
        distanceMeters: 6100,
        durationSeconds: 840,
        components: { ...RIDE_DETAIL.ride.estimate.components, total: 27250 },
      },
      ...overrides,
    },
  };
}

const SHARED: AdminRideDetail = {
  ...RIDE_DETAIL,
  riderName: 'Rana H.',
  ride: {
    ...RIDE_DETAIL.ride,
    state: 'completed',
    kind: 'shared',
    paymentStatus: 'split',
    shared: {
      totalSeats: 3,
      seatsTaken: 3,
      members: [
        {
          memberId: 'm-rana',
          riderUserId: 'user-lina',
          firstName: 'Rana',
          isCreator: true,
          partySize: 2,
          status: 'completed',
          paymentMethod: 'cash',
        },
        {
          memberId: 'm-omar',
          riderUserId: 'user-omar',
          firstName: 'Omar',
          isCreator: false,
          partySize: 1,
          status: 'completed',
          paymentMethod: 'wallet',
        },
        {
          memberId: 'm-left',
          riderUserId: 'user-sami',
          firstName: 'Sami',
          isCreator: false,
          partySize: 1,
          status: 'left',
          paymentMethod: 'cash',
        },
      ],
    },
  },
};

describe('refund rider from the ride detail (V1 audit W28)', () => {
  beforeAll(async () => {
    await import('../pages/RideDetailPage');
    await import('../pages/UserWalletPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/rides/${SOS_RIDE_ID}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("links to the rider's wallet with the ride for wallets:manage", async () => {
    stubRide();
    renderShell();

    const refund = await screen.findByRole('link', { name: 'Refund rider' });
    expect(refund).toHaveAttribute(
      'href',
      `/users/user-lina/wallet?refundRide=${encodeURIComponent(SOS_RIDE_ID)}`,
    );
    // Rider and driver names now open their profiles (users:view).
    const meta = document.querySelector('.ride-detail__meta')! as HTMLElement;
    expect(within(meta).getByRole('link', { name: 'Lina K.' })).toHaveAttribute(
      'href',
      '/users/user-lina/trust',
    );
    expect(within(meta).getByRole('link', { name: 'Samer A.' })).toHaveAttribute(
      'href',
      '/users/driver-samer/trust',
    );
  });

  it('hides the action without wallets:manage, or without wallets:view', async () => {
    stubRide(VIEW_ONLY);
    const { unmount } = renderShell();
    await screen.findByRole('heading', { level: 1, name: 'Ride R-AAAAAAAA' });
    expect(screen.queryByRole('link', { name: 'Refund rider' })).toBeNull();
    // No users:view: names stay plain text.
    expect(screen.queryByRole('link', { name: 'Lina K.' })).toBeNull();
    unmount();
    vi.unstubAllGlobals();

    stubRide(MANAGE_ONLY);
    renderShell();
    await screen.findByRole('heading', { level: 1, name: 'Ride R-AAAAAAAA' });
    expect(screen.queryByRole('link', { name: 'Refund rider' })).toBeNull();
  });

  it('asks which member to refund on a shared ride', async () => {
    stubRide(REFUNDER, SHARED);
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Refund rider' }));

    const picker = screen.getByRole('region', { name: 'Refund which member?' });
    // Pre-dispatch leavers never rode: not offered.
    expect(within(picker).queryByText(/Sami/)).toBeNull();
    expect(within(picker).getByRole('link', { name: /Rana · creator/ })).toHaveAttribute(
      'href',
      `/users/user-lina/wallet?refundRide=${encodeURIComponent(SOS_RIDE_ID)}`,
    );
    // MemberView.riderUserId: any member's wallet opens, not only the creator's.
    expect(within(picker).getByRole('link', { name: /Omar/ })).toHaveAttribute(
      'href',
      `/users/user-omar/wallet?refundRide=${encodeURIComponent(SOS_RIDE_ID)}`,
    );
    expect(
      within(picker).queryByText(
        "Only the creator's wallet opens from here for now. Find the other members under Users.",
      ),
    ).toBeNull();
  });

  it('keeps a member without a served account id unavailable', async () => {
    const members = SHARED.ride.shared!.members.map((member) => ({
      ...member,
      riderUserId: null,
    }));
    stubRide(REFUNDER, {
      ...SHARED,
      ride: { ...SHARED.ride, shared: { ...SHARED.ride.shared!, members } },
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Refund rider' }));

    const picker = screen.getByRole('region', { name: 'Refund which member?' });
    // The creator falls back to the ride's rider account.
    expect(within(picker).getByRole('link', { name: /Rana · creator/ })).toHaveAttribute(
      'href',
      `/users/user-lina/wallet?refundRide=${encodeURIComponent(SOS_RIDE_ID)}`,
    );
    expect(within(picker).getByText(/Omar/).closest('[aria-disabled]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      within(picker).getByText(
        "Only the creator's wallet opens from here for now. Find the other members under Users.",
      ),
    ).toBeInTheDocument();
  });

  it('opens the wallet on Refund with the ride linked, amount and reason empty', async () => {
    const manager = adminUser(['wallets:view', 'wallets:manage', 'rides:view']);
    seedStoredSession(sessionFor(manager));
    const fetchMock = stubMoneyRoutes(manager, (method, path) => {
      if (method === 'GET' && path === `/api/v1/admin/rides/${RIDE_1}`) {
        return jsonResponse(200, paidRide());
      }
      if (method === 'POST' && path === `/api/v1/admin/users/${USER_ID}/wallet/credits`) {
        return jsonResponse(201, transaction({ id: 'tx-refund', amount: 27250 }));
      }
      return null;
    });
    window.history.pushState({}, '', `/users/${USER_ID}/wallet?refundRide=${RIDE_1}`);
    const user = userEvent.setup();
    renderShell();

    expect(await screen.findByText('From ride')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Opened from ride R-00000000. Refund and the ride are already selected.',
    );
    expect(screen.getByRole('button', { name: 'Refund' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/Linked ride/)).toHaveValue(RIDE_1);
    expect(screen.getByLabelText('Amount · SYP')).toHaveValue('');
    expect(screen.getByLabelText(/Reason/)).toHaveValue('');
    expect(screen.getByText('Ride total SYP 27,250, paid from the wallet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ride R-00000000/ })).toHaveAttribute(
      'href',
      `/rides/${RIDE_1}`,
    );

    await user.type(screen.getByLabelText('Amount · SYP'), '27250');
    await user.type(screen.getByLabelText(/Reason/), 'Charged twice');
    await user.click(screen.getByRole('button', { name: 'Credit SYP 27,250' }));

    await waitFor(() => {
      const body = bodyOf(
        fetchMock,
        'POST',
        `/api/v1/admin/users/${USER_ID}/wallet/credits`,
      ) as WalletCreditRequest;
      expect(body).toEqual({
        type: 'refund',
        amount: 27250,
        currency: 'SYP',
        reason: 'Charged twice',
        rideId: RIDE_1,
      });
    });
  });

  it("offers a ride the user's newest list lacks (a shared-ride member's)", async () => {
    const manager = adminUser(['wallets:view', 'wallets:manage', 'rides:view']);
    const memberRide = '00000000-0000-4000-8000-00000000dd77';
    seedStoredSession(sessionFor(manager));
    stubMoneyRoutes(manager, (method, path) => {
      if (method === 'GET' && path === `/api/v1/admin/rides/${memberRide}`) {
        return jsonResponse(200, paidRide({ id: memberRide, paymentStatus: 'split' }));
      }
      if (method === 'GET' && path === '/api/v1/admin/rides') {
        return jsonResponse(200, ridePage([adminRide()]));
      }
      return null;
    });
    window.history.pushState({}, '', `/users/${USER_ID}/wallet?refundRide=${memberRide}`);
    renderShell();

    await screen.findByText('From ride');
    const select = screen.getByLabelText(/Linked ride/);
    expect(select).toHaveValue(memberRide);
    expect(within(select).getAllByRole('option')).toHaveLength(4);
    expect(screen.getByText('Ride total SYP 27,250.')).toBeInTheDocument();
  });
});

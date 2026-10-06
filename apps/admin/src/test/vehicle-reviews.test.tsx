import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import { bodyOf, REVIEWER, stubOnboardingRoutes, vehicleReview } from './onboarding-fixtures';
import { jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

const SWITCH_PATH = '/api/v1/admin/vehicle-reviews/veh-new';

/**
 * UC-A-11 end-to-end against the mocked contract: the vehicle-switch queue
 * → the new vehicle + its registration/insurance beside the current active
 * vehicle → approve (service types) or reject (reason), with 409s explained.
 */
describe('vehicle switch review (UC-A-11)', () => {
  beforeAll(async () => {
    await import('../pages/VehicleReviewsPage');
    await import('../pages/VehicleReviewDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    seedStoredSession(sessionFor(REVIEWER));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists pending switches and opens one', async () => {
    window.history.pushState({}, '', '/vehicle-reviews');
    stubOnboardingRoutes(REVIEWER);
    const user = userEvent.setup();
    renderShell();

    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(2);
    const row = within(rows[1]);
    expect(row.getByText('Rami Haddad')).toBeInTheDocument();
    expect(row.getByText('Hyundai Accent')).toBeInTheDocument();
    expect(row.getByText('DAM-55555')).toBeInTheDocument();
    expect(screen.getByText('Waiting for review: 1')).toBeInTheDocument();

    await user.click(row.getByRole('link', { name: 'Review the vehicle switch of Rami Haddad' }));
    expect(
      await screen.findByRole('heading', { name: 'Vehicle switch — Rami Haddad' }),
    ).toBeInTheDocument();
  });

  it('shows an empty queue plainly', async () => {
    window.history.pushState({}, '', '/vehicle-reviews');
    stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/vehicle-reviews' ? jsonResponse(200, []) : null,
    );
    renderShell();

    expect(
      await screen.findByText('No vehicle switches are waiting for review.'),
    ).toBeInTheDocument();
  });

  it('shows the new vehicle with its documents beside the current one', async () => {
    window.history.pushState({}, '', '/vehicle-reviews/veh-new');
    stubOnboardingRoutes(REVIEWER);
    renderShell();

    const fresh = await screen.findByRole('article', { name: 'New vehicle' });
    expect(within(fresh).getByText('Hyundai Accent')).toBeInTheDocument();
    expect(within(fresh).getByAltText('Vehicle photo 1')).toHaveAttribute(
      'src',
      'http://api.test.local/api/v1/files/tok-new-car',
    );
    expect(screen.getByAltText('Vehicle registration')).toHaveAttribute(
      'src',
      'http://api.test.local/api/v1/files/tok-new-reg',
    );
    expect(screen.getByRole('link', { name: 'Open PDF: Insurance' })).toHaveAttribute(
      'href',
      'http://api.test.local/api/v1/files/tok-new-ins',
    );
    const current = screen.getByRole('article', { name: 'Current active vehicle' });
    expect(within(current).getByText('Kia Rio')).toBeInTheDocument();
    expect(within(current).getByText('Active vehicle')).toBeInTheDocument();
    expect(within(current).getByText('Economy')).toBeInTheDocument();
  });

  it('approves the switch with service types after a confirmation', async () => {
    window.history.pushState({}, '', '/vehicle-reviews/veh-new');
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'POST' && path === `${SWITCH_PATH}/approve`
        ? jsonResponse(
            200,
            vehicleReview({
              vehicle: { ...vehicleReview().vehicle, reviewStatus: 'approved', active: true },
              currentVehicle: null,
            }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Approve switch' }));
    await user.click(await screen.findByLabelText(/Comfort/));
    await user.click(screen.getByRole('button', { name: 'Approve…' }));
    expect(
      screen.getByText(
        'Approve the vehicle switch of Rami Haddad? The new vehicle replaces the current one immediately. This cannot be undone.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));

    expect(
      await screen.findByText('Switch approved. The new vehicle is now active.'),
    ).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${SWITCH_PATH}/approve`)).toEqual({
      serviceTypeIds: ['st-comfort'],
    });
    // Decided: no further decision controls.
    expect(screen.queryByRole('button', { name: 'Approve switch' })).not.toBeInTheDocument();
  });

  it('rejects the switch with a reason after a confirmation', async () => {
    window.history.pushState({}, '', '/vehicle-reviews/veh-new');
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'POST' && path === `${SWITCH_PATH}/reject`
        ? jsonResponse(
            200,
            vehicleReview({
              vehicle: {
                ...vehicleReview().vehicle,
                reviewStatus: 'rejected',
                reviewNote: 'Insurance does not cover this car',
              },
            }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Reject switch' }));
    await user.type(
      screen.getByLabelText('Reason (shown to the driver)'),
      'Insurance does not cover this car',
    );
    await user.click(screen.getByRole('button', { name: 'Reject…' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));

    expect(
      await screen.findByText('Switch rejected. The driver keeps the current vehicle.'),
    ).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${SWITCH_PATH}/reject`)).toEqual({
      reason: 'Insurance does not cover this car',
    });
  });

  it('blocks approval of a duplicate plate', async () => {
    window.history.pushState({}, '', '/vehicle-reviews/veh-new');
    stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'GET' && path === SWITCH_PATH
        ? jsonResponse(200, vehicleReview({ duplicatePlate: true }))
        : null,
    );
    renderShell();

    expect(await screen.findByText('Duplicate plate.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve switch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject switch' })).toBeEnabled();
  });

  it('explains a 409 when another reviewer already decided the switch', async () => {
    window.history.pushState({}, '', '/vehicle-reviews/veh-new');
    let reads = 0;
    stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === SWITCH_PATH) {
        reads += 1;
        // Once decided, the switch is no longer a candidate → 404.
        return reads === 1 ? jsonResponse(200, vehicleReview()) : jsonResponse(404, {});
      }
      if (method === 'POST' && path === `${SWITCH_PATH}/reject`) {
        return jsonResponse(409, {});
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Reject switch' }));
    await user.type(screen.getByLabelText('Reason (shown to the driver)'), 'Blurry');
    await user.click(screen.getByRole('button', { name: 'Reject…' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));

    expect(
      await screen.findByText('Another reviewer already decided this vehicle switch.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject switch' })).not.toBeInTheDocument();
  });
});

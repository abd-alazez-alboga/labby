import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminUserTrust } from '../api/trust';
import i18n from '../i18n/i18n';
import { bodyOf } from './onboarding-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  type FetchRouteHandler,
} from './test-utils';
import {
  REPORT_1,
  REPORT_2,
  reportPage,
  reportSummary,
  roleTrust,
  SAMER_ID,
  stubTrustRoutes,
  TRUST_ADMIN,
  USERS_VIEWER,
  userTrust,
} from './trust-fixtures';

const TRUST = `/api/v1/admin/users/${SAMER_ID}/trust`;
const BASE = `/api/v1/admin/users/${SAMER_ID}`;
const REASON_LABEL = 'Reason · required, shown to the user';

function conflict(code: string): Response {
  return jsonResponse(409, { status: 409, message: code, code });
}

function stubTrust(
  user = TRUST_ADMIN,
  trust: AdminUserTrust = userTrust(),
  extra?: FetchRouteHandler,
) {
  seedStoredSession(sessionFor(user));
  return stubTrustRoutes(user, (method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === TRUST) {
      return jsonResponse(200, trust);
    }
    if (
      method === 'GET' &&
      path === '/api/v1/admin/reports' &&
      url?.searchParams.get('reportedUserId') === SAMER_ID
    ) {
      const status = url.searchParams.get('status');
      if (status === 'substantiated') {
        return jsonResponse(
          200,
          reportPage([
            reportSummary({ status: 'substantiated', createdAt: '2026-10-13T10:00:00Z' }),
          ]),
        );
      }
      if (status === 'unsubstantiated') {
        return jsonResponse(
          200,
          reportPage([
            reportSummary({
              id: REPORT_2,
              category: 'vehicle_condition',
              status: 'unsubstantiated',
              createdAt: '2026-09-28T10:00:00Z',
            }),
          ]),
        );
      }
      return jsonResponse(200, reportPage([]));
    }
    return null;
  });
}

/**
 * UC-A-13 trust sections + UC-A-14 against contract mocks (trust-v1.yaml):
 * per-role cards with live averages and the auto-suspension rule, open
 * flags, metric warnings, reports against; reactivate / suspend role /
 * whole-account suspension (confirmed) with the mandatory user-facing
 * reason, and every 409 code surfaced with clear copy.
 */
describe('user trust profile', () => {
  beforeAll(async () => {
    await import('../pages/UserTrustPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/users/${SAMER_ID}/trust`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders role cards, open flags, metric warnings and reports against', async () => {
    stubTrust(adminUser([...TRUST_ADMIN.roles[0].permissions!, 'wallets:view']));
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Samer Haddad' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Account active')).toBeInTheDocument();

    // Tabs: trust (current) + wallet.
    const tabs = screen.getByRole('navigation', { name: 'Profile sections' });
    expect(within(tabs).getByRole('link', { name: 'Ratings, reports & flags' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(tabs).getByRole('link', { name: 'Wallet' })).toHaveAttribute(
      'href',
      `/users/${SAMER_ID}/wallet`,
    );

    const driver = screen.getByRole('region', { name: 'Driver role' });
    expect(driver).toHaveClass('role-card--suspended');
    expect(driver).toHaveTextContent('Suspended · low rating');
    expect(driver).toHaveTextContent('2.94');
    expect(driver).toHaveTextContent('live · 23 ratings');
    expect(driver).toHaveTextContent(/Auto-suspended .*: the live average fell below/);
    const rider = screen.getByRole('region', { name: 'Rider role' });
    expect(rider).toHaveTextContent('Active');
    expect(rider).toHaveTextContent('4.81');
    expect(rider).toHaveTextContent('No flags · 0 reports against');

    expect(screen.getByRole('heading', { name: 'Open flags · driver' })).toBeInTheDocument();
    expect(screen.getByText('3 substantiated in 90 days (limit 3)')).toBeInTheDocument();
    expect(screen.getByText('3.38 avg < 3.5 after 34 ratings')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Metric warnings · driver' })).toBeInTheDocument();
    expect(screen.getByText('Cancellation 18.5% > 15% · 27 rides / 30 d')).toBeInTheDocument();

    // Reports against (reports:view), newest first, linking to each report.
    expect(
      await screen.findByRole('heading', { name: 'Reports against · driver' }),
    ).toBeInTheDocument();
    expect(screen.getByText('5 total · 3 substantiated')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Unsafe driving|Vehicle condition/ });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/reports/${REPORT_1}`,
      `/reports/${REPORT_2}`,
    ]);
  });

  it('reactivates the suspended driver role with the user-facing reason', async () => {
    const reactivated = userTrust({
      roles: [roleTrust({ role: 'driver', liveAverage: 2.94, liveRatingCount: 23 }), roleTrust()],
    });
    const fetchMock = stubTrust(TRUST_ADMIN, userTrust(), (method, path) =>
      method === 'POST' && path === `${BASE}/roles/driver/reactivate`
        ? jsonResponse(200, reactivated)
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    // The reactivation leads; the rest is one click away.
    const panel = await screen.findByRole('region', { name: 'Reactivate driver role' });
    const others = screen.getByRole('region', { name: 'Other actions' });
    expect(
      within(others).getByRole('button', { name: 'Suspend driver role…' }),
    ).toBeInTheDocument();
    expect(within(others).getByRole('button', { name: 'Suspend rider role…' })).toBeInTheDocument();
    expect(within(others).getByRole('button', { name: 'Suspend whole account…' })).toHaveClass(
      'btn--danger-outline',
    );

    await user.click(within(panel).getByRole('button', { name: 'Reactivate driver role' }));
    expect(await screen.findByText('Write a reason — the user sees it.')).toBeInTheDocument();
    expect(callsTo(fetchMock, '/reactivate')).toHaveLength(0);

    await user.type(
      screen.getByLabelText(REASON_LABEL),
      'Reviewed with the driver; second chance after coaching call.',
    );
    await user.click(within(panel).getByRole('button', { name: 'Reactivate driver role' }));

    expect(
      await screen.findByText('Role reactivated. The user has been notified.'),
    ).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${BASE}/roles/driver/reactivate`)).toEqual({
      note: 'Reviewed with the driver; second chance after coaching call.',
    });
    expect(screen.getByRole('region', { name: 'Driver role' })).toHaveTextContent('Active');
  });

  it('says the driver role stays suspended when a document is still expired', async () => {
    const fetchMock = stubTrust(TRUST_ADMIN, userTrust(), (method, path) =>
      method === 'POST' && path === `${BASE}/roles/driver/reactivate`
        ? jsonResponse(
            200,
            userTrust({
              roles: [
                roleTrust({
                  role: 'driver',
                  state: 'suspended',
                  suspensionReason: 'document_expired',
                  suspendedAt: '2026-10-16T08:00:00Z',
                }),
                roleTrust(),
              ],
            }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText(REASON_LABEL), 'Second chance');
    await user.click(screen.getByRole('button', { name: 'Reactivate driver role' }));

    expect(
      await screen.findByText(
        'The driver role stays suspended: a required document has expired. It reactivates once a renewal is approved.',
      ),
    ).toHaveClass('banner--warning');
    expect(
      screen.queryByText('Role reactivated. The user has been notified.'),
    ).not.toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${BASE}/roles/driver/reactivate`)).toEqual({
      note: 'Second chance',
    });
    expect(screen.getByRole('region', { name: 'Driver role' })).toHaveTextContent(
      'Suspended · document expired',
    );
  });

  it('suspends one role from the other actions', async () => {
    const fetchMock = stubTrust(TRUST_ADMIN, userTrust(), (method, path) =>
      method === 'POST' && path === `${BASE}/roles/rider/suspend`
        ? jsonResponse(
            200,
            userTrust({
              roles: [
                userTrust().roles[0],
                roleTrust({
                  state: 'suspended',
                  suspensionReason: 'manual',
                  suspensionNote: 'Repeated no-shows',
                  suspendedAt: '2026-10-15T10:00:00Z',
                }),
              ],
            }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Suspend rider role…' }));
    const panel = screen.getByRole('region', { name: 'Suspend rider role' });
    await user.type(within(panel).getByLabelText(REASON_LABEL), 'Repeated no-shows');
    await user.click(within(panel).getByRole('button', { name: 'Suspend rider role' }));

    expect(
      await screen.findByText('Role suspended. The user has been notified with your reason.'),
    ).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${BASE}/roles/rider/suspend`)).toEqual({
      note: 'Repeated no-shows',
    });
    const rider = screen.getByRole('region', { name: 'Rider role' });
    expect(rider).toHaveTextContent('Suspended · by an admin');
    expect(rider).toHaveTextContent('Repeated no-shows');
  });

  it('confirms before suspending the whole account', async () => {
    const fetchMock = stubTrust(TRUST_ADMIN, userTrust(), (method, path) =>
      method === 'POST' && path === `${BASE}/suspend`
        ? jsonResponse(
            200,
            userTrust({
              accountState: 'suspended',
              accountSuspensionNote: 'Fraudulent cash claims',
              accountSuspendedAt: '2026-10-15T10:00:00Z',
            }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Suspend whole account…' }));
    await user.type(screen.getByLabelText(REASON_LABEL), 'Fraudulent cash claims');
    await user.click(screen.getByRole('button', { name: 'Suspend whole account' }));

    // Nothing is sent until the confirmation.
    expect(
      screen.getByText(/Suspend Samer Haddad's whole account\? Every rider and driver feature/),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, `${BASE}/suspend`)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Yes, suspend the account' }));

    expect(
      await screen.findByText('Account suspended. The user has been notified with your reason.'),
    ).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${BASE}/suspend`)).toEqual({
      note: 'Fraudulent cash claims',
    });
    expect(screen.getByText('Account suspended')).toBeInTheDocument();
    expect(screen.getByText('Fraudulent cash claims')).toBeInTheDocument();
    // A suspended account leads with its reactivation.
    expect(screen.getByRole('region', { name: 'Reactivate account' })).toBeInTheDocument();
  });

  it.each([
    ['document_expired', 'Only an approved document renewal lifts it.'],
    ['not_suspended', 'Not suspended any more — nothing to reactivate.'],
    ['already_suspended', 'Already suspended by an admin — nothing changed.'],
    ['admin_account', 'This is an admin account. Deactivate admins from the Admins page instead.'],
    ['account_deleted', "This account was deleted and can't be suspended."],
  ])('surfaces the 409 %s with clear copy and reloads', async (code, copy) => {
    const fetchMock = stubTrust(TRUST_ADMIN, userTrust(), (method, path) =>
      method === 'POST' && path === `${BASE}/roles/driver/reactivate` ? conflict(code) : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText(REASON_LABEL), 'Second chance');
    await user.click(screen.getByRole('button', { name: 'Reactivate driver role' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(copy);
    expect(callsTo(fetchMock, TRUST).length).toBeGreaterThanOrEqual(2);
    // The refused reason is cleared, never reused for another action.
    expect(screen.getByLabelText(REASON_LABEL)).toHaveValue('');
  });

  it('never carries a refused reason over to the action the reload offers', async () => {
    let refused = false;
    stubTrust(TRUST_ADMIN, userTrust(), (method, path) => {
      if (method === 'POST' && path === `${BASE}/roles/driver/reactivate`) {
        refused = true;
        return conflict('not_suspended');
      }
      if (method === 'GET' && path === TRUST && refused) {
        // Another admin reactivated meanwhile: no reactivation leads any more.
        return jsonResponse(
          200,
          userTrust({ roles: [roleTrust({ role: 'driver' }), roleTrust()] }),
        );
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText(REASON_LABEL), 'Second chance after coaching');
    await user.click(screen.getByRole('button', { name: 'Reactivate driver role' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not suspended any more');

    await user.click(await screen.findByRole('button', { name: 'Suspend driver role…' }));
    const panel = screen.getByRole('region', { name: 'Suspend driver role' });
    expect(within(panel).getByLabelText(REASON_LABEL)).toHaveValue('');
  });

  it('offers a manual suspension but no reactivation for a document-expiry suspension', async () => {
    stubTrust(
      TRUST_ADMIN,
      userTrust({
        roles: [
          roleTrust({
            role: 'driver',
            state: 'suspended',
            suspensionReason: 'document_expired',
            suspendedAt: '2026-10-01T00:00:00Z',
          }),
        ],
      }),
    );
    renderShell();

    expect(await screen.findByRole('region', { name: 'Driver role' })).toHaveTextContent(
      'Only an approved renewal reactivates it; suspending it yourself replaces the reason with yours.',
    );
    expect(screen.queryByRole('button', { name: /Reactivate/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend driver role…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend whole account…' })).toBeInTheDocument();
  });

  it('opens the trust profile from the Users lookup with users:view', async () => {
    stubTrust(USERS_VIEWER);
    window.history.pushState({}, '', '/users');
    const user = userEvent.setup();
    renderShell();

    expect(
      await screen.findByText(
        'Every account, newest first. Open a user for trust, wallet and roles.',
      ),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Phone or user ID'), SAMER_ID);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('region', { name: 'Driver role' })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/users/${SAMER_ID}/trust`);
  });

  it('is read-only without users:suspend and without the wallet tab', async () => {
    const fetchMock = stubTrust(USERS_VIEWER);
    renderShell();

    expect(await screen.findByRole('region', { name: 'Driver role' })).toBeInTheDocument();
    expect(screen.queryByLabelText(REASON_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Other actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Profile sections' })).not.toBeInTheDocument();
    // No reports:view → no per-report list is fetched.
    expect(callsTo(fetchMock, 'reportedUserId')).toHaveLength(0);
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import { bodyOf, renewal, REVIEWER, stubOnboardingRoutes } from './onboarding-fixtures';
import { jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

const RENEWAL_PATH = '/api/v1/admin/document-renewals/doc-renew';

/**
 * UC-A-12 end-to-end against the mocked contract: the expiry dashboard
 * (30/7-day horizon + expired list) with the pending-renewal queue → a
 * renewal beside the current document → approve (lifts the expiry
 * suspension) or reject with a reason.
 */
describe('document expiry dashboard (UC-A-12)', () => {
  beforeAll(async () => {
    await import('../pages/DocumentExpiriesPage');
    await import('../pages/DocumentRenewalDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    seedStoredSession(sessionFor(REVIEWER));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function expiryRequests(fetchMock: ReturnType<typeof stubOnboardingRoutes>): string[] {
    return fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === '/api/v1/admin/document-expiries')
      .map((url) => url.searchParams.get('horizonDays') ?? '');
  }

  it('shows renewals, upcoming (30 days) and expired documents, then switches to 7 days', async () => {
    window.history.pushState({}, '', '/document-expiries');
    const fetchMock = stubOnboardingRoutes(REVIEWER);
    const user = userEvent.setup();
    renderShell();

    expect(
      await screen.findByRole('heading', { name: 'Expiring within 30 days' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Omar Khalil')).toBeInTheDocument();
    expect(screen.getByText('Hala Nasser')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(expiryRequests(fetchMock)).toEqual(['30']);

    // Upcoming row: days left, reminders, renewal pending.
    const omar = screen.getByText('Omar Khalil').closest('tr')!;
    expect(within(omar).getByText('26')).toBeInTheDocument();
    expect(within(omar).getByText("Driver's license")).toBeInTheDocument();
    expect(within(omar).getByText('7-day reminder: not sent')).toBeInTheDocument();
    const hala = screen.getByText('Hala Nasser').closest('tr')!;
    expect(within(hala).getByText('Renewal pending')).toBeInTheDocument();

    // Expired list: overdue days + automatic suspension.
    const expiredTable = screen.getByRole('heading', { name: /^Expired/ }).nextElementSibling!;
    const expiredRow = within(expiredTable as HTMLElement)
      .getByText('Rami Haddad')
      .closest('tr')!;
    expect(within(expiredRow).getByText('5')).toBeInTheDocument();
    expect(within(expiredRow).getByText('Driver suspended')).toBeInTheDocument();

    // Pending renewals queue.
    expect(screen.getByRole('link', { name: 'Review the renewal of Rami Haddad' })).toHaveAttribute(
      'href',
      '/document-renewals/doc-renew',
    );

    await user.click(screen.getByRole('button', { name: '7 days' }));
    expect(
      await screen.findByRole('heading', { name: 'Expiring within 7 days' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Omar Khalil')).not.toBeInTheDocument());
    expect(screen.getByText('Hala Nasser')).toBeInTheDocument();
    expect(expiryRequests(fetchMock)).toEqual(['30', '7']);
  });

  it('shows empty lists plainly', async () => {
    window.history.pushState({}, '', '/document-expiries');
    stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === '/api/v1/admin/document-expiries') {
        return jsonResponse(200, { horizonDays: 30, upcoming: [], expired: [] });
      }
      if (method === 'GET' && path === '/api/v1/admin/document-renewals') {
        return jsonResponse(200, []);
      }
      return null;
    });
    renderShell();

    expect(await screen.findByText('No documents expire within 30 days.')).toBeInTheDocument();
    expect(screen.getByText('No expired documents.')).toBeInTheDocument();
    expect(await screen.findByText('No renewals are waiting for review.')).toBeInTheDocument();
  });

  it('shows the renewal beside the current document', async () => {
    window.history.pushState({}, '', '/document-renewals/doc-renew');
    stubOnboardingRoutes(REVIEWER);
    renderShell();

    const renewed = await screen.findByRole('article', { name: 'Renewed document' });
    expect(within(renewed).getByText('INS-2027')).toBeInTheDocument();
    expect(within(renewed).getByAltText('Insurance')).toHaveAttribute(
      'src',
      'http://api.test.local/api/v1/files/tok-renew',
    );
    const current = screen.getByRole('article', { name: 'Current document' });
    expect(within(current).getByText('INS-2026')).toBeInTheDocument();
    expect(within(current).getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Driver suspended')).toBeInTheDocument();
  });

  it('approves a renewal after a confirmation and reports the lifted suspension', async () => {
    window.history.pushState({}, '', '/document-renewals/doc-renew');
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'POST' && path === `${RENEWAL_PATH}/approve`
        ? jsonResponse(
            200,
            renewal({
              renewal: { ...renewal().renewal, reviewStatus: 'approved' },
              current: { ...renewal().current, reviewStatus: 'superseded' },
              driverSuspended: false,
            }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Approve renewal' }));
    expect(
      screen.getByText(
        'Approve the renewed Insurance of Rami Haddad? It replaces the current document. This cannot be undone.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));

    expect(
      await screen.findByText('Renewal approved. It is now the current document.'),
    ).toBeInTheDocument();
    expect(screen.getByText("The driver's expiry suspension has been lifted.")).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${RENEWAL_PATH}/approve`)).toBeUndefined();
    expect(screen.getByText('Superseded')).toBeInTheDocument();
    expect(screen.queryByText('Driver suspended')).not.toBeInTheDocument();
  });

  it('rejects a renewal with a reason after a confirmation', async () => {
    window.history.pushState({}, '', '/document-renewals/doc-renew');
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'POST' && path === `${RENEWAL_PATH}/reject`
        ? jsonResponse(
            200,
            renewal({ renewal: { ...renewal().renewal, reviewStatus: 'rejected' } }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Reject renewal' }));
    await user.type(screen.getByLabelText('Reason (shown to the driver)'), 'Wrong policy holder');
    await user.click(screen.getByRole('button', { name: 'Reject…' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));

    expect(
      await screen.findByText('Renewal rejected. The current document stays.'),
    ).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${RENEWAL_PATH}/reject`)).toEqual({
      reason: 'Wrong policy holder',
    });
  });

  it('explains a 409 when the renewal itself has expired meanwhile', async () => {
    window.history.pushState({}, '', '/document-renewals/doc-renew');
    let reads = 0;
    stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === RENEWAL_PATH) {
        reads += 1;
        return jsonResponse(
          200,
          reads === 1
            ? renewal()
            : renewal({ renewal: { ...renewal().renewal, expiresOn: '2001-01-01' } }),
        );
      }
      if (method === 'POST' && path === `${RENEWAL_PATH}/approve`) {
        return jsonResponse(409, {});
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Approve renewal' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));

    expect(
      await screen.findByText(
        'Approval refused: the renewed document has itself expired. Reject it so the driver can submit a new one.',
      ),
    ).toBeInTheDocument();
    // Rejection stays possible.
    expect(screen.getByRole('button', { name: 'Reject renewal' })).toBeEnabled();
  });
});

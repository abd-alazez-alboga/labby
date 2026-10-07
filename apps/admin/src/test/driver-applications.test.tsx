import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  bodyOf,
  fileRef,
  getCount,
  LONG_EXPIRED,
  REVIEWER,
  stubOnboardingRoutes,
  summaryPage,
  underReview,
  applicationDocuments,
} from './onboarding-fixtures';
import { jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

const APP_PATH = '/api/v1/admin/driver-applications/app-1';

/**
 * UC-A-10 end-to-end against the mocked contract (onboarding-v1.yaml):
 * queue → detail with secure file URLs → start review → request changes /
 * approve (service types) / reject, plus duplicate-plate blocking and the
 * plain-words 409 explanations.
 */
describe('driver application queue', () => {
  beforeAll(async () => {
    await import('../pages/DriverApplicationsPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/driver-applications');
    seedStoredSession(sessionFor(REVIEWER));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the default submitted + under-review queue and shows each row', async () => {
    const fetchMock = stubOnboardingRoutes(REVIEWER);
    renderShell();

    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2
    const first = within(rows[1]);
    expect(first.getByText('Rami Haddad')).toBeInTheDocument();
    expect(first.getByText('+963933000111')).toBeInTheDocument();
    expect(first.getByText('Submitted')).toBeInTheDocument();
    expect(first.getByText('DAM-12345')).toBeInTheDocument();
    expect(first.queryByText('Duplicate plate')).not.toBeInTheDocument();
    const second = within(rows[2]);
    expect(second.getByText('Under review')).toBeInTheDocument();
    expect(second.getByText('Duplicate plate')).toBeInTheDocument();
    expect(screen.getByText('Matching applications: 2')).toBeInTheDocument();

    const url = new URL(
      String(fetchMock.mock.calls.find(([u]) => String(u).includes('driver-applications'))?.[0]),
    );
    expect(url.searchParams.getAll('status')).toEqual(['submitted', 'under_review']);
    expect(url.searchParams.get('page')).toBe('0');
    expect(url.searchParams.get('size')).toBe('25');
  });

  it('adds a status to the filter and never lets the filter go empty', async () => {
    const fetchMock = stubOnboardingRoutes(REVIEWER);
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Approved' }));
    await waitFor(() => {
      const last = fetchMock.mock.calls
        .filter(([u]) => String(u).includes('driver-applications'))
        .at(-1);
      expect(new URL(String(last?.[0])).searchParams.getAll('status')).toEqual([
        'submitted',
        'under_review',
        'approved',
      ]);
    });

    await user.click(screen.getByRole('button', { name: 'Submitted' }));
    await user.click(screen.getByRole('button', { name: 'Under review' }));
    expect(screen.getByRole('button', { name: 'Approved' })).toBeDisabled();
  });

  it('pages through a long queue', async () => {
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/driver-applications'
        ? jsonResponse(200, summaryPage({ totalItems: 30 }))
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      const last = fetchMock.mock.calls
        .filter(([u]) => String(u).includes('driver-applications'))
        .at(-1);
      expect(new URL(String(last?.[0])).searchParams.get('page')).toBe('1');
    });
  });

  it('shows an empty queue plainly', async () => {
    stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/driver-applications'
        ? jsonResponse(200, summaryPage({ items: [], totalItems: 0 }))
        : null,
    );
    renderShell();

    expect(
      await screen.findByText('No applications match the selected statuses.'),
    ).toBeInTheDocument();
  });

  it('tells a network failure apart from a server failure, with retry', async () => {
    let calls = 0;
    stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === '/api/v1/admin/driver-applications') {
        calls += 1;
        if (calls === 1) {
          throw new TypeError('Failed to fetch');
        }
        if (calls === 2) {
          return jsonResponse(500, {});
        }
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('The server ran into a problem. Try again in a moment.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Rami Haddad')).toBeInTheDocument();
  });
});

describe('driver application detail (UC-A-10)', () => {
  beforeAll(async () => {
    await import('../pages/DriverApplicationDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/driver-applications/app-1');
    seedStoredSession(sessionFor(REVIEWER));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders every item with secure file URLs resolved against the API base', async () => {
    stubOnboardingRoutes(REVIEWER);
    renderShell();

    expect(
      await screen.findByRole('heading', { name: 'Rami Haddad', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByAltText('Profile photo')).toHaveAttribute(
      'src',
      'http://api.test.local/api/v1/files/tok-photo',
    );
    expect(screen.getByAltText('Government ID')).toHaveAttribute(
      'src',
      'http://api.test.local/api/v1/files/tok-id',
    );
    expect(screen.getByAltText("Driver's license")).toHaveAttribute(
      'src',
      'http://api.test.local/api/v1/files/tok-lic',
    );
    // PDFs open in a new tab, never inline-cached.
    const pdf = screen.getByRole('link', { name: 'Open PDF: Vehicle registration' });
    expect(pdf).toHaveAttribute('href', 'http://api.test.local/api/v1/files/tok-reg');
    expect(pdf).toHaveAttribute('target', '_blank');
    expect(pdf).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByAltText('Vehicle photo 1')).toHaveAttribute(
      'src',
      'http://api.test.local/api/v1/files/tok-car-1',
    );
    expect(screen.getByAltText('Vehicle photo 2')).toBeInTheDocument();
    // Document facts + history.
    expect(screen.getByText('INSURANCE-001')).toBeInTheDocument();
    expect(screen.getByText('DAM-12345')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stage history' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('starts the review of a submitted application', async () => {
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === APP_PATH) {
        return jsonResponse(200, underReview({ status: 'submitted' }));
      }
      if (method === 'POST' && path === `${APP_PATH}/start-review`) {
        return jsonResponse(200, underReview());
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Start review' }));

    expect(await screen.findByText('Review started.')).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${APP_PATH}/start-review`)).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('requests per-item changes with the exact contract body', async () => {
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'POST' && path === `${APP_PATH}/request-changes`
        ? jsonResponse(200, underReview({ status: 'needs_changes' }))
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Request changes' }));
    const send = screen.getByRole('button', { name: 'Send change request' });
    expect(send).toBeDisabled();

    await user.click(screen.getByLabelText('Flag: Personal details'));
    await user.click(screen.getByLabelText('Flag: Insurance'));
    await user.click(screen.getByLabelText('Flag: Vehicle'));
    expect(send).toBeDisabled(); // notes are mandatory per flagged item
    await user.type(
      screen.getByLabelText('What must change — Personal details'),
      'Photo is blurry',
    );
    await user.type(
      screen.getByLabelText('What must change — Insurance'),
      'Policy number unreadable',
    );
    await user.type(screen.getByLabelText('What must change — Vehicle'), 'Add a rear photo');
    await user.type(
      screen.getByLabelText('Overall note (optional, kept in the history)'),
      'Almost there',
    );
    await user.click(send);

    expect(
      await screen.findByText(
        'Change request sent. The application is now waiting for the applicant.',
      ),
    ).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${APP_PATH}/request-changes`)).toEqual({
      items: [
        { item: 'personal', note: 'Photo is blurry' },
        { item: 'document', documentType: 'insurance', note: 'Policy number unreadable' },
        { item: 'vehicle', note: 'Add a rear photo' },
      ],
      note: 'Almost there',
    });
    expect(
      screen.getByText('Waiting for the applicant to resubmit the flagged items.'),
    ).toBeInTheDocument();
  });

  it('approves with the chosen service types after a confirmation', async () => {
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'POST' && path === `${APP_PATH}/approve`
        ? jsonResponse(200, underReview({ status: 'approved' }))
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const proceed = screen.getByRole('button', { name: 'Approve…' });
    expect(await screen.findByLabelText(/Comfort/)).toBeInTheDocument();
    expect(proceed).toBeDisabled(); // at least one service type
    await user.click(screen.getByLabelText(/Comfort/));
    await user.click(screen.getByLabelText(/Economy/));
    await user.click(proceed);

    expect(
      screen.getByText(
        'Approve Rami Haddad as a driver? The driver role activates immediately. This cannot be undone.',
      ),
    ).toBeInTheDocument();
    expect(getCount(fetchMock, `${APP_PATH}/approve`)).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));

    expect(
      await screen.findByText('Application approved. The driver role is active.'),
    ).toBeInTheDocument();
    // List order (region-then-name from the server), not click order.
    expect(bodyOf(fetchMock, 'POST', `${APP_PATH}/approve`)).toEqual({
      serviceTypeIds: ['st-eco', 'st-comfort'],
    });
  });

  it('rejects with a mandatory reason after a confirmation', async () => {
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'POST' && path === `${APP_PATH}/reject`
        ? jsonResponse(
            200,
            underReview({ status: 'rejected', rejectionReason: 'Licence is not valid' }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('button', { name: 'Reject…' })).toBeDisabled();
    expect(screen.getByText('A reason is required.')).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Reason (shown to the driver)'),
      '  Licence is not valid  ',
    );
    await user.click(screen.getByRole('button', { name: 'Reject…' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));

    expect(await screen.findByText('Application rejected.')).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `${APP_PATH}/reject`)).toEqual({
      reason: 'Licence is not valid',
    });
    expect(screen.getByText('Rejection reason: Licence is not valid')).toBeInTheDocument();
  });

  it('blocks approval while the plate is a duplicate, but still allows the other decisions', async () => {
    stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'GET' && path === APP_PATH
        ? jsonResponse(200, underReview({ duplicatePlate: true }))
        : null,
    );
    renderShell();

    expect(await screen.findByText('Duplicate plate.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(
      screen.getByText(
        'Approval is blocked while the plate is a duplicate. Request changes to the vehicle or reject the application.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  async function approveAndConfirm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByLabelText(/Economy/));
    await user.click(screen.getByRole('button', { name: 'Approve…' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
  }

  it('explains a 409 when another reviewer already decided', async () => {
    let reads = 0;
    stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === APP_PATH) {
        reads += 1;
        return jsonResponse(200, reads === 1 ? underReview() : underReview({ status: 'rejected' }));
      }
      if (method === 'POST' && path === `${APP_PATH}/approve`) {
        return jsonResponse(409, { status: 409, message: 'conflict' });
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await approveAndConfirm(user);

    expect(
      await screen.findByText(
        'Another reviewer already acted on this application — it is now "Rejected". The page shows its current state.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('This application is rejected — no further decisions.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('shows a withdrawn application (deleted account) as closed, with no decisions', async () => {
    stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'GET' && path === APP_PATH
        ? jsonResponse(200, underReview({ status: 'withdrawn' }))
        : null,
    );
    renderShell();

    expect(
      await screen.findByText(
        'The account was deleted and the application withdrawn — no further decisions. If the account is reactivated, the applicant applies again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Withdrawn').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('explains a 409 caused by a duplicate plate flagged meanwhile', async () => {
    let reads = 0;
    stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === APP_PATH) {
        reads += 1;
        return jsonResponse(200, underReview({ duplicatePlate: reads > 1 }));
      }
      if (method === 'POST' && path === `${APP_PATH}/approve`) {
        return jsonResponse(409, {});
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await approveAndConfirm(user);

    expect(
      await screen.findByText('Approval refused: the duplicate plate must be resolved first.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('explains a 409 caused by a document that expired during review', async () => {
    let reads = 0;
    const expiredDocs = applicationDocuments().map((document) =>
      document.type === 'drivers_license' ? { ...document, expiresOn: LONG_EXPIRED } : document,
    );
    stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === APP_PATH) {
        reads += 1;
        return jsonResponse(
          200,
          reads === 1 ? underReview() : underReview({ documents: expiredDocs }),
        );
      }
      if (method === 'POST' && path === `${APP_PATH}/approve`) {
        return jsonResponse(409, {});
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await approveAndConfirm(user);

    expect(
      await screen.findByText(
        'Approval refused: a document has expired since it was submitted. Request a renewed document instead.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('reports a decision lost to the network without claiming success', async () => {
    stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'POST' && path === `${APP_PATH}/reject`) {
        throw new TypeError('Failed to fetch');
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Reason (shown to the driver)'), 'No');
    await user.click(screen.getByRole('button', { name: 'Reject…' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));

    expect(
      await screen.findByText(
        "Can't reach the server, so the decision may not have been saved. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Application rejected.')).not.toBeInTheDocument();
  });

  it('refetches fresh URLs when a file fails to load, then gives up honestly', async () => {
    let reads = 0;
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === APP_PATH) {
        reads += 1;
        return jsonResponse(
          200,
          underReview({
            personal: {
              name: 'Rami Haddad',
              // Same file, freshly minted token on every read.
              photo: { ...fileRef(`tok-photo-v${reads}`), fileId: 'file-photo' },
              reviewStatus: 'pending',
            },
          }),
        );
      }
      return null;
    });
    renderShell();

    const photo = await screen.findByAltText('Profile photo');
    expect(photo).toHaveAttribute('src', 'http://api.test.local/api/v1/files/tok-photo-v1');

    // An expired token is a plain 404 → the <img> errors → fresh URLs.
    fireEvent.error(photo);
    await waitFor(() =>
      expect(screen.getByAltText('Profile photo')).toHaveAttribute(
        'src',
        'http://api.test.local/api/v1/files/tok-photo-v2',
      ),
    );
    expect(getCount(fetchMock, APP_PATH)).toBe(2);

    // The fresh URL failing too means the file is really gone — no loop.
    fireEvent.error(screen.getByAltText('Profile photo'));
    expect(await screen.findByText('File unavailable')).toBeInTheDocument();
    expect(getCount(fetchMock, APP_PATH)).toBe(2);
  });

  it('re-mints the file URLs shortly before they expire', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    const fetchMock = stubOnboardingRoutes(REVIEWER, (method, path) => {
      if (method === 'GET' && path === APP_PATH) {
        reads += 1;
        // First response: URLs valid ~60 s; refreshes get the usual 5 min.
        const expiresAt = new Date(Date.now() + (reads === 1 ? 60_000 : 300_000)).toISOString();
        return jsonResponse(
          200,
          underReview({
            personal: {
              name: 'Rami Haddad',
              photo: fileRef(`tok-photo-v${reads}`, 'image/jpeg', expiresAt),
              reviewStatus: 'pending',
            },
            documents: [],
            vehicle: { ...underReview().vehicle, photos: [] },
          }),
        );
      }
      return null;
    });
    renderShell();

    expect(await screen.findByAltText('Profile photo')).toHaveAttribute(
      'src',
      'http://api.test.local/api/v1/files/tok-photo-v1',
    );
    expect(getCount(fetchMock, APP_PATH)).toBe(1);

    // 30 s before expiry the page refetches for fresh URLs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await waitFor(() =>
      expect(screen.getByAltText('Profile photo')).toHaveAttribute(
        'src',
        'http://api.test.local/api/v1/files/tok-photo-v2',
      ),
    );
    expect(getCount(fetchMock, APP_PATH)).toBe(2);
  });

  it('shows not-found and server failures distinctly', async () => {
    stubOnboardingRoutes(REVIEWER, (method, path) =>
      method === 'GET' && path === APP_PATH ? jsonResponse(404, {}) : null,
    );
    renderShell();

    expect(await screen.findByText('This application does not exist.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

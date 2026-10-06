/**
 * M5-T3 — stage tracker (UC-D-03) and flagged-item resubmission (UC-D-02)
 * against onboarding-v1.yaml.
 */
import { renderRouter, screen } from 'expo-router/testing-library';
import { fireEvent, waitFor } from '@testing-library/react-native';

import type { UserProfile } from '../api/auth-types';
import type { DriverApplication } from '../api/onboarding-types';
import { clearSession, getSession } from '../auth/session';
import { initI18n, setAppLanguage } from '../i18n';
import {
  driverUser,
  installContractFetch,
  riderOnlyUser,
  seedSession,
} from '../test-utils/contract';
import type { MockResponse } from '../test-utils/contract';
import {
  applicationFixture,
  documentFixture,
  isoInDays,
  mockDocumentPick,
  pickDate,
  uploaded,
  vehicleFixture,
} from '../test-utils/onboarding';

const user = riderOnlyUser({ photoUrl: '/api/v1/files/profile-token' });

async function openGate(
  application: MockResponse | MockResponse[],
  extra: Record<string, MockResponse | MockResponse[]> = {},
  profile: UserProfile = user,
) {
  await seedSession(profile);
  const contract = installContractFetch({
    'GET /api/v1/users/me': { status: 200, body: profile },
    'GET /api/v1/driver/application': application,
    ...extra,
  });
  renderRouter('src/app');
  await screen.findByTestId('apply-to-drive-screen');
  return contract;
}

function needsChanges(overrides: Partial<DriverApplication> = {}): DriverApplication {
  return applicationFixture('needs_changes', {
    personal: {
      name: 'Rami Rider',
      photo: null,
      reviewStatus: 'changes_requested',
      reviewNote: 'Photo is blurry — upload a clear face photo.',
    },
    documents: [
      documentFixture('government_id'),
      documentFixture('drivers_license'),
      documentFixture('vehicle_registration'),
      documentFixture('insurance', {
        reviewStatus: 'changes_requested',
        reviewNote: 'Insurance number does not match the scan.',
        number: 'INS-OLD',
        expiresOn: isoInDays(90),
      }),
    ],
    history: [
      { fromStatus: null, toStatus: 'submitted', note: null, at: '2026-10-01T09:00:00Z' },
      { fromStatus: 'submitted', toStatus: 'under_review', note: null, at: '2026-10-02T09:00:00Z' },
      {
        fromStatus: 'under_review',
        toStatus: 'needs_changes',
        note: 'Two items need fixing.',
        at: '2026-10-03T09:00:00Z',
      },
    ],
    ...overrides,
  });
}

describe('stage tracker (UC-D-03)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage('en');
  });

  it('shows the submitted stage with its history', async () => {
    await openGate({ status: 200, body: applicationFixture('submitted') });
    await screen.findByTestId('tracker-submitted');
    expect(screen.getByTestId('tracker-status-chip')).toHaveTextContent('Submitted', { exact: false });
    expect(screen.getByTestId('gate-body')).toHaveTextContent('We received your application. A reviewer will pick it up soon.', { exact: false });
    expect(screen.getByTestId('history-0')).toHaveTextContent('Submitted', { exact: false });
    expect(screen.queryByTestId('tracker-fix')).toBeNull();
  });

  it('shows the under-review stage', async () => {
    await openGate({
      status: 200,
      body: applicationFixture('under_review', {
        history: [
          { fromStatus: null, toStatus: 'submitted', note: null, at: '2026-10-01T09:00:00Z' },
          { fromStatus: 'submitted', toStatus: 'under_review', note: null, at: '2026-10-02T09:00:00Z' },
        ],
      }),
    });
    await screen.findByTestId('tracker-under_review');
    expect(screen.getByTestId('tracker-status-chip')).toHaveTextContent('Under review', { exact: false });
    expect(screen.getByTestId('history-1')).toHaveTextContent('Under review', { exact: false });
  });

  it('lists exactly the flagged items with the reviewer notes (needs_changes)', async () => {
    await openGate({ status: 200, body: needsChanges() });
    await screen.findByTestId('tracker-needs_changes');
    expect(screen.getByTestId('flagged-personal')).toHaveTextContent('Photo is blurry — upload a clear face photo.', { exact: false });
    expect(screen.getByTestId('flagged-insurance')).toHaveTextContent('Insurance number does not match the scan.', { exact: false });
    expect(screen.queryByTestId('flagged-government_id')).toBeNull();
    expect(screen.queryByTestId('flagged-vehicle')).toBeNull();
    expect(screen.getByTestId('history-2')).toHaveTextContent('Two items need fixing.', { exact: false });
  });

  it('shows the rejection reason and lets the applicant reapply in full', async () => {
    await openGate({
      status: 200,
      body: applicationFixture('rejected', { rejectionReason: 'License is not valid in Syria.' }),
    });
    await screen.findByTestId('tracker-rejected');
    expect(screen.getByTestId('tracker-rejection-reason')).toHaveTextContent('License is not valid in Syria.', { exact: false });
    fireEvent.press(screen.getByTestId('tracker-reapply'));
    expect(await screen.findByTestId('wizard-step-count')).toHaveTextContent('Step 1 of 8', { exact: false });
  });

  it('on approval refreshes /users/me and unlocks driver home', async () => {
    const approvedProfile = driverUser({ id: user.id, name: user.name });
    await seedSession(user);
    const contract = installContractFetch({
      // Boot refresh still returns the rider-only profile; the tracker's
      // own refresh sees the activated driver role.
      'GET /api/v1/users/me': [
        { status: 200, body: user },
        { status: 200, body: approvedProfile },
      ],
      'GET /api/v1/driver/application': { status: 200, body: applicationFixture('approved') },
    });
    renderRouter('src/app');

    expect(await screen.findByTestId('home-screen')).toBeTruthy();
    expect(getSession()?.user.roles).toContainEqual({ role: 'driver', state: 'active' });
    expect(contract.requestsTo('GET /api/v1/users/me').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the intro when the account never applied (404)', async () => {
    await openGate({ status: 404, body: { status: 404, message: 'none' } });
    expect(await screen.findByTestId('gate-intro')).toBeTruthy();
    expect(screen.getByTestId('gate-body')).toBeTruthy();
  });

  it('distinguishes a server failure from a network failure, both retryable', async () => {
    await openGate([
      { status: 500, body: { status: 500, message: 'boom' } },
      { status: 200, body: applicationFixture('submitted') },
    ]);
    expect(await screen.findByTestId('failure-server')).toBeTruthy();
    fireEvent.press(screen.getByTestId('failure-retry'));
    expect(await screen.findByTestId('tracker-submitted')).toBeTruthy();
  });

  it('shows the network state when the request never reaches the server', async () => {
    // No route for the application → the mocked fetch throws (no response).
    await seedSession(user);
    installContractFetch({ 'GET /api/v1/users/me': { status: 200, body: user } });
    renderRouter('src/app');
    expect(await screen.findByTestId('failure-network')).toBeTruthy();
    expect(screen.getByText('No connection')).toBeTruthy();
  });
});

describe('resubmission of flagged items only (UC-D-02)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage('en');
  });

  it('walks only the flagged steps and sends exactly the flagged items', async () => {
    const application = needsChanges();
    const contract = await openGate(
      [
        { status: 200, body: application },
        { status: 200, body: application },
        { status: 200, body: applicationFixture('under_review') },
      ],
      {
        'POST /api/v1/driver/files': uploaded('f-ins-new', 'application/pdf'),
        'POST /api/v1/driver/application/resubmit': {
          status: 200,
          body: applicationFixture('under_review'),
        },
      },
    );
    await screen.findByTestId('tracker-needs_changes');
    fireEvent.press(screen.getByTestId('tracker-fix'));

    // Step 1 of 3: personal (flagged), with the reviewer's note + a required confirmation.
    expect(await screen.findByTestId('wizard-step-count')).toHaveTextContent('Step 1 of 3', { exact: false });
    expect(screen.getByTestId('step-note')).toHaveTextContent('Photo is blurry — upload a clear face photo.', { exact: false });
    fireEvent.press(screen.getByTestId('wizard-next'));
    expect(await screen.findByText('Confirm your details to continue.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('personal-confirm'));
    fireEvent.press(screen.getByTestId('wizard-next'));

    // Step 2 of 3: the insurance document, prefilled, with its note.
    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-title')).toHaveTextContent('Insurance', { exact: false }),
    );
    expect(screen.getByTestId('step-note')).toHaveTextContent('Insurance number does not match the scan.', { exact: false });
    expect(screen.getByTestId('document-number').props.value).toBe('INS-OLD');
    fireEvent.changeText(screen.getByTestId('document-number'), 'INS-NEW');
    mockDocumentPick('insurance.pdf');
    fireEvent.press(screen.getByTestId('document-file-files'));
    await waitFor(() =>
      expect(contract.requestsTo('POST /api/v1/driver/files')).toHaveLength(1),
    );
    pickDate('document-expiry', isoInDays(300));
    fireEvent.press(screen.getByTestId('wizard-next'));

    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-count')).toHaveTextContent('Step 3 of 3', { exact: false }),
    );
    expect(screen.queryByTestId('review-vehicle')).toBeNull();
    expect(screen.queryByTestId('review-doc:government_id')).toBeNull();
    fireEvent.press(screen.getByTestId('wizard-submit'));

    await screen.findByTestId('tracker-under_review');
    expect(
      contract.requestsTo('POST /api/v1/driver/application/resubmit')[0].body,
    ).toEqual({
      confirmPersonalDetails: true,
      documents: [
        { type: 'insurance', number: 'INS-NEW', expiresOn: isoInDays(300), fileId: 'f-ins-new' },
      ],
    });
  });

  it('sends only the vehicle when only the vehicle is flagged', async () => {
    const application = applicationFixture('needs_changes', {
      vehicle: vehicleFixture({
        reviewStatus: 'changes_requested',
        reviewNote: 'Plate in the photo is unreadable.',
      }),
    });
    const contract = await openGate(
      [
        { status: 200, body: application },
        { status: 200, body: application },
        { status: 200, body: applicationFixture('under_review') },
      ],
      {
        'POST /api/v1/driver/application/resubmit': {
          status: 200,
          body: applicationFixture('under_review'),
        },
      },
    );
    await screen.findByTestId('tracker-needs_changes');
    expect(screen.getByTestId('flagged-vehicle')).toHaveTextContent('Plate in the photo is unreadable.', { exact: false });
    fireEvent.press(screen.getByTestId('tracker-fix'));

    expect(await screen.findByTestId('wizard-step-count')).toHaveTextContent('Step 1 of 3', { exact: false });
    expect(screen.getByTestId('wizard-step-title')).toHaveTextContent('Vehicle details', { exact: false });
    expect(screen.getByTestId('vehicle-make').props.value).toBe('Kia');
    fireEvent.changeText(screen.getByTestId('vehicle-plate'), 'DAM 654321');
    fireEvent.press(screen.getByTestId('wizard-next'));
    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-title')).toHaveTextContent('Vehicle photos', { exact: false }),
    );
    // Existing photos are prefilled (fileIds kept).
    expect(screen.getByTestId('vehicle-photos-tile-1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('wizard-next'));
    await screen.findByTestId('wizard-submit');
    fireEvent.press(screen.getByTestId('wizard-submit'));

    await screen.findByTestId('tracker-under_review');
    expect(
      contract.requestsTo('POST /api/v1/driver/application/resubmit')[0].body,
    ).toEqual({
      vehicle: {
        make: 'Kia',
        model: 'Rio',
        year: 2018,
        color: 'White',
        plate: 'DAM 654321',
        seats: 4,
        photoFileIds: ['photo-1', 'photo-2'],
      },
    });
  });

  it('maps a resubmit 409 (no longer needs changes) to its message', async () => {
    const application = needsChanges();
    await openGate([{ status: 200, body: application }], {
      'POST /api/v1/driver/application/resubmit': {
        status: 409,
        body: { status: 409, message: 'not needs_changes' },
      },
      'POST /api/v1/driver/files': uploaded('f-x', 'application/pdf'),
    });
    await screen.findByTestId('tracker-needs_changes');
    fireEvent.press(screen.getByTestId('tracker-fix'));
    await screen.findByTestId('step-personal');
    fireEvent.press(screen.getByTestId('personal-confirm'));
    fireEvent.press(screen.getByTestId('wizard-next'));
    await screen.findByTestId('step-doc-insurance');
    fireEvent.press(screen.getByTestId('wizard-next'));
    await screen.findByTestId('wizard-submit');
    fireEvent.press(screen.getByTestId('wizard-submit'));
    expect(await screen.findByTestId('wizard-error')).toHaveTextContent('Your application is no longer waiting for changes. Check its current status.', { exact: false });
  });
});

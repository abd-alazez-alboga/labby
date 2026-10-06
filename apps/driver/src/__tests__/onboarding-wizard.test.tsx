/**
 * M5-T3 — driver application wizard (UC-D-01) against onboarding-v1.yaml:
 * staged navigation with per-step client validation, file uploads, the E2
 * expired-date block, server fieldErrors mapped back to their step (E1),
 * and the network / server / conflict failure states.
 */
import { renderRouter, screen } from 'expo-router/testing-library';
import { fireEvent, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';

import type { UserProfile } from '../api/auth-types';
import { clearSession } from '../auth/session';
import { initI18n, setAppLanguage } from '../i18n';
import { installContractFetch, riderOnlyUser, seedSession } from '../test-utils/contract';
import type { MockResponse } from '../test-utils/contract';
import {
  applicationFixture,
  isoInDays,
  mockDocumentPick,
  mockLibraryPick,
  pickDate,
  uploaded,
} from '../test-utils/onboarding';

const withPhoto = (overrides: Partial<UserProfile> = {}) =>
  riderOnlyUser({ photoUrl: '/api/v1/files/profile-token', ...overrides });

const EXPIRY = isoInDays(365);

const DOC_TITLES = [
  'Government ID',
  "Driver's license",
  'Vehicle registration',
  'Insurance',
];

function startAtWizard(user: UserProfile, routes: Record<string, MockResponse | MockResponse[]>) {
  const contract = installContractFetch({
    'GET /api/v1/users/me': { status: 200, body: user },
    ...routes,
  });
  renderRouter('src/app', { initialUrl: '/driver-application' });
  return contract;
}

/** Fills the current document step: PDF via the file picker, number, expiry. */
async function fillDocument(number: string, expiresOn = EXPIRY) {
  mockDocumentPick(`${number}.pdf`);
  fireEvent.press(screen.getByTestId('document-file-files'));
  await screen.findByTestId('document-file-preview');
  fireEvent.changeText(screen.getByTestId('document-number'), number);
  pickDate('document-expiry', expiresOn);
}

async function continueTo(title: string) {
  fireEvent.press(screen.getByTestId('wizard-next'));
  await waitFor(() =>
    expect(screen.getByTestId('wizard-step-title')).toHaveTextContent(title),
  );
}

/** Personal → 4 documents → vehicle → photos, landing on the review step. */
async function fillAllSteps() {
  await screen.findByTestId('step-personal');
  await continueTo(DOC_TITLES[0]);
  const numbers = ['ID-1', 'LIC-2', 'REG-3', 'INS-4'];
  for (let i = 0; i < 4; i += 1) {
    await fillDocument(numbers[i]);
    await continueTo(i < 3 ? DOC_TITLES[i + 1] : 'Vehicle details');
  }
  fireEvent.changeText(screen.getByTestId('vehicle-make'), 'Kia');
  fireEvent.changeText(screen.getByTestId('vehicle-model'), 'Rio');
  fireEvent.changeText(screen.getByTestId('vehicle-year'), '2018');
  fireEvent.changeText(screen.getByTestId('vehicle-color'), 'White');
  fireEvent.changeText(screen.getByTestId('vehicle-plate'), 'دمشق 123456');
  fireEvent.changeText(screen.getByTestId('vehicle-seats'), '4');
  await continueTo('Vehicle photos');
  mockLibraryPick('car-front.jpg');
  fireEvent.press(screen.getByTestId('vehicle-photos-library'));
  await screen.findByTestId('vehicle-photos-tile-0');
  await continueTo('Review and submit');
}

const UPLOADS = [
  uploaded('f-id', 'application/pdf'),
  uploaded('f-lic', 'application/pdf'),
  uploaded('f-reg', 'application/pdf'),
  uploaded('f-ins', 'application/pdf'),
  uploaded('f-photo', 'image/jpeg'),
];

describe('driver application wizard (UC-D-01)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage('en');
  });

  it('starts from the gate intro and submits the exact contract body, then shows the tracker', async () => {
    const user = withPhoto();
    await seedSession(user);
    const contract = installContractFetch({
      'GET /api/v1/users/me': { status: 200, body: user },
      'GET /api/v1/driver/application': [
        { status: 404, body: { status: 404, message: 'never applied' } },
        { status: 200, body: applicationFixture('submitted') },
      ],
      'POST /api/v1/driver/files': UPLOADS,
      'POST /api/v1/driver/application': {
        status: 201,
        body: applicationFixture('submitted'),
      },
    });
    renderRouter('src/app');

    // Never applied → the intro with a start action.
    await screen.findByTestId('gate-intro');
    fireEvent.press(screen.getByTestId('gate-start'));
    expect(await screen.findByTestId('wizard-step-count')).toHaveTextContent('Step 1 of 8');

    await fillAllSteps();
    expect(screen.getByTestId('wizard-step-count')).toHaveTextContent('Step 8 of 8');
    fireEvent.press(screen.getByTestId('wizard-submit'));

    // Back on the gate, now showing the stage tracker.
    expect(await screen.findByTestId('tracker-submitted')).toBeTruthy();

    // Files went up first as multipart with kind document / vehicle_photo.
    const uploads = contract.requestsTo('POST /api/v1/driver/files');
    expect(uploads).toHaveLength(5);
    expect(uploads[0].body).toBeInstanceOf(FormData);
    const kinds = uploads.map((request) => (request.body as FormData).get('kind'));
    expect(kinds).toEqual(['document', 'document', 'document', 'document', 'vehicle_photo']);

    // Name unchanged → no profile write; the submit carries fileIds only.
    expect(contract.requestsTo('PUT /api/v1/users/me')).toHaveLength(0);
    expect(contract.requestsTo('POST /api/v1/driver/application')[0].body).toEqual({
      documents: [
        { type: 'government_id', number: 'ID-1', expiresOn: EXPIRY, fileId: 'f-id' },
        { type: 'drivers_license', number: 'LIC-2', expiresOn: EXPIRY, fileId: 'f-lic' },
        { type: 'vehicle_registration', number: 'REG-3', expiresOn: EXPIRY, fileId: 'f-reg' },
        { type: 'insurance', number: 'INS-4', expiresOn: EXPIRY, fileId: 'f-ins' },
      ],
      vehicle: {
        make: 'Kia',
        model: 'Rio',
        year: 2018,
        color: 'White',
        plate: 'دمشق 123456',
        seats: 4,
        photoFileIds: ['f-photo'],
      },
    });
  });

  it('requires a profile photo on the personal step and uploads it via /users/me/photo', async () => {
    const user = riderOnlyUser({ photoUrl: null });
    await seedSession(user);
    const contract = startAtWizard(user, {
      'PUT /api/v1/users/me/photo': {
        status: 200,
        body: { ...user, photoUrl: '/api/v1/files/new-photo' },
      },
    });

    await screen.findByTestId('step-personal');
    expect(screen.getByTestId('personal-photo-missing')).toBeTruthy();
    fireEvent.press(screen.getByTestId('wizard-next'));
    expect(await screen.findByText('Add a profile photo to continue.')).toBeTruthy();
    expect(screen.getByTestId('wizard-step-title')).toHaveTextContent('Personal details');

    mockLibraryPick('me.jpg');
    fireEvent.press(screen.getByTestId('personal-photo-library'));
    await screen.findByTestId('personal-photo-on-file');
    expect(contract.requestsTo('PUT /api/v1/users/me/photo')[0].body).toBeInstanceOf(FormData);

    await continueTo('Government ID');
  });

  it('saves a changed name through PUT /users/me before moving on', async () => {
    const user = withPhoto();
    await seedSession(user);
    const contract = startAtWizard(user, {
      'PUT /api/v1/users/me': { status: 200, body: { ...user, name: 'Rami Haddad' } },
    });

    await screen.findByTestId('step-personal');
    fireEvent.changeText(screen.getByTestId('personal-name'), '   ');
    fireEvent.press(screen.getByTestId('wizard-next'));
    expect(await screen.findByText('Enter your name.')).toBeTruthy();
    expect(contract.requestsTo('PUT /api/v1/users/me')).toHaveLength(0);

    fireEvent.changeText(screen.getByTestId('personal-name'), 'Rami Haddad');
    await continueTo('Government ID');
    expect(contract.requestsTo('PUT /api/v1/users/me')[0].body).toEqual({
      name: 'Rami Haddad',
      language: 'en',
    });
  });

  it('validates each document step inline before any API call', async () => {
    const user = withPhoto();
    await seedSession(user);
    const contract = startAtWizard(user, {});

    await screen.findByTestId('step-personal');
    await continueTo('Government ID');
    fireEvent.press(screen.getByTestId('wizard-next'));

    expect(await screen.findByText('Add the document file.')).toBeTruthy();
    expect(screen.getByText('Enter the document number.')).toBeTruthy();
    expect(screen.getByText('Select the expiry date.')).toBeTruthy();
    expect(screen.getByTestId('wizard-step-title')).toHaveTextContent('Government ID');
    expect(contract.requestsTo('POST /api/v1/driver/application')).toHaveLength(0);
    expect(contract.requestsTo('POST /api/v1/driver/files')).toHaveLength(0);
  });

  it('blocks an expired or today-expiring document client-side (E2)', async () => {
    const user = withPhoto();
    await seedSession(user);
    startAtWizard(user, { 'POST /api/v1/driver/files': uploaded('f-id', 'application/pdf') });

    await screen.findByTestId('step-personal');
    await continueTo('Government ID');
    await fillDocument('ID-1', isoInDays(0));
    fireEvent.press(screen.getByTestId('wizard-next'));

    expect(
      await screen.findByText(
        'This document has expired or expires today. Use a document that is valid after today.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('wizard-step-title')).toHaveTextContent('Government ID');

    pickDate('document-expiry', isoInDays(-30));
    expect(screen.getByTestId('document-expiry-error')).toBeTruthy();

    pickDate('document-expiry', isoInDays(1));
    await continueTo("Driver's license");
  });

  it('validates vehicle details: year 1980..next year, seats 1–8, required text', async () => {
    const user = withPhoto();
    await seedSession(user);
    startAtWizard(user, { 'POST /api/v1/driver/files': UPLOADS });

    await screen.findByTestId('step-personal');
    await continueTo(DOC_TITLES[0]);
    for (let i = 0; i < 4; i += 1) {
      await fillDocument(`N-${i}`);
      await continueTo(i < 3 ? DOC_TITLES[i + 1] : 'Vehicle details');
    }

    fireEvent.changeText(screen.getByTestId('vehicle-year'), '1979');
    fireEvent.changeText(screen.getByTestId('vehicle-seats'), '9');
    fireEvent.press(screen.getByTestId('wizard-next'));
    expect(await screen.findByText('Enter the vehicle make.')).toBeTruthy();
    expect(screen.getByText('Enter a year from 1980 to next year.')).toBeTruthy();
    expect(screen.getByText('Enter a number of seats from 1 to 8.')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('vehicle-year'), String(new Date().getFullYear() + 2));
    expect(screen.getByText('Enter a year from 1980 to next year.')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('vehicle-make'), 'Kia');
    fireEvent.changeText(screen.getByTestId('vehicle-model'), 'Rio');
    // Arabic-Indic digits from an Arabic keyboard are accepted.
    fireEvent.changeText(screen.getByTestId('vehicle-year'), '٢٠١٨');
    fireEvent.changeText(screen.getByTestId('vehicle-color'), 'White');
    fireEvent.changeText(screen.getByTestId('vehicle-plate'), 'ABC123');
    fireEvent.changeText(screen.getByTestId('vehicle-seats'), '4');
    await continueTo('Vehicle photos');

    // Photos: at least one is required.
    fireEvent.press(screen.getByTestId('wizard-next'));
    expect(await screen.findByText('Add at least one vehicle photo.')).toBeTruthy();
  });

  it('rejects a wrong file type before upload and maps 413 to the size message', async () => {
    const user = withPhoto();
    await seedSession(user);
    const contract = startAtWizard(user, {
      'POST /api/v1/driver/files': { status: 413, body: { status: 413, message: 'too big' } },
    });

    await screen.findByTestId('step-personal');
    await continueTo('Government ID');

    mockDocumentPick('scan.gif', 'image/gif');
    fireEvent.press(screen.getByTestId('document-file-files'));
    expect(await screen.findByText('Use a photo (JPEG or PNG) or a PDF file.')).toBeTruthy();
    expect(contract.requestsTo('POST /api/v1/driver/files')).toHaveLength(0);

    mockDocumentPick('huge.pdf', 'application/pdf', 11 * 1024 * 1024);
    fireEvent.press(screen.getByTestId('document-file-files'));
    expect(
      await screen.findByText('This file is too large. The maximum size is 10 MB.'),
    ).toBeTruthy();
    expect(contract.requestsTo('POST /api/v1/driver/files')).toHaveLength(0);

    mockDocumentPick('ok.pdf', 'application/pdf', 2048);
    fireEvent.press(screen.getByTestId('document-file-files'));
    await screen.findByTestId('document-file-upload-error');
    expect(contract.requestsTo('POST /api/v1/driver/files')).toHaveLength(1);
    expect(screen.getByText('This file is too large. The maximum size is 10 MB.')).toBeTruthy();
    expect(DocumentPicker.getDocumentAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: ['image/jpeg', 'image/png', 'application/pdf'] }),
    );
  });

  it('maps server fieldErrors back to their steps and fields (E1)', async () => {
    const user = withPhoto();
    await seedSession(user);
    const contract = startAtWizard(user, {
      'POST /api/v1/driver/files': UPLOADS,
      'POST /api/v1/driver/application': [
        {
          status: 400,
          body: {
            status: 400,
            message: 'Validation failed',
            fieldErrors: {
              'documents[insurance].expiresOn': 'must be after today',
              'vehicle.photoFileIds': 'unreadable image',
            },
          },
        },
        { status: 201, body: applicationFixture('submitted') },
      ],
      'GET /api/v1/driver/application': { status: 200, body: applicationFixture('submitted') },
    });

    await fillAllSteps();
    fireEvent.press(screen.getByTestId('wizard-submit'));

    // Jumps to the first flagged step with the field highlighted.
    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-title')).toHaveTextContent('Insurance'),
    );
    expect(screen.getByTestId('wizard-step-error')).toHaveTextContent(
      'Some details need fixing — see the highlighted fields.',
    );
    expect(screen.getByTestId('document-expiry-error')).toHaveTextContent(
      'The expiry date was not accepted. It must be after today.',
    );

    // Editing the field clears its server error.
    pickDate('document-expiry', isoInDays(400));
    expect(screen.queryByTestId('document-expiry-error')).toBeNull();
    await continueTo('Vehicle details');
    await continueTo('Vehicle photos');
    expect(screen.getByTestId('vehicle-photos-error')).toHaveTextContent(
      'The vehicle photos were not accepted. Add 1 to 4 JPEG or PNG photos again.',
    );
    fireEvent.press(screen.getByTestId('vehicle-photos-remove-0'));
    mockLibraryPick('car-new.jpg');
    fireEvent.press(screen.getByTestId('vehicle-photos-library'));
    await screen.findByTestId('vehicle-photos-tile-0');
    await continueTo('Review and submit');

    fireEvent.press(screen.getByTestId('wizard-submit'));
    await screen.findByTestId('tracker-submitted');
    const second = contract.requestsTo('POST /api/v1/driver/application')[1].body as {
      documents: { type: string; expiresOn: string }[];
      vehicle: { photoFileIds: string[] };
    };
    expect(second.documents[3]).toMatchObject({ type: 'insurance', expiresOn: isoInDays(400) });
    // UPLOADS' last entry repeats for the replacement photo.
    expect(second.vehicle.photoFileIds).toEqual(['f-photo']);
  });

  it('shows the conflict message on 409 with a way back to the application', async () => {
    const user = withPhoto();
    await seedSession(user);
    startAtWizard(user, {
      'POST /api/v1/driver/files': UPLOADS,
      'POST /api/v1/driver/application': {
        status: 409,
        body: { status: 409, message: 'already open' },
      },
    });

    await fillAllSteps();
    fireEvent.press(screen.getByTestId('wizard-submit'));
    expect(await screen.findByTestId('wizard-error')).toHaveTextContent(
      'You already have an application in progress or approved.',
    );
    expect(screen.getByTestId('wizard-conflict-exit')).toBeTruthy();
  });

  it('distinguishes a network failure from a server failure on submit', async () => {
    const user = withPhoto();
    await seedSession(user);
    const contract = startAtWizard(user, {
      'POST /api/v1/driver/files': UPLOADS,
      'POST /api/v1/driver/application': { status: 500, body: { status: 500, message: 'boom' } },
    });

    await fillAllSteps();
    fireEvent.press(screen.getByTestId('wizard-submit'));
    expect(await screen.findByTestId('wizard-error')).toHaveTextContent(
      'Our service had a problem handling this. Please try again in a moment.',
    );

    // Same press, but the request never reaches the server.
    contract.fetchSpy.mockImplementationOnce(async () => {
      throw new TypeError('Network request failed');
    });
    fireEvent.press(screen.getByTestId('wizard-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('wizard-error')).toHaveTextContent(
        "We couldn't reach Labby. Check your internet connection and try again.",
      ),
    );
  });

  it('walks back with the Back button and keeps entered values', async () => {
    const user = withPhoto();
    await seedSession(user);
    startAtWizard(user, { 'POST /api/v1/driver/files': uploaded('f-id', 'application/pdf') });

    await screen.findByTestId('step-personal');
    await continueTo('Government ID');
    await fillDocument('ID-77');
    await continueTo("Driver's license");
    fireEvent.press(screen.getByTestId('wizard-back'));
    await waitFor(() =>
      expect(screen.getByTestId('wizard-step-title')).toHaveTextContent('Government ID'),
    );
    expect(screen.getByTestId('document-number').props.value).toBe('ID-77');
    expect(screen.getByTestId('document-file-preview')).toBeTruthy();
  });
});

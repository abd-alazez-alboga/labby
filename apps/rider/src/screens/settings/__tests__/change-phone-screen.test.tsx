import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import React from 'react';

import { mockApi, sampleUser, seedSignedInSession } from '../../../test-utils/mock-api';
import { renderWithProviders } from '../../../test-utils/render';
import ChangePhoneScreen from '../change-phone-screen';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require('expo-secure-store') as { __reset: () => void };

const START = 'POST /api/v1/users/me/phone-change/start';
const VERIFY_CURRENT = 'POST /api/v1/users/me/phone-change/verify-current';
const COMPLETE = 'POST /api/v1/users/me/phone-change/complete';

async function startWizard(newPhone = '+963900000099') {
  await renderWithProviders(<ChangePhoneScreen />);
  expect(await screen.findByTestId('change-phone-step-new')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByTestId('change-phone-new'), newPhone);
  await fireEvent.press(screen.getByTestId('change-phone-start'));
}

describe('ChangePhoneScreen (UC-S-06)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it('walks the three-step wizard to a new phone number', async () => {
    const api = mockApi({
      [START]: { status: 204 },
      [VERIFY_CURRENT]: { status: 204 },
      [COMPLETE]: { status: 200, body: { ...sampleUser, phone: '+963900000099' } },
    });

    await startWizard();
    expect(await screen.findByTestId('change-phone-step-current')).toBeOnTheScreen();
    expect(api.callsTo('POST', '/api/v1/users/me/phone-change/start')[0].body).toEqual({
      newPhone: '+963900000099',
    });

    await fireEvent.changeText(screen.getByTestId('change-phone-current-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('change-phone-current-verify'));
    expect(await screen.findByTestId('change-phone-step-verify-new')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('change-phone-new-otp-code-input'), '654321');
    await fireEvent.press(screen.getByTestId('change-phone-new-otp-verify'));
    expect(await screen.findByTestId('change-phone-step-done')).toBeOnTheScreen();
    expect(api.callsTo('POST', '/api/v1/users/me/phone-change/complete')[0].body).toEqual({
      code: '654321',
    });
  });

  it('rejects a new phone already in use (409, UC-S-06 E1)', async () => {
    mockApi({
      [START]: { status: 409, body: { status: 409, message: 'in use' } },
    });

    await startWizard();

    expect(
      await screen.findByText('This phone number is already used by another account.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('change-phone-step-new')).toBeOnTheScreen();
  });

  it('restarts the wizard when a code expires (410) — nothing mutated', async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY_CURRENT]: { status: 410, body: { status: 410, message: 'gone' } },
    });

    await startWizard();
    expect(await screen.findByTestId('change-phone-step-current')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('change-phone-current-code-input'), '111111');
    await fireEvent.press(screen.getByTestId('change-phone-current-verify'));

    expect(await screen.findByTestId('change-phone-step-new')).toBeOnTheScreen();
    expect(screen.getByTestId('change-phone-restart')).toBeOnTheScreen();
  });

  it('shows the wrong-code error on 400 and stays on the step', async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY_CURRENT]: { status: 400, body: { status: 400, message: 'wrong' } },
    });

    await startWizard();
    expect(await screen.findByTestId('change-phone-step-current')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('change-phone-current-code-input'), '111111');
    await fireEvent.press(screen.getByTestId('change-phone-current-verify'));

    expect(
      await screen.findByText('Wrong code. Please check the SMS and try again.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('change-phone-step-current')).toBeOnTheScreen();
  });
});

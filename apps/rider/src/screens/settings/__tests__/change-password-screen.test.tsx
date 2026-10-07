import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import React from 'react';

import { mockApi, seedSignedInSession } from '../../../test-utils/mock-api';
import { renderWithProviders } from '../../../test-utils/render';
import ChangePasswordScreen from '../change-password-screen';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
}));

const mockRegisterForPush = jest.fn(() => Promise.resolve('registered'));
jest.mock('../../../notifications/push-registration', () => ({
  ...jest.requireActual('../../../notifications/push-registration'),
  registerForPush: (options: unknown) => mockRegisterForPush(options),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require('expo-secure-store') as { __reset: () => void };

const REQUEST_2FA = 'POST /api/v1/users/me/2fa/request';
const CHANGE = 'PUT /api/v1/users/me/password';

/** Walks the wizard to the OTP step: current password → Continue (sends code). */
async function passCurrentStep(current = 'oldpassword1') {
  await fireEvent.changeText(screen.getByTestId('change-password-current'), current);
  await fireEvent.press(screen.getByTestId('change-password-continue'));
  expect(await screen.findByTestId('change-password-otp-code-input')).toBeOnTheScreen();
}

/** Enters the OTP and verifies, landing on the new-password step. */
async function passOtpStep(code = '123456') {
  await fireEvent.changeText(screen.getByTestId('change-password-otp-code-input'), code);
  await fireEvent.press(screen.getByTestId('change-password-otp-verify'));
  expect(await screen.findByTestId('change-password-new')).toBeOnTheScreen();
}

describe('ChangePasswordScreen (UC-S-05, staged)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it('changes the password through current → OTP → new + confirm steps', async () => {
    const api = mockApi({
      [REQUEST_2FA]: { status: 204 },
      [CHANGE]: { status: 204 },
    });

    await renderWithProviders(<ChangePasswordScreen />);
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();

    await passCurrentStep();
    await passOtpStep();
    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'newpassword1');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'newpassword1');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-done')).toBeOnTheScreen();
    expect(api.callsTo('PUT', '/api/v1/users/me/password')[0].body).toEqual({
      currentPassword: 'oldpassword1',
      otpCode: '123456',
      newPassword: 'newpassword1',
    });
    // The server drops the account's push tokens on a password change: re-register, never prompt.
    expect(mockRegisterForPush).toHaveBeenCalledWith({ prompt: false });
  });

  it('requires the current password before sending a code', async () => {
    const api = mockApi({ [REQUEST_2FA]: { status: 204 } });

    await renderWithProviders(<ChangePasswordScreen />);
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('change-password-continue'));

    expect(await screen.findByText('Enter your current password.')).toBeOnTheScreen();
    expect(api.callsTo('POST', '/api/v1/users/me/2fa/request')).toHaveLength(0);
  });

  it('rejects a mismatched confirmation without calling the API', async () => {
    const api = mockApi({
      [REQUEST_2FA]: { status: 204 },
      [CHANGE]: { status: 204 },
    });

    await renderWithProviders(<ChangePasswordScreen />);
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();

    await passCurrentStep();
    await passOtpStep();
    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'newpassword1');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'different1');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(await screen.findByText('Passwords do not match.')).toBeOnTheScreen();
    expect(api.callsTo('PUT', '/api/v1/users/me/password')).toHaveLength(0);
  });

  it('shows the rejection message on 400 and offers start over', async () => {
    mockApi({
      [REQUEST_2FA]: { status: 204 },
      [CHANGE]: { status: 400, body: { status: 400, message: 'wrong' } },
    });

    await renderWithProviders(<ChangePasswordScreen />);
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();

    await passCurrentStep();
    await passOtpStep('000000');
    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'newpassword1');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'newpassword1');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(
      await screen.findByText(
        'The current password or the code is wrong. Please check both and try again.',
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('change-password-start-over'));
    expect(await screen.findByTestId('change-password-current')).toBeOnTheScreen();
  });

  it('shows the cap message when the 2FA code request is throttled (429)', async () => {
    mockApi({
      [REQUEST_2FA]: { status: 429, body: { status: 429, message: 'cap' } },
    });

    await renderWithProviders(<ChangePasswordScreen />);
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('change-password-current'), 'oldpassword1');
    await fireEvent.press(screen.getByTestId('change-password-continue'));

    expect(
      await screen.findByText('Too many codes requested. Please wait and try again later.'),
    ).toBeOnTheScreen();
  });

  it('signs out to the reset flow via the forgot-password link', async () => {
    mockApi({ 'POST /api/v1/auth/logout': { status: 204 } });

    await renderWithProviders(<ChangePasswordScreen />);
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('change-password-forgot'));

    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();
    expect(mockReplace).toHaveBeenCalledWith('/forgot-password');
  });
});

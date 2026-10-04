import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import React from 'react';

import { mockApi, seedSignedInSession } from '../../../test-utils/mock-api';
import { renderWithProviders } from '../../../test-utils/render';
import ChangePasswordScreen from '../change-password-screen';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require('expo-secure-store') as { __reset: () => void };

const REQUEST_2FA = 'POST /api/v1/users/me/2fa/request';
const CHANGE = 'PUT /api/v1/users/me/password';

describe('ChangePasswordScreen (UC-S-05)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it('changes the password with current password + 2FA OTP', async () => {
    const api = mockApi({
      [REQUEST_2FA]: { status: 204 },
      [CHANGE]: { status: 204 },
    });

    await renderWithProviders(<ChangePasswordScreen />);
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('change-password-send-code'));
    await fireEvent.changeText(screen.getByTestId('change-password-current'), 'oldpassword1');
    await fireEvent.changeText(screen.getByTestId('change-password-otp'), '123456');
    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'newpassword1');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-done')).toBeOnTheScreen();
    expect(api.callsTo('PUT', '/api/v1/users/me/password')[0].body).toEqual({
      currentPassword: 'oldpassword1',
      otpCode: '123456',
      newPassword: 'newpassword1',
    });
  });

  it('shows the rejection message on 400 (wrong current password or OTP)', async () => {
    mockApi({
      [REQUEST_2FA]: { status: 204 },
      [CHANGE]: { status: 400, body: { status: 400, message: 'wrong' } },
    });

    await renderWithProviders(<ChangePasswordScreen />);
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('change-password-current'), 'oldpassword1');
    await fireEvent.changeText(screen.getByTestId('change-password-otp'), '000000');
    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'newpassword1');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(
      await screen.findByText(
        'The current password or the code is wrong. Please check both and try again.',
      ),
    ).toBeOnTheScreen();
  });

  it('shows the cap message when the 2FA code request is throttled (429)', async () => {
    mockApi({
      [REQUEST_2FA]: { status: 429, body: { status: 429, message: 'cap' } },
    });

    await renderWithProviders(<ChangePasswordScreen />);
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('change-password-send-code'));

    expect(
      await screen.findByText('Too many codes requested. Please wait and try again later.'),
    ).toBeOnTheScreen();
  });
});

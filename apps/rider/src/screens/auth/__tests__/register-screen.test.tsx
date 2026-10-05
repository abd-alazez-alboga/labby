import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { getStoredTokens } from '../../../auth/session-store';
import { mockApi, tokensResponse } from '../../../test-utils/mock-api';
import { renderWithProviders } from '../../../test-utils/render';
import RegisterScreen from '../register-screen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require('expo-secure-store') as { __reset: () => void };

const START = 'POST /api/v1/auth/register/start';
const VERIFY = 'POST /api/v1/auth/register/verify';
const COMPLETE = 'POST /api/v1/auth/register/complete';

async function goToOtpStep() {
  await renderWithProviders(<RegisterScreen />);
  expect(await screen.findByTestId('register-step-phone')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByTestId('register-phone'), '+963900000001');
  await fireEvent.press(screen.getByTestId('register-send-code'));
  expect(await screen.findByTestId('register-step-otp')).toBeOnTheScreen();
}

describe('RegisterScreen (UC-S-01 / UC-S-08)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
  });

  it('registers happy-path: phone → OTP → details → signed in', async () => {
    const api = mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 200, body: { mode: 'new', registrationToken: 'reg-token-1' } },
      [COMPLETE]: { status: 201, body: tokensResponse() },
    });

    await goToOtpStep();
    expect(api.callsTo('POST', '/api/v1/auth/register/start')[0].body).toEqual({
      phone: '+963900000001',
    });

    await fireEvent.changeText(screen.getByTestId('register-otp-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('register-otp-verify'));
    expect(await screen.findByTestId('register-step-details')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('register-name'), 'New Rider');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'supersecret1');
    await fireEvent.changeText(screen.getByTestId('register-confirm-password'), 'supersecret1');
    await fireEvent.press(screen.getByTestId('register-terms'));
    await fireEvent.press(screen.getByTestId('register-complete'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('signedIn');
    });
    expect(api.callsTo('POST', '/api/v1/auth/register/complete')[0].body).toEqual({
      registrationToken: 'reg-token-1',
      password: 'supersecret1',
      name: 'New Rider',
      termsAccepted: true,
    });
    // Tokens landed in the secure store.
    expect(await getStoredTokens()).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
  });

  it('blocks registering before the terms of service are accepted', async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 200, body: { mode: 'new', registrationToken: 'reg-token-1' } },
    });

    await goToOtpStep();
    await fireEvent.changeText(screen.getByTestId('register-otp-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('register-otp-verify'));
    expect(await screen.findByTestId('register-step-details')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('register-name'), 'New Rider');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'supersecret1');
    await fireEvent.changeText(screen.getByTestId('register-confirm-password'), 'supersecret1');
    await fireEvent.press(screen.getByTestId('register-complete'));

    expect(await screen.findByTestId('register-terms-error')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('signedOut');
  });

  it('runs the resend cooldown countdown and re-enables resend after 60s', async () => {
    jest.useFakeTimers();
    try {
      const api = mockApi({ [START]: [{ status: 204 }, { status: 204 }] });

      await goToOtpStep();
      const resend = screen.getByTestId('register-otp-resend');
      expect(resend).toBeDisabled();
      expect(screen.getByText('Resend code in 60s')).toBeOnTheScreen();

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      expect(screen.getByText('Resend code in 30s')).toBeOnTheScreen();
      expect(screen.getByTestId('register-otp-resend')).toBeDisabled();

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      expect(screen.getByText('Resend code')).toBeOnTheScreen();
      expect(screen.getByTestId('register-otp-resend')).toBeEnabled();

      await fireEvent.press(screen.getByTestId('register-otp-resend'));
      await waitFor(() => {
        expect(api.callsTo('POST', '/api/v1/auth/register/start')).toHaveLength(2);
      });
      // Cooldown re-armed after the resend.
      expect(screen.getByText('Resend code in 60s')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the wrong-code error on 400 (attempt counted)', async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 400, body: { status: 400, message: 'wrong code' } },
    });

    await goToOtpStep();
    await fireEvent.changeText(screen.getByTestId('register-otp-code-input'), '000000');
    await fireEvent.press(screen.getByTestId('register-otp-verify'));

    expect(await screen.findByTestId('register-otp-server-error')).toBeOnTheScreen();
    expect(
      screen.getByText('Wrong code. Please check the SMS and try again.'),
    ).toBeOnTheScreen();
  });

  it('shows the expired/attempts-exhausted error on 410', async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 410, body: { status: 410, message: 'gone' } },
    });

    await goToOtpStep();
    await fireEvent.changeText(screen.getByTestId('register-otp-code-input'), '111111');
    await fireEvent.press(screen.getByTestId('register-otp-verify'));

    expect(
      await screen.findByText(
        'This code has expired or was used too many times. Request a new one.',
      ),
    ).toBeOnTheScreen();
  });

  it('shows the hourly-cap message when the resend is throttled (429)', async () => {
    mockApi({
      [START]: [{ status: 204 }, { status: 429, body: { status: 429, message: 'cap' } }],
    });
    jest.useFakeTimers();
    try {
      await goToOtpStep();
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      await fireEvent.press(screen.getByTestId('register-otp-resend'));
      expect(
        await screen.findByText('Too many codes requested. Please wait and try again later.'),
      ).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it('redirects to login when the phone is already registered (409, UC-S-01 E5)', async () => {
    mockApi({
      [START]: { status: 409, body: { status: 409, message: 'taken' } },
    });

    await renderWithProviders(<RegisterScreen />);
    expect(await screen.findByTestId('register-step-phone')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('register-phone'), '+963900000001');
    await fireEvent.press(screen.getByTestId('register-send-code'));

    expect(await screen.findByTestId('register-phone-taken')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('register-go-login'));
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });

  it('shows the SMS-send failure message when the gateway is unreachable (E4)', async () => {
    mockApi({}); // no routes → network failure

    await renderWithProviders(<RegisterScreen />);
    expect(await screen.findByTestId('register-step-phone')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('register-phone'), '+963900000001');
    await fireEvent.press(screen.getByTestId('register-send-code'));

    expect(
      await screen.findByText('The code could not be sent. Please try again later.'),
    ).toBeOnTheScreen();
  });

  it('handles the reactivation branch: welcome back → login (UC-S-08)', async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 200, body: { mode: 'reactivated', registrationToken: null } },
    });

    await goToOtpStep();
    await fireEvent.changeText(screen.getByTestId('register-otp-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('register-otp-verify'));

    expect(await screen.findByTestId('register-step-reactivated')).toBeOnTheScreen();
    expect(screen.getByText('Welcome back!')).toBeOnTheScreen();
    // Still signed out — the user logs in with the old password.
    expect(screen.getByTestId('auth-status')).toHaveTextContent('signedOut');
    await fireEvent.press(screen.getByTestId('register-reactivated-login'));
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });

  it('offers start-over when the registration token expired (400 on complete)', async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 200, body: { mode: 'new', registrationToken: 'reg-token-1' } },
      [COMPLETE]: { status: 400, body: { status: 400, message: 'token expired' } },
    });

    await goToOtpStep();
    await fireEvent.changeText(screen.getByTestId('register-otp-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('register-otp-verify'));
    expect(await screen.findByTestId('register-step-details')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('register-name'), 'New Rider');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'supersecret1');
    await fireEvent.changeText(screen.getByTestId('register-confirm-password'), 'supersecret1');
    await fireEvent.press(screen.getByTestId('register-terms'));
    await fireEvent.press(screen.getByTestId('register-complete'));

    expect(await screen.findByTestId('register-complete-error')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('register-start-over'));
    expect(await screen.findByTestId('register-step-phone')).toBeOnTheScreen();
  });

  it('routes a complete-step 409 (concurrent registration) to the phone-taken path', async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 200, body: { mode: 'new', registrationToken: 'reg-token-1' } },
      [COMPLETE]: { status: 409, body: { status: 409, message: 'phone already registered' } },
    });

    await goToOtpStep();
    await fireEvent.changeText(screen.getByTestId('register-otp-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('register-otp-verify'));
    expect(await screen.findByTestId('register-step-details')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('register-name'), 'New Rider');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'supersecret1');
    await fireEvent.changeText(screen.getByTestId('register-confirm-password'), 'supersecret1');
    await fireEvent.press(screen.getByTestId('register-terms'));
    await fireEvent.press(screen.getByTestId('register-complete'));

    expect(await screen.findByTestId('register-phone-taken')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('register-go-login'));
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });
});

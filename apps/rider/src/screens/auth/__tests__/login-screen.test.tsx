import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { getStoredTokens } from '../../../auth/session-store';
import { mockApi, tokensResponse } from '../../../test-utils/mock-api';
import { renderWithProviders } from '../../../test-utils/render';
import LoginScreen from '../login-screen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require('expo-secure-store') as { __reset: () => void };

const LOGIN = 'POST /api/v1/auth/login';

async function submitLogin(phone = '+963900000001', password = 'supersecret1') {
  await renderWithProviders(<LoginScreen />);
  expect(await screen.findByTestId('login-screen')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByTestId('login-phone'), phone);
  await fireEvent.changeText(screen.getByTestId('login-password'), password);
  await fireEvent.press(screen.getByTestId('login-submit'));
}

describe('LoginScreen (UC-S-02)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
  });

  it('signs in with the rider client on success', async () => {
    const api = mockApi({ [LOGIN]: { status: 200, body: tokensResponse() } });

    await submitLogin();

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('signedIn');
    });
    expect(api.callsTo('POST', '/api/v1/auth/login')[0].body).toEqual({
      phone: '+963900000001',
      password: 'supersecret1',
      client: 'rider',
    });
    expect(await getStoredTokens()).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
  });

  it('shows the generic error on 401 (bad credentials or deleted account)', async () => {
    mockApi({ [LOGIN]: { status: 401, body: { status: 401, message: 'unauthorized' } } });

    await submitLogin();

    expect(await screen.findByTestId('login-server-error')).toBeOnTheScreen();
    expect(screen.getByText('Phone number or password is incorrect.')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('signedOut');
  });

  it('shows the no-valid-role error on 403', async () => {
    mockApi({ [LOGIN]: { status: 403, body: { status: 403, message: 'forbidden' } } });

    await submitLogin();

    expect(
      await screen.findByText('This account cannot use the rider app.'),
    ).toBeOnTheScreen();
  });

  it('shows the throttle message on 429 (NFR-S3)', async () => {
    mockApi({ [LOGIN]: { status: 429, body: { status: 429, message: 'slow down' } } });

    await submitLogin();

    expect(
      await screen.findByText('Too many failed attempts. Please wait a moment and try again.'),
    ).toBeOnTheScreen();
  });

  it('validates phone format and password presence before calling the API', async () => {
    const api = mockApi({});

    await submitLogin('12', '');

    expect(await screen.findByTestId('login-phone-error')).toBeOnTheScreen();
    expect(screen.getByTestId('login-password-error')).toBeOnTheScreen();
    expect(api.calls).toHaveLength(0);
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { getStoredTokens } from '../../auth/session-store';
import { LANGUAGE_STORAGE_KEY } from '../../i18n/locale-context';
import { mockApi, sampleUser, seedSignedInSession } from '../../test-utils/mock-api';
import { renderWithProviders } from '../../test-utils/render';
import SettingsScreen from '../settings-screen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require('expo-secure-store') as { __reset: () => void };

describe('SettingsScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
  });

  it('switches locale to AR, flips the direction flag, and persists the choice', async () => {
    await renderWithProviders(<SettingsScreen />);

    expect(await screen.findByTestId('settings-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('direction-flag')).toHaveTextContent('ltr');
    expect(screen.getByText('Language')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('language-ar'));

    await waitFor(() => {
      expect(screen.getByTestId('direction-flag')).toHaveTextContent('rtl');
    });
    // Strings now come from the AR catalogue.
    expect(screen.getByText('اللغة')).toBeOnTheScreen();
    expect(screen.getByTestId('language-ar')).toBeSelected();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'ar');
  });

  it('applies a persisted language on launch', async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, 'ar');
    await renderWithProviders(<SettingsScreen />);

    expect(await screen.findByTestId('direction-flag')).toHaveTextContent('rtl');
    expect(screen.getByText('اللغة')).toBeOnTheScreen();
  });

  it('syncs a signed-in language switch to the account (UC-S-10)', async () => {
    await seedSignedInSession();
    const api = mockApi({
      'PUT /api/v1/users/me': { status: 200, body: { ...sampleUser, language: 'ar' } },
    });

    await renderWithProviders(<SettingsScreen />);
    expect(await screen.findByTestId('settings-profile-card')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('language-ar'));

    // Instant local flip…
    await waitFor(() => {
      expect(screen.getByTestId('direction-flag')).toHaveTextContent('rtl');
    });
    // …and the best-effort account sync per the contract.
    await waitFor(() => {
      expect(api.callsTo('PUT', '/api/v1/users/me')[0]?.body).toEqual({
        name: 'Test Rider',
        language: 'ar',
      });
    });
  });

  it('shows the account rows and navigates to each management screen', async () => {
    await seedSignedInSession();
    mockApi({});

    await renderWithProviders(<SettingsScreen />);
    expect(await screen.findByTestId('settings-profile-card')).toBeOnTheScreen();
    expect(screen.getByText('Test Rider')).toBeOnTheScreen();
    expect(screen.getByText('+963900000001')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('settings-profile'));
    expect(mockPush).toHaveBeenCalledWith('/profile-edit');
    await fireEvent.press(screen.getByTestId('settings-password'));
    expect(mockPush).toHaveBeenCalledWith('/change-password');
    await fireEvent.press(screen.getByTestId('settings-phone'));
    expect(mockPush).toHaveBeenCalledWith('/change-phone');
    await fireEvent.press(screen.getByTestId('settings-delete'));
    expect(mockPush).toHaveBeenCalledWith('/delete-account');
  });

  it('logs out: revokes the refresh token and clears the session (UC-S-03)', async () => {
    await seedSignedInSession();
    const api = mockApi({
      'POST /api/v1/auth/logout': { status: 204 },
    });

    await renderWithProviders(<SettingsScreen />);
    expect(await screen.findByTestId('settings-logout')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('settings-logout'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('signedOut:manual');
    });
    expect(api.callsTo('POST', '/api/v1/auth/logout')[0].body).toEqual({
      refreshToken: 'seed-refresh',
    });
    expect(await getStoredTokens()).toBeNull();
  });
});

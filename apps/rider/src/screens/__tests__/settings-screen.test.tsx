import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import React from 'react';

import { LANGUAGE_STORAGE_KEY, LocaleProvider } from '../../i18n/locale-context';
import SettingsScreen from '../settings-screen';

describe('SettingsScreen language switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('switches locale to AR, flips the direction flag, and persists the choice', async () => {
    const user = userEvent.setup();
    await render(
      <LocaleProvider>
        <SettingsScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId('settings-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('direction-flag')).toHaveTextContent('ltr');
    expect(screen.getByText('Language')).toBeOnTheScreen();

    await user.press(screen.getByTestId('language-ar'));

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
    await render(
      <LocaleProvider>
        <SettingsScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId('direction-flag')).toHaveTextContent('rtl');
    expect(screen.getByText('اللغة')).toBeOnTheScreen();
  });
});

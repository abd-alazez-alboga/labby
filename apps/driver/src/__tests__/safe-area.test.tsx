import { render, screen } from '@testing-library/react-native';
import { renderRouter, screen as routerScreen } from 'expo-router/testing-library';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FormScreen } from '../components/auth/ui';
import { WelcomeScreen } from '../components/auth/welcome-screen';
import { HomeScreen } from '../components/home-screen';
import { SettingsScreen } from '../components/settings-screen';
import { spacing } from '../theme/tokens';
import { initI18n, setAppLanguage } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';

// An Android 15 edge-to-edge device with 3-button navigation.
const INSETS = { top: 32, bottom: 48, left: 0, right: 0 };
const METRICS = { frame: { x: 0, y: 0, width: 400, height: 800 }, insets: INSETS };

function withInsets(children: React.ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <LocaleProvider initialLanguage="en">{children}</LocaleProvider>
    </SafeAreaProvider>
  );
}

function contentStyle(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.contentContainerStyle);
}

describe('safe-area insets (edge-to-edge)', () => {
  beforeEach(async () => {
    await initI18n();
    await setAppLanguage('en');
  });

  it('home scrolls its last item (Settings) above the navigation bar', async () => {
    renderRouter(
      { index: () => withInsets(<HomeScreen />) },
      { initialUrl: '/' },
    );

    const home = await routerScreen.findByTestId('home-screen');
    const style = StyleSheet.flatten(home.props.contentContainerStyle);
    expect(style.paddingBottom).toBe(INSETS.bottom);
    expect(routerScreen.getByTestId('settings-link')).toBeTruthy();
  });

  it('adds the bottom inset on top of a screen’s own padding', () => {
    render(withInsets(<SettingsScreen />));
    expect(contentStyle('settings-screen').paddingBottom).toBe(spacing.lg + INSETS.bottom);
  });

  it('form screens (auth, account, wizard steps) clear the navigation bar', () => {
    render(
      withInsets(
        <FormScreen testID="form">
          <Text>Continue</Text>
        </FormScreen>,
      ),
    );
    expect(contentStyle('form').paddingBottom).toBe(spacing.lg + INSETS.bottom);
  });

  it('a fixed bottom action area pads to at least the inset', () => {
    render(withInsets(<WelcomeScreen />));
    const actions = StyleSheet.flatten(screen.getByTestId('welcome-actions').props.style);
    expect(actions.paddingBottom).toBe(Math.max(spacing.lg, INSETS.bottom));
  });

  it('keeps the plain spacing when the device reports no insets', () => {
    render(
      <LocaleProvider initialLanguage="en">
        <SettingsScreen />
      </LocaleProvider>,
    );
    expect(contentStyle('settings-screen').paddingBottom).toBe(spacing.lg);
  });
});

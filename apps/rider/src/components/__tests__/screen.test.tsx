/**
 * Edge-to-edge safe area (Android 15 / SDK 57): the last control of every
 * screen must stay above the system navigation bar, and headerless screens
 * must clear the status bar.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LocaleProvider } from '../../i18n/locale-context';
import HomeScreen from '../../screens/home-screen';
import LoginScreen from '../../screens/auth/login-screen';
import WelcomeScreen from '../../screens/auth/welcome-screen';
import { renderWithProviders } from '../../test-utils/render';
import { spacing } from '../../theme/tokens';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const INSETS = { top: 32, bottom: 48, left: 0, right: 0 };
const METRICS = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: INSETS };

function withInsets(ui: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>;
}

function flat(style: unknown): ViewStyle {
  return (StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle;
}

describe('safe-area screen primitives', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('adds the bottom inset to a scrollable screen content padding', async () => {
    await renderWithProviders(withInsets(<LoginScreen />));

    const scroll = await screen.findByTestId('login-screen');
    expect(flat(scroll.props.contentContainerStyle).paddingBottom).toBe(spacing.lg + INSETS.bottom);
  });

  it('keeps a fixed bottom panel above the navigation bar', async () => {
    await render(withInsets(<LocaleProvider><HomeScreen /></LocaleProvider>));

    const panel = await screen.findByTestId('home-panel');
    expect(flat(panel.props.style).paddingBottom).toBe(Math.max(spacing.lg, INSETS.bottom));
  });

  it('insets a headerless screen at the top and bottom', async () => {
    await renderWithProviders(withInsets(<WelcomeScreen />));

    const welcome = await screen.findByTestId('welcome-screen');
    const style = flat(welcome.props.style);
    expect(style.paddingTop).toBe(spacing.lg + INSETS.top);
    expect(style.paddingBottom).toBe(spacing.lg + INSETS.bottom);
  });

  it('adds nothing when the device reports no insets', async () => {
    await renderWithProviders(<LoginScreen />);

    const scroll = await screen.findByTestId('login-screen');
    expect(flat(scroll.props.contentContainerStyle).paddingBottom).toBe(spacing.lg);
  });
});

/**
 * Notification preferences (UC-S-12, NTF-02): ride + safety locked on (E1),
 * a toggle sends a partial PUT with exactly the changed category, the server
 * answer is the truth, failures revert with an explanation.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { LocaleProvider } from '../../../i18n/locale-context';
import { mockApi, seedSignedInSession } from '../../../test-utils/mock-api';
import { preferences } from '../../../test-utils/notification-fixtures';
import NotificationPreferencesScreen from '../notification-preferences-screen';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require('expo-secure-store') as { __reset: () => void };

const PREFS = '/api/v1/notifications/preferences';

function renderPreferences() {
  return render(
    <LocaleProvider>
      <NotificationPreferencesScreen />
    </LocaleProvider>,
  );
}

describe('NotificationPreferencesScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it('lists all six categories with ride and safety locked on', async () => {
    // Server order does not matter: the screen shows the contract order.
    mockApi({
      [`GET ${PREFS}`]: { status: 200, body: [...preferences({ promotions: false })].reverse() },
    });

    await renderPreferences();

    expect(await screen.findByTestId('preference-ride')).toBeOnTheScreen();
    expect(
      screen.getAllByTestId(/^preference-[a-z]+$/).map((row) => row.props.testID),
    ).toEqual([
      'preference-ride',
      'preference-chat',
      'preference-scheduled',
      'preference-promotions',
      'preference-account',
      'preference-safety',
    ]);
    for (const category of ['ride', 'safety']) {
      expect(screen.getByTestId(`preference-${category}-locked`)).toBeOnTheScreen();
      expect(screen.getByTestId(`preference-${category}-switch`)).toBeDisabled();
      expect(screen.getByTestId(`preference-${category}-switch`).props.value).toBe(true);
    }
    for (const category of ['chat', 'scheduled', 'promotions', 'account']) {
      expect(screen.queryByTestId(`preference-${category}-locked`)).toBeNull();
      expect(screen.getByTestId(`preference-${category}-switch`)).toBeEnabled();
    }
    expect(screen.getByTestId('preference-promotions-switch').props.value).toBe(false);
    expect(
      screen.getAllByText("Always on — ride and safety alerts can't be turned off."),
    ).toHaveLength(2);
    expect(
      screen.getByText(
        'Choose which notifications Labby sends to your phone. Muted categories still appear in your notification center.',
      ),
    ).toBeOnTheScreen();
  });

  it('sends a partial PUT with only the toggled category and applies the answer', async () => {
    const api = mockApi({
      [`GET ${PREFS}`]: { status: 200, body: preferences() },
      [`PUT ${PREFS}`]: { status: 200, body: preferences({ promotions: false }) },
    });

    await renderPreferences();
    await screen.findByTestId('preference-promotions-switch');

    await fireEvent(screen.getByTestId('preference-promotions-switch'), 'valueChange', false);

    await waitFor(() => expect(api.callsTo('PUT', PREFS)).toHaveLength(1));
    expect(api.callsTo('PUT', PREFS)[0].body).toEqual([{ category: 'promotions', enabled: false }]);
    await waitFor(() =>
      expect(screen.getByTestId('preference-promotions-switch').props.value).toBe(false),
    );
    expect(screen.queryByTestId('preferences-save-error')).toBeNull();
  });

  it('never sends a change for a locked category', async () => {
    const api = mockApi({ [`GET ${PREFS}`]: { status: 200, body: preferences() } });

    await renderPreferences();
    await screen.findByTestId('preference-safety-switch');
    await fireEvent(screen.getByTestId('preference-safety-switch'), 'valueChange', false);

    expect(api.callsTo('PUT', PREFS)).toHaveLength(0);
    expect(screen.getByTestId('preference-safety-switch').props.value).toBe(true);
  });

  it('reverts the toggle and explains when saving fails', async () => {
    mockApi({
      [`GET ${PREFS}`]: { status: 200, body: preferences() },
      [`PUT ${PREFS}`]: { status: 400, body: { status: 400, message: 'Locked category' } },
    });

    await renderPreferences();
    await screen.findByTestId('preference-chat-switch');
    await fireEvent(screen.getByTestId('preference-chat-switch'), 'valueChange', false);

    expect(await screen.findByTestId('preferences-save-error')).toHaveTextContent(
      "Your change couldn't be saved. Please try again.",
    );
    expect(screen.getByTestId('preference-chat-switch').props.value).toBe(true);
  });

  it('shows the network error state and recovers on retry', async () => {
    mockApi({});

    await renderPreferences();
    expect(await screen.findByTestId('preferences-error-network')).toBeOnTheScreen();

    mockApi({ [`GET ${PREFS}`]: { status: 200, body: preferences() } });
    await fireEvent.press(screen.getByTestId('error-retry'));
    expect(await screen.findByTestId('preference-ride')).toBeOnTheScreen();
  });

  it('shows the server error state', async () => {
    mockApi({ [`GET ${PREFS}`]: { status: 500, body: { status: 500 } } });

    await renderPreferences();
    expect(await screen.findByTestId('preferences-error-server')).toBeOnTheScreen();
  });
});

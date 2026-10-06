/**
 * Notification center (UC-S-11, NTF-03) against realtime-v1.yaml: rider
 * center pagination by cursor, read state + badge, mark-read on open,
 * read-all, category filter, and empty / network / server states.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { LANGUAGE_STORAGE_KEY, LocaleProvider } from '../../../i18n/locale-context';
import {
  NotificationsProvider,
  useOptionalNotifications,
} from '../../../notifications/notifications-context';
import { mockApi, seedSignedInSession } from '../../../test-utils/mock-api';
import { notification } from '../../../test-utils/notification-fixtures';
import NotificationCenterScreen from '../notification-center-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require('expo-secure-store') as { __reset: () => void };

const LIST = 'GET /api/v1/notifications';
const UNREAD = 'GET /api/v1/notifications/unread-count';

/** Shows the app-wide badge count the provider holds. */
function BadgeProbe() {
  const ctx = useOptionalNotifications();
  return <Text testID="badge-probe">{String(ctx?.unread ?? 'none')}</Text>;
}

function renderCenter() {
  return render(
    <LocaleProvider>
      <NotificationsProvider>
        <NotificationCenterScreen />
        <BadgeProbe />
      </NotificationsProvider>
    </LocaleProvider>,
  );
}

describe('NotificationCenterScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it('loads the rider center newest-first with read/unread state and syncs the badge', async () => {
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 1 } },
      [LIST]: {
        status: 200,
        body: {
          items: [
            notification('n1', { title: 'Welcome to Labby', read: false }),
            notification('n2', { title: 'Profile updated', read: true }),
          ],
          unread: 1,
          nextCursor: null,
        },
      },
    });

    await renderCenter();

    expect(await screen.findByText('Welcome to Labby')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-n1-unread')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-n2-read')).toBeOnTheScreen();
    expect(api.callsTo('GET', '/api/v1/notifications')[0].query).toEqual({
      app: 'rider',
      size: '20',
    });
    // The app-wide badge carries the center's unread count.
    await waitFor(() => expect(screen.getByTestId('badge-probe')).toHaveTextContent('1'));
    expect(screen.getByTestId('notifications-end')).toBeOnTheScreen();
  });

  it('pages with the nextCursor and stops on the last page', async () => {
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [LIST]: [
        {
          status: 200,
          body: { items: [notification('n1', { read: true })], unread: 0, nextCursor: 'c-1' },
        },
        {
          status: 200,
          body: { items: [notification('n2', { read: true })], unread: 0, nextCursor: null },
        },
      ],
    });

    await renderCenter();
    await screen.findByTestId('notification-n1');
    expect(screen.queryByTestId('notifications-end')).toBeNull();

    await act(async () => {
      fireEvent(screen.getByTestId('notification-list'), 'endReached');
    });

    expect(await screen.findByTestId('notification-n2')).toBeOnTheScreen();
    expect(api.callsTo('GET', '/api/v1/notifications')[1].query).toEqual({
      app: 'rider',
      before: 'c-1',
      size: '20',
    });
    expect(screen.getByTestId('notifications-end')).toBeOnTheScreen();

    // No cursor left → reaching the end again does not fetch.
    await act(async () => {
      fireEvent(screen.getByTestId('notification-list'), 'endReached');
    });
    expect(api.callsTo('GET', '/api/v1/notifications')).toHaveLength(2);
  });

  it('keeps the loaded list and offers a retry when loading more fails', async () => {
    mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [LIST]: [
        {
          status: 200,
          body: { items: [notification('n1', { read: true })], unread: 0, nextCursor: 'c-1' },
        },
        { status: 500, body: { status: 500, message: 'boom' } },
        {
          status: 200,
          body: { items: [notification('n2', { read: true })], unread: 0, nextCursor: null },
        },
      ],
    });

    await renderCenter();
    await screen.findByTestId('notification-n1');
    await act(async () => {
      fireEvent(screen.getByTestId('notification-list'), 'endReached');
    });

    expect(await screen.findByTestId('notifications-load-more-error')).toHaveTextContent(
      /Couldn't load older notifications right now\./,
    );
    expect(screen.getByTestId('notification-n1')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('notifications-load-more-retry'));
    expect(await screen.findByTestId('notification-n2')).toBeOnTheScreen();
  });

  it('marks an unread notification read when opened and decrements the badge', async () => {
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 2 } },
      [LIST]: {
        status: 200,
        body: {
          items: [notification('n1'), notification('n2')],
          unread: 2,
          nextCursor: null,
        },
      },
      'POST /api/v1/notifications/n1/read': { status: 204 },
    });

    await renderCenter();
    await screen.findByTestId('notification-n1-unread');
    await waitFor(() => expect(screen.getByTestId('badge-probe')).toHaveTextContent('2'));

    await fireEvent.press(screen.getByTestId('notification-n1'));

    expect(await screen.findByTestId('notification-n1-read')).toBeOnTheScreen();
    expect(screen.getByTestId('badge-probe')).toHaveTextContent('1');
    expect(api.callsTo('POST', '/api/v1/notifications/n1/read')).toHaveLength(1);
    // The link (none → the center) needs no navigation from the center itself.
    expect(mockPush).not.toHaveBeenCalled();

    // Opening an already-read notification does not call the API again.
    await fireEvent.press(screen.getByTestId('notification-n1'));
    expect(api.callsTo('POST', '/api/v1/notifications/n1/read')).toHaveLength(1);
  });

  it('reverts the optimistic read state when the server refuses it', async () => {
    mockApi({
      [UNREAD]: { status: 200, body: { unread: 1 } },
      [LIST]: {
        status: 200,
        body: { items: [notification('n1')], unread: 1, nextCursor: null },
      },
      'POST /api/v1/notifications/n1/read': { status: 404, body: { status: 404 } },
    });

    await renderCenter();
    await screen.findByTestId('notification-n1-unread');

    await fireEvent.press(screen.getByTestId('notification-n1'));

    expect(await screen.findByTestId('notification-n1-unread')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId('badge-probe')).toHaveTextContent('1'));
  });

  it('marks everything read and clears the badge', async () => {
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 2 } },
      [LIST]: {
        status: 200,
        body: { items: [notification('n1'), notification('n2')], unread: 2, nextCursor: null },
      },
      'POST /api/v1/notifications/read-all': { status: 204 },
    });

    await renderCenter();
    await screen.findByTestId('notification-n1-unread');

    await fireEvent.press(screen.getByTestId('notifications-read-all'));

    expect(await screen.findByTestId('notification-n1-read')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-n2-read')).toBeOnTheScreen();
    expect(screen.getByTestId('badge-probe')).toHaveTextContent('0');
    expect(api.callsTo('POST', '/api/v1/notifications/read-all')[0].query).toEqual({
      app: 'rider',
    });
    expect(screen.getByTestId('notifications-read-all')).toBeDisabled();
  });

  it('shows an error banner when read-all fails and keeps the unread state', async () => {
    mockApi({
      [UNREAD]: { status: 200, body: { unread: 1 } },
      [LIST]: {
        status: 200,
        body: { items: [notification('n1')], unread: 1, nextCursor: null },
      },
      'POST /api/v1/notifications/read-all': { status: 503, body: { status: 503 } },
    });

    await renderCenter();
    await screen.findByTestId('notification-n1-unread');
    await fireEvent.press(screen.getByTestId('notifications-read-all'));

    expect(await screen.findByTestId('notifications-read-all-error')).toHaveTextContent(
      "Couldn't mark your notifications as read. Please try again.",
    );
    expect(screen.getByTestId('notification-n1-unread')).toBeOnTheScreen();
  });

  it('filters by category through the API and shows a filtered empty state', async () => {
    const api = mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [LIST]: [
        {
          status: 200,
          body: { items: [notification('n1', { read: true })], unread: 0, nextCursor: null },
        },
        { status: 200, body: { items: [], unread: 0, nextCursor: null } },
      ],
    });

    await renderCenter();
    await screen.findByTestId('notification-n1');

    await fireEvent.press(screen.getByTestId('notification-filter-promotions'));

    expect(await screen.findByTestId('notifications-empty')).toBeOnTheScreen();
    expect(screen.getByText('Nothing in this category')).toBeOnTheScreen();
    expect(screen.getByTestId('notification-filter-promotions')).toBeSelected();
    expect(api.callsTo('GET', '/api/v1/notifications')[1].query).toEqual({
      app: 'rider',
      category: 'promotions',
      size: '20',
    });
  });

  it('shows the empty center state', async () => {
    mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [LIST]: { status: 200, body: { items: [], unread: 0 } },
    });

    await renderCenter();

    expect(await screen.findByTestId('notifications-empty')).toBeOnTheScreen();
    expect(screen.getByText('No notifications yet')).toBeOnTheScreen();
    expect(screen.getByTestId('notifications-read-all')).toBeDisabled();
  });

  it('distinguishes a network failure from a server error and retries', async () => {
    mockApi({ [UNREAD]: { status: 200, body: { unread: 0 } } }); // list unmocked → network

    await renderCenter();

    expect(await screen.findByTestId('notifications-error-network')).toBeOnTheScreen();
    expect(screen.getByText('No connection')).toBeOnTheScreen();

    mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [LIST]: [
        { status: 500, body: { status: 500, message: 'boom' } },
        { status: 200, body: { items: [notification('n1')], unread: 1, nextCursor: null } },
      ],
    });
    await fireEvent.press(screen.getByTestId('error-retry'));

    expect(await screen.findByTestId('notifications-error-server')).toBeOnTheScreen();
    expect(screen.getByText('Something went wrong on our side')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('error-retry'));
    expect(await screen.findByTestId('notification-n1')).toBeOnTheScreen();
  });

  it('renders in Arabic with the server-localized texts', async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, 'ar');
    mockApi({
      [UNREAD]: { status: 200, body: { unread: 1 } },
      [LIST]: {
        status: 200,
        body: {
          items: [notification('n1', { category: 'safety', title: 'تنبيه سلامة' })],
          unread: 1,
          nextCursor: null,
        },
      },
    });

    await renderCenter();

    expect(await screen.findByText('تنبيه سلامة')).toBeOnTheScreen();
    expect(screen.getByText('الكل')).toBeOnTheScreen();
    expect(screen.getAllByText('السلامة').length).toBeGreaterThan(0);
    expect(screen.getByText('تعيين الكل كمقروء')).toBeOnTheScreen();
  });

  it('opens the preferences screen from the toolbar', async () => {
    mockApi({
      [UNREAD]: { status: 200, body: { unread: 0 } },
      [LIST]: { status: 200, body: { items: [], unread: 0 } },
    });

    await renderCenter();
    await screen.findByTestId('notifications-empty');
    await fireEvent.press(screen.getByTestId('notifications-open-preferences'));

    expect(mockPush).toHaveBeenCalledWith('/notification-preferences');
  });
});

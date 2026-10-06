/**
 * M6-T4 — notification center (UC-S-11, NTF-03) and preferences (UC-S-12,
 * NTF-02) against realtime-v1.yaml: `app=driver` cursor pagination, the
 * unread badge, mark-read on open, read-all, the category filter, deep
 * links from the list, server history shown on a fresh install, and the
 * locked ride/safety categories with the partial PUT body.
 */
import { renderRouter, screen } from 'expo-router/testing-library';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import { View } from 'react-native';

import type { AppNotification, NotificationPreference } from '../api/realtime-types';
import { AuthProvider } from '../auth/AuthProvider';
import { clearSession } from '../auth/session';
import { NotificationCenterScreen } from '../components/notifications/notification-center-screen';
import { NotificationPreferencesScreen } from '../components/notifications/notification-preferences-screen';
import { NotificationsBell } from '../components/notifications/notifications-bell';
import { initI18n, setAppLanguage } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { getUnread, setUnread } from '../notifications/unread-store';
import { driverUser, installContractFetch, seedSession } from '../test-utils/contract';
import type { MockResponse } from '../test-utils/contract';

const PAGE_1 = 'GET /api/v1/notifications?app=driver&size=20';
const PAGE_2 = 'GET /api/v1/notifications?app=driver&before=cursor-2&size=20';
const ACCOUNT_ONLY = 'GET /api/v1/notifications?app=driver&category=account&size=20';
const UNREAD = 'GET /api/v1/notifications/unread-count?app=driver';
const READ_ALL = 'POST /api/v1/notifications/read-all?app=driver';
const PREFS = 'GET /api/v1/notifications/preferences';
const PUT_PREFS = 'PUT /api/v1/notifications/preferences';

function notification(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    category: 'account',
    event: 'driver_application.approved',
    title: `Title ${id}`,
    body: `Body ${id}`,
    link: null,
    read: false,
    createdAt: '2026-10-06T09:00:00Z',
    ...overrides,
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider initialLanguage="en">
      <AuthProvider>{children}</AuthProvider>
    </LocaleProvider>
  );
}

function renderApp(initialUrl: string) {
  renderRouter(
    {
      index: () => (
        <Wrapper>
          <NotificationsBell tone="dark" />
        </Wrapper>
      ),
      notifications: () => (
        <Wrapper>
          <NotificationCenterScreen />
        </Wrapper>
      ),
      'notification-preferences': () => (
        <Wrapper>
          <NotificationPreferencesScreen />
        </Wrapper>
      ),
      documents: () => <View testID="documents-route" />,
      vehicles: () => <View testID="vehicles-route" />,
    },
    { initialUrl },
  );
}

async function setup(routes: Record<string, MockResponse | MockResponse[]>, initialUrl = '/notifications') {
  await seedSession(driverUser());
  const contract = installContractFetch(routes);
  renderApp(initialUrl);
  return contract;
}

describe('notification center (UC-S-11)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    setUnread(0);
    await initI18n();
    await setAppLanguage('en');
  });

  it('shows the unread badge on the bell and opens the center', async () => {
    await setup(
      {
        [UNREAD]: { status: 200, body: { unread: 3 } },
        [PAGE_1]: { status: 200, body: { items: [], unread: 3, nextCursor: null } },
      },
      '/',
    );
    expect(await screen.findByTestId('notifications-badge')).toHaveTextContent('3');
    expect(screen.getByTestId('notifications-bell')).toHaveProp(
      'accessibilityLabel',
      'Notifications, 3 unread',
    );
    fireEvent.press(screen.getByTestId('notifications-bell'));
    expect(await screen.findByTestId('notification-center')).toBeTruthy();
  });

  it('lists the server history (fresh install) newest first and paginates by cursor', async () => {
    const contract = await setup({
      [PAGE_1]: {
        status: 200,
        body: {
          items: [notification('n1'), notification('n2', { read: true })],
          unread: 1,
          nextCursor: 'cursor-2',
        },
      },
      [PAGE_2]: {
        status: 200,
        body: { items: [notification('n3', { read: true })], unread: 1, nextCursor: null },
      },
    });

    expect(await screen.findByTestId('notification-n1')).toHaveTextContent('Title n1', {
      exact: false,
    });
    expect(screen.getByTestId('notification-n1-unread')).toBeTruthy();
    expect(screen.queryByTestId('notification-n2-unread')).toBeNull();
    expect(contract.requestsTo(PAGE_1)[0].headers.Authorization).toBe('Bearer access-1');

    await act(async () => {
      screen.getByTestId('notification-center').props.onEndReached();
    });
    expect(await screen.findByTestId('notification-n3')).toBeTruthy();
    expect(contract.requestsTo(PAGE_2)).toHaveLength(1);

    // Last page: no further requests.
    await act(async () => {
      screen.getByTestId('notification-center').props.onEndReached();
    });
    expect(contract.requestsTo(PAGE_2)).toHaveLength(1);
  });

  it('shows a retryable error when a later page fails', async () => {
    const contract = await setup({
      [PAGE_1]: {
        status: 200,
        body: { items: [notification('n1')], unread: 1, nextCursor: 'cursor-2' },
      },
      [PAGE_2]: [
        { status: 500, body: { status: 500 } },
        { status: 200, body: { items: [notification('n3')], unread: 2, nextCursor: null } },
      ],
    });
    await screen.findByTestId('notification-n1');
    await act(async () => {
      screen.getByTestId('notification-center').props.onEndReached();
    });
    expect(await screen.findByTestId('notifications-more-error')).toBeTruthy();
    fireEvent.press(screen.getByTestId('notifications-more-retry'));
    expect(await screen.findByTestId('notification-n3')).toBeTruthy();
    expect(contract.requestsTo(PAGE_2)).toHaveLength(2);
  });

  it('marks a notification read on open, updates the badge and follows its deep link', async () => {
    const contract = await setup({
      [PAGE_1]: {
        status: 200,
        body: {
          items: [
            notification('n1', {
              link: { screen: 'driver_documents', params: { documentType: 'insurance' } },
            }),
            notification('n2'),
          ],
          unread: 2,
          nextCursor: null,
        },
      },
      'POST /api/v1/notifications/n1/read': { status: 204 },
    });

    fireEvent.press(await screen.findByTestId('notification-n1'));
    expect(getUnread()).toBe(1);

    expect(await screen.findByTestId('documents-route')).toBeTruthy();
    expect(contract.requestsTo('POST /api/v1/notifications/n1/read')).toHaveLength(1);
  });

  it('opening a link-less notification only marks it read (stays in the center)', async () => {
    const contract = await setup({
      [PAGE_1]: {
        status: 200,
        body: { items: [notification('n1')], unread: 1, nextCursor: null },
      },
      'POST /api/v1/notifications/n1/read': { status: 204 },
    });
    fireEvent.press(await screen.findByTestId('notification-n1'));
    await waitFor(() => expect(screen.queryByTestId('notification-n1-unread')).toBeNull());
    expect(contract.requestsTo('POST /api/v1/notifications/n1/read')).toHaveLength(1);
    expect(screen.getByTestId('notification-center')).toBeTruthy();
  });

  it('rolls the read state back when marking read fails', async () => {
    await setup({
      [PAGE_1]: {
        status: 200,
        body: { items: [notification('n1')], unread: 1, nextCursor: null },
      },
      'POST /api/v1/notifications/n1/read': { status: 500, body: { status: 500 } },
    });
    fireEvent.press(await screen.findByTestId('notification-n1'));
    expect(await screen.findByTestId('notifications-action-error')).toBeTruthy();
    expect(screen.getByTestId('notification-n1-unread')).toBeTruthy();
  });

  it('marks everything read (read-all) and clears the badge', async () => {
    const contract = await setup({
      [PAGE_1]: {
        status: 200,
        body: {
          items: [notification('n1'), notification('n2')],
          unread: 2,
          nextCursor: null,
        },
      },
      [READ_ALL]: { status: 204 },
    });
    await screen.findByTestId('notification-n1-unread');
    fireEvent.press(screen.getByTestId('notifications-read-all'));
    // renderRouter runs on fake timers: flush the request's promise chain.
    await act(async () => {});
    expect(screen.queryByTestId('notification-n1-unread')).toBeNull();
    expect(screen.queryByTestId('notification-n2-unread')).toBeNull();
    expect(contract.requestsTo(READ_ALL)).toHaveLength(1);
    expect(getUnread()).toBe(0);
    // Nothing left unread: the action is disabled.
    fireEvent.press(screen.getByTestId('notifications-read-all'));
    expect(contract.requestsTo(READ_ALL)).toHaveLength(1);
  });

  it('filters by category and shows the filtered empty state', async () => {
    const contract = await setup({
      [PAGE_1]: {
        status: 200,
        body: { items: [notification('n1')], unread: 1, nextCursor: null },
      },
      [ACCOUNT_ONLY]: { status: 200, body: { items: [], unread: 1, nextCursor: null } },
    });
    await screen.findByTestId('notification-n1');
    fireEvent.press(screen.getByTestId('notifications-filter-account'));
    expect(await screen.findByTestId('notifications-empty')).toHaveTextContent(
      'Nothing in this category',
      { exact: false },
    );
    expect(contract.requestsTo(ACCOUNT_ONLY)).toHaveLength(1);
  });

  it('distinguishes network and server failures on the first page', async () => {
    await seedSession(driverUser());
    let attempt = 0;
    globalThis.fetch = jest.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('Network request failed');
      return { ok: false, status: 503, text: async () => '{"status":503}' };
    }) as unknown as typeof fetch;
    renderApp('/notifications');
    expect(await screen.findByTestId('failure-network')).toBeTruthy();
    fireEvent.press(screen.getByTestId('failure-retry'));
    expect(await screen.findByTestId('failure-server')).toBeTruthy();
  });

  it('renders the center in Arabic', async () => {
    await setAppLanguage('ar');
    await setup({
      [PAGE_1]: { status: 200, body: { items: [], unread: 0, nextCursor: null } },
    });
    expect(await screen.findByTestId('notifications-empty')).toHaveTextContent(
      'لا توجد إشعارات بعد',
      { exact: false },
    );
    expect(screen.getByTestId('notifications-filter-safety')).toHaveTextContent('السلامة');
  });
});

describe('notification preferences (UC-S-12)', () => {
  const prefs: NotificationPreference[] = [
    { category: 'safety', enabled: true, locked: true },
    { category: 'ride', enabled: true, locked: true },
    { category: 'chat', enabled: true, locked: false },
    { category: 'scheduled', enabled: true, locked: false },
    { category: 'promotions', enabled: true, locked: false },
    { category: 'account', enabled: true, locked: false },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage('en');
  });

  it('shows ride and safety locked on, and saves a toggle as a partial PUT', async () => {
    const contract = await setup(
      {
        [PREFS]: { status: 200, body: prefs },
        [PUT_PREFS]: {
          status: 200,
          body: prefs.map((p) => (p.category === 'promotions' ? { ...p, enabled: false } : p)),
        },
      },
      '/notification-preferences',
    );

    expect(await screen.findByTestId('pref-ride-locked')).toHaveTextContent('Always on', {
      exact: false,
    });
    expect(screen.getByTestId('pref-safety-locked')).toBeTruthy();
    expect(screen.queryByTestId('pref-promotions-locked')).toBeNull();
    expect(screen.getByTestId('pref-ride-switch')).toBeDisabled();
    expect(screen.getByTestId('pref-safety-switch')).toBeDisabled();
    expect(screen.getByTestId('pref-ride-switch')).toHaveProp('value', true);

    fireEvent(screen.getByTestId('pref-promotions-switch'), 'valueChange', false);

    await waitFor(() =>
      expect(screen.getByTestId('pref-promotions-switch')).toHaveProp('value', false),
    );
    expect(contract.requestsTo(PUT_PREFS)).toHaveLength(1);
    expect(contract.requestsTo(PUT_PREFS)[0].body).toEqual([
      { category: 'promotions', enabled: false },
    ]);
  });

  it('keeps the previous state and explains when saving fails', async () => {
    await setup(
      {
        [PREFS]: { status: 200, body: prefs },
        [PUT_PREFS]: { status: 400, body: { status: 400 } },
      },
      '/notification-preferences',
    );
    fireEvent(await screen.findByTestId('pref-chat-switch'), 'valueChange', false);
    expect(await screen.findByTestId('prefs-error')).toBeTruthy();
    expect(screen.getByTestId('pref-chat-switch')).toHaveProp('value', true);
  });
});

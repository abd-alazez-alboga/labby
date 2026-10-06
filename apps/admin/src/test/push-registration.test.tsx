import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeConfig } from '../config/runtime-config';
import i18n from '../i18n/i18n';
import type { WebPushClient, WebPushMessage } from '../push/web-push';
import {
  emptyResponse,
  jsonResponse,
  renderShell,
  seedStoredSession,
  stubFetchRoutes,
  TEST_CONFIG,
  TEST_USER,
} from './test-utils';

/**
 * The Firebase seam is mocked: `seam.loaded` proves whether the module
 * (and with it the Firebase SDK) was ever imported at all.
 */
const seam = vi.hoisted(() => ({ loaded: false, create: vi.fn() }));
vi.mock('../push/firebase-web-push', () => {
  seam.loaded = true;
  return { createFirebaseWebPush: seam.create };
});

const PUSH_CONFIG: RuntimeConfig = {
  ...TEST_CONFIG,
  firebaseWeb: {
    apiKey: 'test-api-key',
    projectId: 'labby-test',
    messagingSenderId: '1234567890',
    appId: '1:1234567890:web:abcdef',
    vapidKey: 'test-vapid-key',
  },
};

function stubNotificationApi(
  permission: NotificationPermission,
  onRequest?: NotificationPermission,
) {
  const api = {
    permission,
    requestPermission: vi.fn(async () => {
      api.permission = onRequest ?? permission;
      return api.permission;
    }),
  };
  vi.stubGlobal('Notification', api);
  return api;
}

/** A fake FCM client whose foreground listener the test can drive. */
function fakeClient(token = 'fcm-token-1') {
  const listeners = new Set<(message: WebPushMessage) => void>();
  const client: WebPushClient = {
    getToken: vi.fn(async () => token),
    onMessage: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return {
    client,
    emit: (message: WebPushMessage) => listeners.forEach((listener) => listener(message)),
  };
}

function stubApi(unread = { value: 0 }) {
  return stubFetchRoutes((method, path) => {
    if (method === 'GET' && path === '/api/v1/users/me') return jsonResponse(200, TEST_USER);
    if (method === 'GET' && path === '/api/v1/notifications/unread-count') {
      return jsonResponse(200, { unread: unread.value });
    }
    if (method === 'GET' && path === '/api/v1/notifications/preferences') {
      return jsonResponse(200, []);
    }
    if (method === 'GET' && path === '/api/v1/notifications') {
      return jsonResponse(200, { items: [], unread: unread.value, nextCursor: null });
    }
    if (method === 'PUT' && path === '/api/v1/devices') return emptyResponse(204);
    if (method === 'DELETE' && path.startsWith('/api/v1/devices/')) return emptyResponse(204);
    if (method === 'POST' && path === '/api/v1/auth/logout') return emptyResponse(204);
    return null;
  });
}

function deviceCalls(fetchMock: ReturnType<typeof stubFetchRoutes>) {
  return fetchMock.mock.calls
    .map(([input, init], index) => ({ index, url: String(input), init }))
    .filter(({ url }) => url.includes('/api/v1/devices'));
}

describe('web push registration (ES-03, UC-S-25)', () => {
  beforeAll(async () => {
    await import('../pages/NotificationPreferencesPage');
    await import('../pages/NotificationsPage');
    await import('../pages/DashboardPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    seedStoredSession();
    seam.create.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Runs first: nothing in this file has imported the seam yet.
  it('skips registration silently when the Firebase web config is absent', async () => {
    stubNotificationApi('granted');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    window.history.pushState({}, '', '/notifications/preferences');
    const fetchMock = stubApi();
    renderShell(TEST_CONFIG);

    expect(await screen.findByRole('heading', { name: 'Notification preferences' })).toBeVisible();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(seam.loaded).toBe(false); // the Firebase SDK module was never even imported
    expect(seam.create).not.toHaveBeenCalled();
    expect(deviceCalls(fetchMock)).toHaveLength(0);
    // No browser-push UI at all, and nothing logged.
    expect(screen.queryByRole('heading', { name: 'Browser notifications' })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('registers the token with the contract body when configured and permitted', async () => {
    stubNotificationApi('granted');
    const { client } = fakeClient();
    seam.create.mockResolvedValue(client);
    window.history.pushState({}, '', '/notifications/preferences');
    const fetchMock = stubApi();
    renderShell(PUSH_CONFIG);

    await waitFor(() => expect(deviceCalls(fetchMock)).toHaveLength(1));
    const [put] = deviceCalls(fetchMock);
    expect(put.url).toBe('http://api.test.local/api/v1/devices');
    expect(put.init?.method).toBe('PUT');
    expect(JSON.parse(put.init?.body as string)).toEqual({
      token: 'fcm-token-1',
      platform: 'web',
      app: 'admin',
    });
    expect((put.init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer access-token-1',
    );
    expect(seam.create).toHaveBeenCalledWith(PUSH_CONFIG.firebaseWeb);
    expect(
      await screen.findByText('Browser notifications are on for this browser.'),
    ).toBeInTheDocument();
  });

  it('surfaces a foreground push as a toast, refreshes the badge, and marks read on open', async () => {
    stubNotificationApi('granted');
    const { client, emit } = fakeClient();
    seam.create.mockResolvedValue(client);
    window.history.pushState({}, '', '/');
    const unread = { value: 0 };
    const fetchMock = stubApi(unread);
    const user = userEvent.setup();
    renderShell(PUSH_CONFIG);

    await waitFor(() => expect(client.onMessage).toHaveBeenCalled());
    unread.value = 1;
    // The contract's payload: localized title/body + the data map.
    act(() =>
      emit({
        title: 'Document expired',
        body: 'A driver document expired.',
        data: {
          notificationId: 'n-77',
          category: 'account',
          event: 'driver.document_expired',
          screen: 'driver_documents',
          params: '{"documentType":"insurance"}',
        },
      }),
    );

    const toast = (await screen.findByText('Document expired')).closest('.toast') as HTMLElement;
    expect(toast).toHaveClass('toast--info');
    expect(within(toast).getByText('A driver document expired.')).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: 'Notifications, 1 unread' }),
    ).toBeInTheDocument();

    await user.click(within(toast).getByRole('button', { name: 'Open' }));
    // driver_documents has no admin screen → the center (contract rule).
    expect(window.location.pathname).toBe('/notifications');
    expect(screen.queryByText('Document expired')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith('/api/v1/notifications/n-77/read') && init?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('turns a safety push into a sticky critical alert', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNotificationApi('granted');
    const { client, emit } = fakeClient();
    seam.create.mockResolvedValue(client);
    window.history.pushState({}, '', '/');
    stubApi();
    renderShell(PUSH_CONFIG);

    await waitFor(() => expect(client.onMessage).toHaveBeenCalled());
    act(() =>
      emit({
        title: 'SOS raised',
        body: 'A rider triggered SOS.',
        data: { notificationId: 'n-sos', category: 'safety', event: 'sos.raised' },
      }),
    );

    const alert = (await screen.findByText('SOS raised')).closest('.toast') as HTMLElement;
    expect(alert).toHaveClass('toast--critical');
    expect(alert.closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(screen.getByText('SOS raised')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
  });

  it('unregisters the token on logout, before the session is revoked', async () => {
    stubNotificationApi('granted');
    const { client } = fakeClient('fcm-token-9');
    seam.create.mockResolvedValue(client);
    window.history.pushState({}, '', '/');
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderShell(PUSH_CONFIG);

    await waitFor(() => expect(deviceCalls(fetchMock)).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    const calls = deviceCalls(fetchMock);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe('http://api.test.local/api/v1/devices/fcm-token-9');
    expect(calls[1].init?.method).toBe('DELETE');
    const logoutIndex = fetchMock.mock.calls.findIndex(([input]) =>
      String(input).endsWith('/api/v1/auth/logout'),
    );
    expect(calls[1].index).toBeLessThan(logoutIndex);
  });

  it('never prompts on load: the admin opts in from the preferences page', async () => {
    const notificationApi = stubNotificationApi('default', 'granted');
    const { client } = fakeClient();
    seam.create.mockResolvedValue(client);
    window.history.pushState({}, '', '/notifications/preferences');
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderShell(PUSH_CONFIG);

    const enable = await screen.findByRole('button', { name: 'Enable browser notifications' });
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();
    expect(seam.create).not.toHaveBeenCalled();
    expect(deviceCalls(fetchMock)).toHaveLength(0);

    await user.click(enable);
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(deviceCalls(fetchMock)).toHaveLength(1));
    expect(
      await screen.findByText('Browser notifications are on for this browser.'),
    ).toBeInTheDocument();
  });

  it('respects a denied permission and registers nothing', async () => {
    stubNotificationApi('denied');
    window.history.pushState({}, '', '/notifications/preferences');
    const fetchMock = stubApi();
    renderShell(PUSH_CONFIG);

    expect(
      await screen.findByText(
        "Notifications are blocked for this site. Allow them in your browser's site settings to receive alerts.",
      ),
    ).toBeInTheDocument();
    expect(seam.create).not.toHaveBeenCalled();
    expect(deviceCalls(fetchMock)).toHaveLength(0);
  });

  it('reports an unsupported browser without registering', async () => {
    stubNotificationApi('granted');
    seam.create.mockResolvedValue(null);
    window.history.pushState({}, '', '/notifications/preferences');
    const fetchMock = stubApi();
    renderShell(PUSH_CONFIG);

    expect(
      await screen.findByText(
        "This browser doesn't support push notifications. Your notification center still works.",
      ),
    ).toBeInTheDocument();
    expect(deviceCalls(fetchMock)).toHaveLength(0);
  });

  it('shows a failed registration with a retry', async () => {
    stubNotificationApi('granted');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = fakeClient();
    seam.create.mockRejectedValueOnce(new Error('messaging/token-subscribe-failed'));
    seam.create.mockResolvedValue(client);
    window.history.pushState({}, '', '/notifications/preferences');
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderShell(PUSH_CONFIG);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(deviceCalls(fetchMock)).toHaveLength(1));
    expect(
      await screen.findByText('Browser notifications are on for this browser.'),
    ).toBeInTheDocument();
  });
});

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppNotification } from '../api/notifications';
import i18n from '../i18n/i18n';
import { UNREAD_POLL_MS } from '../notifications/NotificationsProvider';
import {
  emptyResponse,
  jsonResponse,
  renderShell,
  seedStoredSession,
  stubFetchRoutes,
  TEST_USER,
  type FetchRouteHandler,
} from './test-utils';

function notification(id: string, extra: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    category: 'account',
    event: 'admin.test',
    title: `Title ${id}`,
    body: `Body ${id}`,
    link: null,
    read: false,
    createdAt: '2026-10-06T09:00:00Z',
    ...extra,
  };
}

const PAGE_ONE = [
  notification('n1', {
    category: 'safety',
    title: 'Safety alert',
    link: { screen: 'notifications' },
  }),
  notification('n2', { read: true, title: 'Old account notice' }),
];
const PAGE_TWO = [notification('n3', { title: 'Oldest notice', read: true })];

interface CenterState {
  unread: number;
}

/**
 * The realtime-v1 center endpoints, mocked: two pages (cursor `c1`),
 * per-category filtering, read and read-all moving the unread count.
 */
function stubCenter(state: CenterState, extra?: FetchRouteHandler) {
  return stubFetchRoutes((method, path, init, url) => {
    const override = extra?.(method, path, init, url);
    if (override) return override;
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, TEST_USER);
    }
    if (method === 'GET' && path === '/api/v1/notifications/unread-count') {
      return jsonResponse(200, { unread: state.unread });
    }
    if (method === 'GET' && path === '/api/v1/notifications') {
      const category = url?.searchParams.get('category');
      if (category) {
        const items = [...PAGE_ONE, ...PAGE_TWO].filter((item) => item.category === category);
        return jsonResponse(200, { items, unread: state.unread, nextCursor: null });
      }
      if (url?.searchParams.get('before') === 'c1') {
        return jsonResponse(200, { items: PAGE_TWO, unread: state.unread, nextCursor: null });
      }
      return jsonResponse(200, { items: PAGE_ONE, unread: state.unread, nextCursor: 'c1' });
    }
    if (method === 'POST' && path === '/api/v1/notifications/n1/read') {
      state.unread = Math.max(0, state.unread - 1);
      return emptyResponse(204);
    }
    if (method === 'POST' && path === '/api/v1/notifications/read-all') {
      state.unread = 0;
      return emptyResponse(204);
    }
    return null;
  });
}

function centerRequests(fetchMock: ReturnType<typeof stubFetchRoutes>): URL[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === '/api/v1/notifications');
}

describe('notification center (UC-S-11, NTF-03)', () => {
  beforeAll(async () => {
    await import('../pages/NotificationsPage');
    await import('../pages/DashboardPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    seedStoredSession();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the unread badge in the top bar on any page and links to the center', async () => {
    window.history.pushState({}, '', '/');
    const fetchMock = stubCenter({ unread: 3 });
    const user = userEvent.setup();
    renderShell();

    const bell = await screen.findByRole('link', { name: 'Notifications, 3 unread' });
    expect(within(bell).getByText('3')).toBeInTheDocument();
    const countCall = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((url) => url.pathname === '/api/v1/notifications/unread-count');
    expect(countCall?.searchParams.get('app')).toBe('admin');

    await user.click(bell);
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/notifications');
  });

  it('caps the badge text at 99+', async () => {
    window.history.pushState({}, '', '/');
    stubCenter({ unread: 120 });
    renderShell();

    const bell = await screen.findByRole('link', { name: 'Notifications, 120 unread' });
    expect(within(bell).getByText('99+')).toBeInTheDocument();
  });

  it('lists the newest page first and pages on with the cursor', async () => {
    window.history.pushState({}, '', '/notifications');
    const fetchMock = stubCenter({ unread: 1 });
    const user = userEvent.setup();
    renderShell();

    const first = await screen.findByRole('button', { name: /Safety alert/ });
    expect(first).toHaveClass('notification--unread');
    expect(within(first).getByText('Unread')).toBeInTheDocument();
    expect(within(first).getByText('Safety')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Old account notice/ })).not.toHaveClass(
      'notification--unread',
    );
    expect(screen.getByText('1 unread')).toBeInTheDocument();
    const [firstRequest] = centerRequests(fetchMock);
    expect(firstRequest.searchParams.get('app')).toBe('admin');
    expect(firstRequest.searchParams.get('size')).toBe('20');
    expect(firstRequest.searchParams.has('before')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('button', { name: /Oldest notice/ })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(centerRequests(fetchMock)[1].searchParams.get('before')).toBe('c1');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.getByText("You've reached the end of your notifications.")).toBeInTheDocument();
  });

  it('filters by category and explains an empty category', async () => {
    window.history.pushState({}, '', '/notifications');
    const fetchMock = stubCenter({ unread: 1 });
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('button', { name: /Safety alert/ });
    const filters = screen.getByRole('group', { name: 'Filter by category' });
    expect(within(filters).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(filters).getByRole('button', { name: 'Safety' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Old account notice/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Safety alert/ })).toBeInTheDocument();
    expect(centerRequests(fetchMock).at(-1)?.searchParams.get('category')).toBe('safety');

    await user.click(within(filters).getByRole('button', { name: 'Promotions' }));
    expect(await screen.findByText('No notifications in “Promotions”.')).toBeInTheDocument();
  });

  it('marks an item read when opened and refreshes the badge', async () => {
    window.history.pushState({}, '', '/notifications');
    const state = { unread: 1 };
    const fetchMock = stubCenter(state);
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    await user.click(await screen.findByRole('button', { name: /Safety alert/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Safety alert/ })).not.toHaveClass(
        'notification--unread',
      ),
    );
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith('/api/v1/notifications/n1/read') && init?.method === 'POST',
      ),
    ).toBe(true);
    // Badge drops to zero → plain label, no count.
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    // The link maps to the center itself, so we stay here.
    expect(window.location.pathname).toBe('/notifications');

    // Opening an already-read item sends nothing.
    const before = fetchMock.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /Old account notice/ }));
    expect(
      fetchMock.mock.calls.slice(before).some(([input]) => String(input).includes('/read')),
    ).toBe(false);
  });

  it('keeps the item unread and says so when marking read fails', async () => {
    window.history.pushState({}, '', '/notifications');
    stubCenter({ unread: 1 }, (method, path) =>
      method === 'POST' && path === '/api/v1/notifications/n1/read'
        ? jsonResponse(500, { status: 500, message: 'boom' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: /Safety alert/ }));
    expect(
      await screen.findByText("Couldn't mark the notification as read. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Safety alert/ })).toHaveClass(
      'notification--unread',
    );
  });

  it('marks everything read with read-all and confirms with a toast', async () => {
    window.history.pushState({}, '', '/notifications');
    const fetchMock = stubCenter({ unread: 1 });
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    expect(await screen.findByText('All notifications are marked as read.')).toBeInTheDocument();
    const readAll = fetchMock.mock.calls
      .map(([input, init]) => ({ url: new URL(String(input)), init }))
      .find(({ url }) => url.pathname === '/api/v1/notifications/read-all');
    expect(readAll?.init?.method).toBe('POST');
    expect(readAll?.url.searchParams.get('app')).toBe('admin');
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Safety alert/ })).not.toHaveClass(
      'notification--unread',
    );
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('shows an empty center plainly', async () => {
    window.history.pushState({}, '', '/notifications');
    stubCenter({ unread: 0 }, (method, path) =>
      method === 'GET' && path === '/api/v1/notifications'
        ? jsonResponse(200, { items: [], unread: 0, nextCursor: null })
        : null,
    );
    renderShell();

    expect(await screen.findByText('You have no notifications yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('tells a network failure apart and retries', async () => {
    window.history.pushState({}, '', '/notifications');
    let fail = true;
    stubCenter({ unread: 0 }, (method, path) => {
      if (method === 'GET' && path === '/api/v1/notifications' && fail) {
        throw new TypeError('Failed to fetch');
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Safety alert/ })).toBeInTheDocument();
  });

  it('keeps the badge fresh without push: on focus and on the polling interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.history.pushState({}, '', '/');
    const state = { unread: 1 };
    stubCenter(state);
    renderShell();

    await screen.findByRole('link', { name: 'Notifications, 1 unread' });

    state.unread = 2;
    act(() => {
      fireEvent.focus(window);
    });
    expect(
      await screen.findByRole('link', { name: 'Notifications, 2 unread' }),
    ).toBeInTheDocument();

    state.unread = 5;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNREAD_POLL_MS);
    });
    expect(
      await screen.findByRole('link', { name: 'Notifications, 5 unread' }),
    ).toBeInTheDocument();
  });

  it('offers to show notifications that arrive while the center is open', async () => {
    window.history.pushState({}, '', '/notifications');
    const state = { unread: 1 };
    const fetchMock = stubCenter(state);
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('button', { name: /Safety alert/ });
    await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    expect(screen.queryByRole('button', { name: /New notifications arrived/ })).toBeNull();

    state.unread = 2; // something new landed server-side
    act(() => {
      fireEvent.focus(window);
    });
    const showNew = await screen.findByRole('button', {
      name: 'New notifications arrived — show them',
    });
    const before = centerRequests(fetchMock).length;
    await user.click(showNew);
    await waitFor(() => expect(centerRequests(fetchMock).length).toBe(before + 1));
    expect(centerRequests(fetchMock).at(-1)?.searchParams.has('before')).toBe(false);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /New notifications arrived/ })).toBeNull(),
    );
  });

  it('keeps the last badge value when a poll fails', async () => {
    window.history.pushState({}, '', '/');
    let down = false;
    stubCenter({ unread: 4 }, (_method, path) => {
      if (down && path === '/api/v1/notifications/unread-count') {
        throw new TypeError('Failed to fetch');
      }
      return null;
    });
    renderShell();

    await screen.findByRole('link', { name: 'Notifications, 4 unread' });
    down = true;
    act(() => {
      fireEvent.focus(window);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('link', { name: 'Notifications, 4 unread' })).toBeInTheDocument();
  });

  it('renders the center in Arabic', async () => {
    await i18n.changeLanguage('ar');
    window.history.pushState({}, '', '/notifications');
    stubCenter({ unread: 1 });
    renderShell();

    expect(await screen.findByRole('heading', { name: 'الإشعارات' })).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: 'الإشعارات، 1 غير مقروءة' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تعليم الكل كمقروء' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    await act(() => i18n.changeLanguage('en'));
  });
});

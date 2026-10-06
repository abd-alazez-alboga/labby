import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationPreference } from '../api/notifications';
import i18n from '../i18n/i18n';
import {
  jsonResponse,
  renderShell,
  seedStoredSession,
  stubFetchRoutes,
  TEST_USER,
  type FetchRouteHandler,
} from './test-utils';

/** Server order deliberately scrambled — the page shows the canonical order. */
const PREFS: NotificationPreference[] = [
  { category: 'promotions', enabled: true, locked: false },
  { category: 'safety', enabled: true, locked: true },
  { category: 'ride', enabled: true, locked: true },
  { category: 'chat', enabled: true, locked: false },
  { category: 'scheduled', enabled: false, locked: false },
  { category: 'account', enabled: true, locked: false },
];

const PREFS_PATH = '/api/v1/notifications/preferences';

function stubPrefs(extra?: FetchRouteHandler) {
  return stubFetchRoutes((method, path, init, url) => {
    const override = extra?.(method, path, init, url);
    if (override) return override;
    if (method === 'GET' && path === '/api/v1/users/me') return jsonResponse(200, TEST_USER);
    if (method === 'GET' && path === '/api/v1/notifications/unread-count') {
      return jsonResponse(200, { unread: 0 });
    }
    if (method === 'GET' && path === PREFS_PATH) return jsonResponse(200, PREFS);
    if (method === 'PUT' && path === PREFS_PATH) {
      const changes = JSON.parse(init?.body as string) as { category: string; enabled: boolean }[];
      return jsonResponse(
        200,
        PREFS.map((pref) => {
          const change = changes.find((c) => c.category === pref.category);
          return change ? { ...pref, enabled: change.enabled } : pref;
        }),
      );
    }
    return null;
  });
}

function putBodies(fetchMock: ReturnType<typeof stubFetchRoutes>): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input).endsWith(PREFS_PATH) && init?.method === 'PUT')
    .map(([, init]) => JSON.parse(init?.body as string));
}

describe('notification preferences (UC-S-12, NTF-02)', () => {
  beforeAll(async () => {
    await import('../pages/NotificationPreferencesPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    seedStoredSession();
    window.history.pushState({}, '', '/notifications/preferences');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows ride and safety locked always-on, in canonical order', async () => {
    stubPrefs();
    renderShell();

    const ride = await screen.findByRole('checkbox', { name: 'Rides' });
    expect(ride).toBeChecked();
    expect(ride).toBeDisabled();
    expect(ride).toHaveAccessibleDescription(
      'Ride and safety notifications are always delivered and cannot be turned off.',
    );
    const safety = screen.getByRole('checkbox', { name: 'Safety' });
    expect(safety).toBeChecked();
    expect(safety).toBeDisabled();
    expect(screen.getAllByText('Always on')).toHaveLength(2);

    expect(screen.getByRole('checkbox', { name: 'Promotions' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Scheduled rides' })).not.toBeChecked();
    expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('id'))).toEqual([
      'pref-ride',
      'pref-chat',
      'pref-scheduled',
      'pref-promotions',
      'pref-account',
      'pref-safety',
    ]);
    // Muting is push-only: the page says the center keeps recording.
    expect(
      screen.getByText(
        'Turning a category off stops its push notifications only — they still appear in your notification center.',
      ),
    ).toBeInTheDocument();
    // Nothing changed yet.
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
  });

  it('PUTs only the changed, unlocked categories and confirms with a toast', async () => {
    const fetchMock = stubPrefs();
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('checkbox', { name: 'Promotions' }));
    await user.click(screen.getByRole('checkbox', { name: 'Scheduled rides' }));
    // Toggling chat twice is no change at all.
    await user.click(screen.getByRole('checkbox', { name: 'Chat' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chat' }));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Notification preferences saved.')).toBeInTheDocument();
    expect(putBodies(fetchMock)).toEqual([
      [
        { category: 'scheduled', enabled: true },
        { category: 'promotions', enabled: false },
      ],
    ]);
    expect(screen.getByRole('checkbox', { name: 'Promotions' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
  });

  it('discards unsaved changes', async () => {
    stubPrefs();
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('checkbox', { name: 'Account & system' }));
    expect(screen.getByRole('checkbox', { name: 'Account & system' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('checkbox', { name: 'Account & system' })).toBeChecked();
  });

  it('explains a 400 (locked category refused) without losing the draft', async () => {
    stubPrefs((method, path) =>
      method === 'PUT' && path === PREFS_PATH
        ? jsonResponse(400, { status: 400, message: 'locked' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('checkbox', { name: 'Promotions' }));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(
      await screen.findByText(
        "The change was rejected — ride and safety notifications can't be turned off.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Promotions' })).not.toBeChecked();
  });

  it('shows a load failure with retry', async () => {
    let fail = true;
    stubPrefs((method, path) =>
      fail && method === 'GET' && path === PREFS_PATH
        ? jsonResponse(500, { status: 500, message: 'boom' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const banner = await screen.findByRole('alert');
    expect(
      within(banner).getByText('The server ran into a problem. Try again in a moment.'),
    ).toBeInTheDocument();
    fail = false;
    await user.click(within(banner).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('checkbox', { name: 'Rides' })).toBeInTheDocument();
  });

  it('renders in Arabic with the locked label', async () => {
    await act(() => i18n.changeLanguage('ar'));
    stubPrefs();
    renderShell();

    expect(await screen.findByRole('heading', { name: 'تفضيلات الإشعارات' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('مفعّلة دائماً')).toHaveLength(2));
    expect(screen.getByRole('checkbox', { name: 'السلامة' })).toBeDisabled();
    await act(() => i18n.changeLanguage('en'));
  });
});

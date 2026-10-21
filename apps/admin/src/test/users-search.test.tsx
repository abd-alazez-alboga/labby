import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import { EXPORTER, page, RANA, stubAnalyticsRoutes } from './analytics-fixtures';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

/**
 * V1 audit H8 (UC-A-13, ADM-05; board V1FAdminUsersSearch): the Users page's
 * "Find a user" box searches every account by name or phone over
 * GET /admin/users `q` — a user with no rides is found — with the match
 * count, a no-match state with Clear search, and a pasted ID opening the user.
 */

const RAMI = {
  ...RANA,
  userId: 'uuuuuuuu-0000-4000-8000-000000000009',
  name: 'Rami Haddad',
  phone: '+963933410905',
};
const PROFILE_ID = '3f9a21c0-0000-4000-8000-000000000001';

function usersQueries(fetchMock: ReturnType<typeof stubAnalyticsRoutes>): URL[] {
  return callsTo(fetchMock, '/api/v1/admin/users')
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === '/api/v1/admin/users');
}

function stub() {
  seedStoredSession(sessionFor(EXPORTER));
  return stubAnalyticsRoutes(EXPORTER, (method, path, _init, url) => {
    if (method === 'GET' && path === '/api/v1/admin/users') {
      const q = url?.searchParams.get('q');
      if (q === 'haddad') {
        return jsonResponse(200, page([RAMI]));
      }
      if (q === 'Yousef Kh') {
        return jsonResponse(200, page([]));
      }
    }
    if (method === 'GET' && path === `/api/v1/admin/users/${PROFILE_ID}/trust`) {
      return jsonResponse(200, {
        userId: PROFILE_ID,
        name: 'Rana Khoury',
        accountState: 'active',
        roles: [],
      });
    }
    return null;
  });
}

describe('users search (V1 audit H8)', () => {
  beforeAll(async () => {
    await import('../pages/UsersPage');
    await import('../pages/UserTrustPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/users');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches by name with q, marks the hit and counts the matches', async () => {
    const fetchMock = stub();
    const user = userEvent.setup();
    renderShell();

    const box = await screen.findByRole('textbox', { name: 'Search users by name or phone' });
    expect(screen.getByRole('search')).toHaveTextContent('Find a user');
    expect(box).toHaveAttribute('placeholder', 'Name or phone number');
    expect(
      screen.getByText(
        'Searches every account by name or phone number. A pasted user ID opens that user directly.',
      ),
    ).toBeInTheDocument();
    await user.type(box, 'haddad');

    expect(await screen.findByText(/^1 user matches “haddad”/)).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Haddad').tagName).toBe('MARK');
    expect(rows[0]).toHaveTextContent('+963933410905');
    expect(usersQueries(fetchMock).at(-1)?.searchParams.get('q')).toBe('haddad');
    expect(window.location.search).toContain('q=haddad');
  });

  it('sends a typed phone as q and leaves normalization to the server', async () => {
    const fetchMock = stub();
    const user = userEvent.setup();
    renderShell();

    await user.type(
      await screen.findByRole('textbox', { name: 'Search users by name or phone' }),
      '0944 120 551{Enter}',
    );

    await waitFor(() =>
      expect(usersQueries(fetchMock).at(-1)?.searchParams.get('q')).toBe('0944 120 551'),
    );
    // The ride history is never consulted.
    expect(callsTo(fetchMock, '/api/v1/admin/rides')).toHaveLength(0);
  });

  it('shows the no-match state and clears the search', async () => {
    const fetchMock = stub();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/users?q=Yousef+Kh');
    renderShell();

    expect(await screen.findByText('No users match “Yousef Kh”')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Check the spelling or search by phone number. Search covers every account, including people who have never taken a ride.',
      ),
    ).toBeInTheDocument();

    // The empty state's own Clear search (the box also has its clear icon).
    const empty = screen.getByText('No users match “Yousef Kh”').closest('.search-empty')!;
    await user.click(within(empty as HTMLElement).getByRole('button', { name: 'Clear search' }));

    expect(await screen.findByText('Rana Khoury')).toBeInTheDocument();
    expect(usersQueries(fetchMock).at(-1)?.searchParams.has('q')).toBe(false);
    expect(screen.getByRole('textbox', { name: 'Search users by name or phone' })).toHaveValue('');
  });

  it('opens a pasted user ID directly on Enter', async () => {
    stub();
    const user = userEvent.setup();
    renderShell();

    await user.type(
      await screen.findByRole('textbox', { name: 'Search users by name or phone' }),
      `${PROFILE_ID}{Enter}`,
    );

    await waitFor(() => expect(window.location.pathname).toBe(`/users/${PROFILE_ID}/trust`));
  });

  it('passes the search to Export CSV', async () => {
    const fetchMock = stub();
    window.history.pushState({}, '', '/users?q=haddad');
    renderShell();
    const user = userEvent.setup();

    await screen.findByText(/^1 user matches “haddad”/);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(callsTo(fetchMock, '/api/v1/admin/exports/users')).toHaveLength(1));
    const [call] = callsTo(fetchMock, '/api/v1/admin/exports/users');
    expect(new URL(String(call[0])).searchParams.get('q')).toBe('haddad');
  });

  it('renders the search in Arabic', async () => {
    await i18n.changeLanguage('ar');
    stub();
    window.history.pushState({}, '', '/users?q=haddad');
    renderShell();

    expect(
      await screen.findByRole('textbox', { name: 'ابحث عن المستخدمين بالاسم أو رقم الهاتف' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/^1 مستخدم يطابق «haddad»/)).toBeInTheDocument();
  });
});

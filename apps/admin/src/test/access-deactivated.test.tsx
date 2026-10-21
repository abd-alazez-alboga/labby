import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserProfile } from '../api/auth';
import i18n from '../i18n/i18n';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  stubFetchRoutes,
} from './test-utils';

/**
 * V1 audit W5 / I31 (USR-06, board V1FAdminAccessDeactivated): a signed-in
 * admin whose admin access is deactivated, or whose whole account is
 * suspended, sees the access-deactivated screen in place of the dashboard —
 * note + date and Log out, no sidebar, no "No access" pages.
 */

const ACTIVE = adminUser(['users:view']);

function deactivated(note: string | null, suspendedAt: string | null): UserProfile {
  return {
    ...ACTIVE,
    name: 'Lama Haddad',
    phone: '+963988640112',
    roles: [
      { role: 'rider', state: 'active' },
      {
        ...ACTIVE.roles[0],
        state: 'suspended',
        suspensionReason: note ? 'manual' : null,
        suspensionNote: note,
        suspendedAt,
      },
    ],
  };
}

function stub(user: UserProfile) {
  seedStoredSession(sessionFor(user));
  return stubFetchRoutes((method, path) => {
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'POST' && path === '/api/v1/auth/logout') {
      return new Response(null, { status: 204 });
    }
    return null;
  });
}

describe('access deactivated screen (V1 audit W5 / I31)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/users');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces the dashboard with the note and date, then logs out', async () => {
    const fetchMock = stub(
      deactivated(
        'Support contract ended on 15 Oct. Thank you for your work on the team.',
        '2026-10-16T09:00:00Z',
      ),
    );
    const user = userEvent.setup();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your admin access is deactivated' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Note from the Super Admin · deactivated Oct 16, 2026'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('“Support contract ended on 15 Oct. Thank you for your work on the team.”'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Think this is a mistake? Ask a Super Admin to reactivate your access, then sign in again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('+963988640112')).toBeInTheDocument();
    // No shell: no sidebar navigation, no "No access" page.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('No access')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/v1/auth/logout')).toHaveLength(1);
  });

  it('says no note was recorded when the Super Admin left none', async () => {
    stub(deactivated(null, '2026-10-16T09:00:00Z'));
    renderShell();

    expect(await screen.findByText('No note was recorded.')).toBeInTheDocument();
    expect(
      screen.getByText('Note from the Super Admin · deactivated Oct 16, 2026'),
    ).toBeInTheDocument();
  });

  it('shows the whole-account suspension with its reason', async () => {
    stub({
      ...ACTIVE,
      state: 'suspended',
      suspensionNote: 'Repeated fare disputes.',
      suspendedAt: '2026-10-12T09:00:00Z',
    });
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your Labby account is suspended' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Reason given · suspended Oct 12, 2026')).toBeInTheDocument();
    expect(screen.getByText('“Repeated fare disputes.”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('renders Arabic with Western digits', async () => {
    await i18n.changeLanguage('ar');
    stub({ ...deactivated(null, '2026-10-16T09:00:00Z'), language: 'ar' });
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'تم تعطيل وصولك كمشرف' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/عُطّل في 16/)).toBeInTheDocument();
    expect(screen.getByText('لم تُسجَّل أي ملاحظة.')).toBeInTheDocument();
  });

  it('keeps the dashboard for an active admin', async () => {
    stub(ACTIVE);
    renderShell();

    expect(await screen.findByRole('navigation')).toBeInTheDocument();
    expect(screen.queryByText('Your admin access is deactivated')).toBeNull();
  });
});

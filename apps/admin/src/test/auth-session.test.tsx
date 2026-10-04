import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthTokensResponse } from '../api/auth';
import i18n from '../i18n/i18n';
import {
  callsTo,
  emptyResponse,
  jsonResponse,
  readPersistedSession,
  renderShell,
  seedStoredSession,
  stubFetchRoutes,
  TEST_USER,
} from './test-utils';

describe('session handling', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rotates tokens once on a 401 and keeps the session alive', async () => {
    seedStoredSession(); // access-token-1 / refresh-token-1
    const rotated: AuthTokensResponse = {
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      expiresInSeconds: 900,
      user: { ...TEST_USER, name: 'Rotated Admin' },
    };
    const fetchMock = stubFetchRoutes((method, path, init) => {
      if (method === 'GET' && path === '/api/v1/users/me') {
        const auth = (init?.headers as Record<string, string>).Authorization;
        if (auth === 'Bearer access-token-1') {
          return jsonResponse(401, { status: 401, message: 'Access token expired' });
        }
        if (auth === 'Bearer access-token-2') {
          return jsonResponse(200, { ...TEST_USER, name: 'Rotated Admin' });
        }
      }
      if (method === 'POST' && path === '/api/v1/auth/refresh') {
        return jsonResponse(200, rotated);
      }
      return null;
    });
    renderShell();

    // Still signed in, profile refreshed via the rotated access token.
    expect(await screen.findByText('Rotated Admin')).toBeInTheDocument();
    expect(
      await screen.findByText('The admin dashboard arrives in a later milestone.'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(readPersistedSession()?.accessToken).toBe('access-token-2');
    });
    const refreshCalls = callsTo(fetchMock, '/api/v1/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
    expect(JSON.parse((refreshCalls[0][1] as RequestInit).body as string)).toEqual({
      refreshToken: 'refresh-token-1',
    });
  });

  it('forces logout to /login with the expired message when the refresh fails', async () => {
    seedStoredSession();
    const fetchMock = stubFetchRoutes((method, path) => {
      if (method === 'GET' && path === '/api/v1/users/me') {
        return jsonResponse(401, { status: 401, message: 'Access token expired' });
      }
      if (method === 'POST' && path === '/api/v1/auth/refresh') {
        return jsonResponse(401, { status: 401, message: 'Refresh token revoked' });
      }
      return null;
    });
    renderShell();

    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(readPersistedSession()).toBeNull();
    // Exactly ONE refresh attempt — no retry loops.
    expect(callsTo(fetchMock, '/api/v1/auth/refresh')).toHaveLength(1);
  });

  it('logout revokes the refresh token, clears the session, and lands on login', async () => {
    seedStoredSession();
    const fetchMock = stubFetchRoutes((method, path) => {
      if (method === 'GET' && path === '/api/v1/users/me') {
        return jsonResponse(200, TEST_USER);
      }
      if (method === 'POST' && path === '/api/v1/auth/logout') {
        return emptyResponse(204);
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await screen.findByText('Super Admin');
    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    // A deliberate logout is not an expiry.
    expect(
      screen.queryByText('Your session has expired. Please sign in again.'),
    ).not.toBeInTheDocument();
    expect(readPersistedSession()).toBeNull();

    const [logoutCall] = callsTo(fetchMock, '/api/v1/auth/logout');
    expect(logoutCall).toBeDefined();
    const init = logoutCall[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'refresh-token-1' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token-1');
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthTokensResponse } from '../api/auth';
import i18n from '../i18n/i18n';
import {
  jsonResponse,
  renderShell,
  seedStoredSession,
  stubFetchRoutes,
  TEST_USER,
} from './test-utils';

const TOKENS: AuthTokensResponse = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  expiresInSeconds: 900,
  user: TEST_USER,
};

describe('route guard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects a signed-out deep link to /login and returns there after login', async () => {
    stubFetchRoutes((method, path) =>
      method === 'POST' && path === '/api/v1/auth/login' ? jsonResponse(200, TOKENS) : null,
    );
    window.history.pushState({}, '', '/');
    const user = userEvent.setup();
    renderShell();

    // Guard: anonymous visit to the dashboard lands on the login page.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');

    await user.type(screen.getByLabelText('Phone number'), '+963900000004');
    await user.type(screen.getByLabelText('Password'), 'Password1!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Back at the intended destination.
    expect(
      await screen.findByText(
        'Your role does not include analytics. Use the menu to open the pages you can work on.',
      ),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('redirects a logged-in visit to /login back home', async () => {
    seedStoredSession();
    stubFetchRoutes((method, path) =>
      method === 'GET' && path === '/api/v1/users/me' ? jsonResponse(200, TEST_USER) : null,
    );
    window.history.pushState({}, '', '/login');
    renderShell();

    expect(
      await screen.findByText(
        'Your role does not include analytics. Use the menu to open the pages you can work on.',
      ),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});

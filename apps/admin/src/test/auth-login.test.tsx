import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthTokensResponse } from '../api/auth';
import i18n from '../i18n/i18n';
import {
  callsTo,
  jsonResponse,
  readPersistedSession,
  renderShell,
  stubFetchRoutes,
  TEST_USER,
} from './test-utils';

const TOKENS: AuthTokensResponse = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  expiresInSeconds: 900,
  user: TEST_USER,
};

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Phone number'), '+963900000004');
  await user.type(screen.getByLabelText('Password'), 'Password1!');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('admin login', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/login');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in per the contract and lands on the dashboard with the admin name', async () => {
    const fetchMock = stubFetchRoutes((method, path) => {
      if (method === 'POST' && path === '/api/v1/auth/login') {
        return jsonResponse(200, TOKENS);
      }
      if (method === 'GET' && path === '/api/v1/meta') {
        return jsonResponse(200, { name: 'labby-backend', version: '0.1.0' });
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await fillAndSubmit(user);

    expect(
      await screen.findByText('The admin dashboard arrives in a later milestone.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Super Admin')).toBeInTheDocument();

    const [loginCall] = callsTo(fetchMock, '/api/v1/auth/login');
    expect(loginCall).toBeDefined();
    expect(JSON.parse((loginCall[1] as RequestInit).body as string)).toEqual({
      phone: '+963900000004',
      password: 'Password1!',
      client: 'admin',
    });
    expect(readPersistedSession()?.accessToken).toBe('access-token-1');
  });

  it('shows a generic bad-credentials message on 401', async () => {
    stubFetchRoutes((method, path) =>
      method === 'POST' && path === '/api/v1/auth/login'
        ? jsonResponse(401, { status: 401, message: 'Bad credentials' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect phone number or password.',
    );
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(readPersistedSession()).toBeNull();
  });

  it('shows the not-an-admin message on 403 (role check for client=admin)', async () => {
    stubFetchRoutes((method, path) =>
      method === 'POST' && path === '/api/v1/auth/login'
        ? jsonResponse(403, { status: 403, message: 'No admin role' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('This is not an admin account.');
    expect(readPersistedSession()).toBeNull();
  });

  it('shows the throttle message on 429', async () => {
    stubFetchRoutes((method, path) =>
      method === 'POST' && path === '/api/v1/auth/login'
        ? jsonResponse(429, { status: 429, message: 'Too many attempts' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts — please wait and try again.',
    );
  });

  it('disables the form while the login request is in flight', async () => {
    let resolveLogin!: (response: Response) => void;
    stubFetchRoutes((method, path) => {
      if (method === 'POST' && path === '/api/v1/auth/login') {
        return new Promise<Response>((resolve) => {
          resolveLogin = resolve;
        });
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await fillAndSubmit(user);

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(screen.getByLabelText('Phone number')).toBeDisabled();

    resolveLogin(jsonResponse(200, TOKENS));
    expect(
      await screen.findByText('The admin dashboard arrives in a later milestone.'),
    ).toBeInTheDocument();
  });

  it('renders the login form in Arabic with RTL', async () => {
    stubFetchRoutes(() => null);
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('heading', { name: 'Sign in' });
    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument();
    expect(screen.getByLabelText('رقم الهاتف')).toBeInTheDocument();
    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
  });
});

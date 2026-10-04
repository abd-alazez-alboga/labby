/**
 * API-layer auth behavior per the M2 contract:
 * - Bearer attachment on auth'd requests
 * - exactly one refresh on 401, with token rotation and a retried request
 * - sign-out signal (sessionExpired) when the refresh fails
 */
import {
  addSessionExpiredListener,
  getStoredTokens,
  saveTokens,
} from '../../auth/session-store';
import { mockApi, sampleUser } from '../../test-utils/mock-api';
import { apiFetch, ApiError } from '../http-client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require('expo-secure-store') as { __reset: () => void };

describe('apiFetch auth handling', () => {
  beforeEach(() => {
    secureStoreMock.__reset();
  });

  it('attaches the stored access token as a Bearer header', async () => {
    await saveTokens({ accessToken: 'access-0', refreshToken: 'refresh-0' });
    const api = mockApi({
      'GET /api/v1/users/me': { status: 200, body: sampleUser },
    });

    const profile = await apiFetch('/api/v1/users/me', { auth: true });

    expect(profile).toEqual(sampleUser);
    expect(api.calls[0].headers.Authorization).toBe('Bearer access-0');
  });

  it('refreshes once on 401, rotates the stored pair, and retries the request', async () => {
    await saveTokens({ accessToken: 'stale-access', refreshToken: 'old-refresh' });
    const api = mockApi({
      'GET /api/v1/users/me': [
        { status: 401, body: { status: 401, message: 'expired' } },
        { status: 200, body: sampleUser },
      ],
      'POST /api/v1/auth/refresh': {
        status: 200,
        body: {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          expiresInSeconds: 900,
          user: sampleUser,
        },
      },
    });

    const profile = await apiFetch('/api/v1/users/me', { auth: true });

    expect(profile).toEqual(sampleUser);
    // Original call → refresh (with the OLD refresh token) → retried call.
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/v1/users/me',
      'POST /api/v1/auth/refresh',
      'GET /api/v1/users/me',
    ]);
    expect(api.calls[1].body).toEqual({ refreshToken: 'old-refresh' });
    expect(api.calls[2].headers.Authorization).toBe('Bearer new-access');
    // The stored pair rotated.
    expect(await getStoredTokens()).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });

  it('clears tokens and emits sessionExpired when the refresh is rejected', async () => {
    await saveTokens({ accessToken: 'stale-access', refreshToken: 'revoked-refresh' });
    const expired = jest.fn();
    const unsubscribe = addSessionExpiredListener(expired);
    const api = mockApi({
      'GET /api/v1/users/me': { status: 401, body: { status: 401, message: 'expired' } },
      'POST /api/v1/auth/refresh': { status: 401, body: { status: 401, message: 'revoked' } },
    });

    await expect(apiFetch('/api/v1/users/me', { auth: true })).rejects.toThrow(ApiError);

    expect(expired).toHaveBeenCalledTimes(1);
    expect(await getStoredTokens()).toBeNull();
    // No second refresh attempt was made.
    expect(api.callsTo('POST', '/api/v1/auth/refresh')).toHaveLength(1);
    unsubscribe();
  });

  it('does not refresh on 401 of an unauthenticated request', async () => {
    const api = mockApi({
      'POST /api/v1/auth/login': { status: 401, body: { status: 401, message: 'bad' } },
    });

    await expect(
      apiFetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({}) }),
    ).rejects.toMatchObject({ status: 401 });

    expect(api.calls).toHaveLength(1);
  });

  it('parses the contract error body into ApiError', async () => {
    mockApi({
      'POST /api/v1/auth/register/start': {
        status: 409,
        body: { status: 409, message: 'Phone already registered' },
      },
    });

    await expect(
      apiFetch('/api/v1/auth/register/start', {
        method: 'POST',
        body: JSON.stringify({ phone: '+963900000001' }),
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { message: 'Phone already registered' },
    });
  });
});

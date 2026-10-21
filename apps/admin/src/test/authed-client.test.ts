import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuthedApiClient, type AuthedClientHooks } from '../api/authedClient';
import { ApiError } from '../api/client';
import { callsTo, jsonResponse, stubFetchRoutes, TEST_CONFIG, TEST_USER } from './test-utils';

const ROTATED = {
  accessToken: 'access-token-2',
  refreshToken: 'refresh-token-2',
  expiresInSeconds: 900,
  user: TEST_USER,
};

function makeHooks(tokens: { accessToken: string; refreshToken: string } | null) {
  const hooks: AuthedClientHooks = {
    getTokens: () => tokens,
    onRotated: vi.fn(),
    onSessionExpired: vi.fn(),
  };
  return hooks;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authed api client', () => {
  it('attaches the bearer token to every request', async () => {
    const fetchMock = stubFetchRoutes(() => jsonResponse(200, TEST_USER));
    const client = createAuthedApiClient(
      TEST_CONFIG,
      makeHooks({ accessToken: 'access-token-1', refreshToken: 'refresh-token-1' }),
    );

    await client.get('/api/v1/users/me');

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token-1');
  });

  it('does not refresh on non-401 errors', async () => {
    const fetchMock = stubFetchRoutes(() => jsonResponse(500, { status: 500, message: 'boom' }));
    const hooks = makeHooks({ accessToken: 'access-token-1', refreshToken: 'refresh-token-1' });
    const client = createAuthedApiClient(TEST_CONFIG, hooks);

    await expect(client.get('/api/v1/users/me')).rejects.toMatchObject({ status: 500 });
    expect(callsTo(fetchMock, '/api/v1/auth/refresh')).toHaveLength(0);
    expect(hooks.onSessionExpired).not.toHaveBeenCalled();
  });

  it('refreshes once on 401, notifies the rotation, and retries with the new token', async () => {
    stubFetchRoutes((method, path, init) => {
      if (method === 'POST' && path === '/api/v1/auth/refresh') {
        return jsonResponse(200, ROTATED);
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer access-token-2'
        ? jsonResponse(200, TEST_USER)
        : jsonResponse(401, { status: 401, message: 'expired' });
    });
    const hooks = makeHooks({ accessToken: 'access-token-1', refreshToken: 'refresh-token-1' });
    const client = createAuthedApiClient(TEST_CONFIG, hooks);

    const profile = await client.get('/api/v1/users/me');

    expect(profile).toEqual(TEST_USER);
    expect(hooks.onRotated).toHaveBeenCalledWith(ROTATED);
    expect(hooks.onSessionExpired).not.toHaveBeenCalled();
  });

  it('expires the session when the refresh itself fails', async () => {
    const fetchMock = stubFetchRoutes(() => jsonResponse(401, { status: 401, message: 'revoked' }));
    const hooks = makeHooks({ accessToken: 'access-token-1', refreshToken: 'refresh-token-1' });
    const client = createAuthedApiClient(TEST_CONFIG, hooks);

    await expect(client.get('/api/v1/users/me')).rejects.toMatchObject({ status: 401 });
    expect(callsTo(fetchMock, '/api/v1/auth/refresh')).toHaveLength(1);
    expect(hooks.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(hooks.onRotated).not.toHaveBeenCalled();
  });

  it('expires the session when the retry is still 401 — never a second refresh', async () => {
    const fetchMock = stubFetchRoutes((method, path) => {
      if (method === 'POST' && path === '/api/v1/auth/refresh') {
        return jsonResponse(200, ROTATED);
      }
      return jsonResponse(401, { status: 401, message: 'still unauthorized' });
    });
    const hooks = makeHooks({ accessToken: 'access-token-1', refreshToken: 'refresh-token-1' });
    const client = createAuthedApiClient(TEST_CONFIG, hooks);

    await expect(client.get('/api/v1/users/me')).rejects.toMatchObject({ status: 401 });
    expect(callsTo(fetchMock, '/api/v1/auth/refresh')).toHaveLength(1);
    expect(hooks.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('expires immediately when there is no session', async () => {
    const fetchMock = stubFetchRoutes(() => jsonResponse(200, TEST_USER));
    const hooks = makeHooks(null);
    const client = createAuthedApiClient(TEST_CONFIG, hooks);

    await expect(client.get('/api/v1/users/me')).rejects.toBeInstanceOf(ApiError);
    expect(hooks.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('parallel 401s after the token expired (live test L-H1)', () => {
    /** Hooks backed by a mutable session, like the auth context's sessionRef. */
    function sessionHooks() {
      let tokens: { accessToken: string; refreshToken: string } | null = {
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
      };
      const hooks = {
        getTokens: () => tokens,
        onRotated: vi.fn((rotated: typeof ROTATED) => {
          tokens = { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken };
        }),
        onSessionExpired: vi.fn(() => {
          tokens = null;
        }),
      } satisfies AuthedClientHooks;
      return hooks;
    }

    function refreshBodies(fetchMock: ReturnType<typeof stubFetchRoutes>) {
      return callsTo(fetchMock, '/api/v1/auth/refresh').map(
        ([, init]) => JSON.parse(String(init?.body)) as { refreshToken: string },
      );
    }

    it('a 401 that lands after the first refresh settled reuses the rotated pair', async () => {
      let releaseLate!: () => void;
      const lateGate = new Promise<void>((resolve) => {
        releaseLate = resolve;
      });
      const fetchMock = stubFetchRoutes(async (method, path, init) => {
        if (method === 'POST' && path === '/api/v1/auth/refresh') {
          const body = JSON.parse(String(init?.body)) as { refreshToken: string };
          // The backend's reuse detection: a rotated refresh token revokes the family.
          return body.refreshToken === 'refresh-token-1'
            ? jsonResponse(200, ROTATED)
            : jsonResponse(401, { status: 401, message: 'reuse' });
        }
        const auth = (init?.headers as Record<string, string>).Authorization;
        if (auth === 'Bearer access-token-2') {
          return jsonResponse(200, { path });
        }
        if (path === '/api/v1/late') {
          await lateGate;
        }
        return jsonResponse(401, { status: 401, message: 'expired' });
      });
      const hooks = sessionHooks();
      const client = createAuthedApiClient(TEST_CONFIG, hooks);

      const late = client.get('/api/v1/late');
      const early = await client.get('/api/v1/early');
      expect(early).toEqual({ path: '/api/v1/early' });
      // The first refresh has fully settled before the late 401 arrives.
      releaseLate();
      await expect(late).resolves.toEqual({ path: '/api/v1/late' });

      expect(refreshBodies(fetchMock)).toEqual([{ refreshToken: 'refresh-token-1' }]);
      expect(hooks.onRotated).toHaveBeenCalledTimes(1);
      expect(hooks.onSessionExpired).not.toHaveBeenCalled();
      const retried = fetchMock.mock.calls
        .filter(([input]) => !String(input).includes('/auth/refresh'))
        .map(([, init]) => (init?.headers as Record<string, string>).Authorization);
      expect(retried.filter((auth) => auth === 'Bearer access-token-2')).toHaveLength(2);
    });

    it('parallel 401s in flight together share one refresh', async () => {
      const fetchMock = stubFetchRoutes((method, path, init) => {
        if (method === 'POST' && path === '/api/v1/auth/refresh') {
          return jsonResponse(200, ROTATED);
        }
        const auth = (init?.headers as Record<string, string>).Authorization;
        return auth === 'Bearer access-token-2'
          ? jsonResponse(200, { path })
          : jsonResponse(401, { status: 401, message: 'expired' });
      });
      const hooks = sessionHooks();
      const client = createAuthedApiClient(TEST_CONFIG, hooks);

      await expect(
        Promise.all([client.get('/api/v1/a'), client.get('/api/v1/b'), client.get('/api/v1/c')]),
      ).resolves.toHaveLength(3);
      expect(refreshBodies(fetchMock)).toEqual([{ refreshToken: 'refresh-token-1' }]);
      expect(hooks.onSessionExpired).not.toHaveBeenCalled();
    });

    it('a single 401 refreshes, persists the rotation and retries', async () => {
      const fetchMock = stubFetchRoutes((method, path, init) => {
        if (method === 'POST' && path === '/api/v1/auth/refresh') {
          return jsonResponse(200, ROTATED);
        }
        const auth = (init?.headers as Record<string, string>).Authorization;
        return auth === 'Bearer access-token-2'
          ? jsonResponse(200, TEST_USER)
          : jsonResponse(401, { status: 401, message: 'expired' });
      });
      const hooks = sessionHooks();
      const client = createAuthedApiClient(TEST_CONFIG, hooks);

      await expect(client.get('/api/v1/users/me')).resolves.toEqual(TEST_USER);
      expect(refreshBodies(fetchMock)).toEqual([{ refreshToken: 'refresh-token-1' }]);
      expect(hooks.getTokens()).toEqual({
        accessToken: 'access-token-2',
        refreshToken: 'refresh-token-2',
      });
      expect(hooks.onSessionExpired).not.toHaveBeenCalled();
    });

    it('a failed refresh expires the session once, for every waiting request', async () => {
      const fetchMock = stubFetchRoutes(() =>
        jsonResponse(401, { status: 401, message: 'revoked' }),
      );
      const hooks = sessionHooks();
      const client = createAuthedApiClient(TEST_CONFIG, hooks);

      const results = await Promise.allSettled([client.get('/api/v1/a'), client.get('/api/v1/b')]);
      expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
      expect(callsTo(fetchMock, '/api/v1/auth/refresh')).toHaveLength(1);
      expect(hooks.onSessionExpired).toHaveBeenCalled();
      expect(hooks.onRotated).not.toHaveBeenCalled();
      expect(hooks.getTokens()).toBeNull();
    });
  });
});

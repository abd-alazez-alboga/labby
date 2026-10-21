import type { RuntimeConfig } from '../config/runtime-config';
import { refreshSession, type AuthTokensResponse } from './auth';
import { ApiError, createApiClient, type ApiClient } from './client';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthedClientHooks {
  /** Current tokens, or null when signed out. */
  getTokens(): SessionTokens | null;
  /** A refresh rotated the pair — persist the new session. */
  onRotated(response: AuthTokensResponse): void;
  /** The session is unrecoverable (refresh failed or retry still 401) — force logout. */
  onSessionExpired(): void;
}

/**
 * Wraps the plain API client with bearer auth: every request carries the
 * access token; a 401 triggers at most ONE refresh attempt and one retry
 * with the rotated token. A failed refresh — or a retry that is still 401 —
 * expires the session, which the auth context turns into a forced logout to
 * the login page.
 *
 * Parallel requests (a page load fires several) capture the same expired
 * pair, and their 401s can arrive after another request's refresh already
 * settled. Replaying the captured refresh token then would look like token
 * reuse to the backend, which revokes the whole family (live test L-H1). So
 * after a 401 the client re-reads the stored pair: if another request has
 * rotated it, the retry just uses the current access token; a refresh is
 * sent only for the stored refresh token, single-flight per refresh token
 * (the settled promise is kept, so a late 401 shares its result).
 */
export function createAuthedApiClient(config: RuntimeConfig, hooks: AuthedClientHooks): ApiClient {
  const raw = createApiClient(config);
  let refresh: { refreshToken: string; promise: Promise<AuthTokensResponse> } | null = null;

  function refreshOnce(refreshToken: string): Promise<AuthTokensResponse> {
    if (refresh?.refreshToken !== refreshToken) {
      const promise = refreshSession(raw, refreshToken).then((rotated) => {
        hooks.onRotated(rotated);
        return rotated;
      });
      refresh = { refreshToken, promise };
    }
    return refresh.promise;
  }

  function withBearer(init: RequestInit, accessToken: string): RequestInit {
    return { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } };
  }

  /** The access token to retry with after a 401, refreshing only when nobody else has. */
  async function freshAccessToken(captured: SessionTokens): Promise<string | null> {
    const current = hooks.getTokens();
    if (!current) {
      return null;
    }
    if (
      current.accessToken !== captured.accessToken ||
      current.refreshToken !== captured.refreshToken
    ) {
      // Another request already rotated the pair — reuse it, never replay
      // the captured (now stale) refresh token.
      return current.accessToken;
    }
    const rotated = await refreshOnce(current.refreshToken);
    return rotated.accessToken;
  }

  async function execute<T>(
    path: string,
    run: (init: RequestInit) => Promise<T>,
    init: RequestInit,
  ): Promise<T> {
    const tokens = hooks.getTokens();
    if (!tokens) {
      hooks.onSessionExpired();
      throw new ApiError(401, path, 'No active session');
    }
    try {
      return await run(withBearer(init, tokens.accessToken));
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }
      let accessToken: string | null;
      try {
        accessToken = await freshAccessToken(tokens);
      } catch {
        accessToken = null;
      }
      if (accessToken === null) {
        hooks.onSessionExpired();
        throw error;
      }
      try {
        return await run(withBearer(init, accessToken));
      } catch (retryError) {
        if (retryError instanceof ApiError && retryError.status === 401) {
          hooks.onSessionExpired();
        }
        throw retryError;
      }
    }
  }

  return {
    get: <T>(path: string, init: RequestInit = {}) =>
      execute<T>(path, (i) => raw.get<T>(path, i), init),
    post: <T>(path: string, body?: unknown, init: RequestInit = {}) =>
      execute<T>(path, (i) => raw.post<T>(path, body, i), init),
    put: <T>(path: string, body?: unknown, init: RequestInit = {}) =>
      execute<T>(path, (i) => raw.put<T>(path, body, i), init),
    patch: <T>(path: string, body?: unknown, init: RequestInit = {}) =>
      execute<T>(path, (i) => raw.patch<T>(path, body, i), init),
    delete: <T>(path: string, init: RequestInit = {}) =>
      execute<T>(path, (i) => raw.delete<T>(path, i), init),
    download: (path: string, init: RequestInit = {}) =>
      execute(path, (i) => raw.download(path, i), init),
  };
}

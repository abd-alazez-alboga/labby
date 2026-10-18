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
 * access token; a 401 triggers exactly ONE refresh attempt (single-flight,
 * so parallel 401s share it) and one retry with the rotated token. A failed
 * refresh — or a retry that is still 401 — expires the session, which the
 * auth context turns into a forced logout to the login page.
 */
export function createAuthedApiClient(config: RuntimeConfig, hooks: AuthedClientHooks): ApiClient {
  const raw = createApiClient(config);
  let refreshInFlight: Promise<AuthTokensResponse> | null = null;

  function refreshOnce(refreshToken: string): Promise<AuthTokensResponse> {
    refreshInFlight ??= refreshSession(raw, refreshToken).finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  function withBearer(init: RequestInit, accessToken: string): RequestInit {
    return { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } };
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
      let rotated: AuthTokensResponse;
      try {
        rotated = await refreshOnce(tokens.refreshToken);
      } catch {
        hooks.onSessionExpired();
        throw error;
      }
      hooks.onRotated(rotated);
      try {
        return await run(withBearer(init, rotated.accessToken));
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
  };
}

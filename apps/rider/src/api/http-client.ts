/**
 * Typed fetch wrapper over the runtime config.
 *
 * Feature slices add their own API modules on top of `apiFetch`
 * (src/api/meta.ts, src/api/auth.ts).
 *
 * Auth behavior (M2-T3):
 * - `auth: true` attaches the stored access token as a Bearer header.
 * - On a 401 of an authenticated request the client tries EXACTLY ONE
 *   refresh (`POST /api/v1/auth/refresh`), rotates the stored pair, and
 *   retries the original request once. Concurrent 401s share a single
 *   in-flight refresh. If the refresh fails (or the retry 401s again) the
 *   stored tokens are cleared and `sessionExpired` is emitted so the auth
 *   context signs the user out.
 */
import { getAppConfig } from '../config/app-config';
import {
  clearTokens,
  emitSessionExpired,
  getStoredTokens,
  saveTokens,
} from '../auth/session-store';

/** Global error body shape from M1 (status, message, fieldErrors?). */
export interface ApiErrorBody {
  status?: number;
  message?: string;
  fieldErrors?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body?: ApiErrorBody,
    message?: string,
  ) {
    super(message ?? body?.message ?? `API request to ${path} failed with status ${status}`);
    this.name = 'ApiError';
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Attach the stored Bearer token and run the 401→refresh→retry cycle. */
  auth?: boolean;
}

function buildUrl(path: string): string {
  const { apiBaseUrl } = getAppConfig();
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildHeaders(init: ApiFetchOptions | undefined, accessToken?: string): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  // Let fetch set the multipart boundary itself for FormData bodies.
  if (!(init?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return { ...headers, ...(init?.headers as Record<string, string> | undefined) };
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody | undefined> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return undefined;
  }
}

async function parseResult<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * Single-flight refresh: resolves to the new access token, or null when the
 * refresh failed (tokens are then already cleared and sessionExpired fired).
 */
let refreshInFlight: Promise<string | null> | null = null;

function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  const tokens = await getStoredTokens();
  if (!tokens) {
    return null;
  }
  try {
    const response = await fetch(buildUrl('/api/v1/auth/refresh'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (response.status === 401) {
      // Only a contract 401 means the refresh token is invalid/revoked.
      await clearTokens();
      emitSessionExpired();
      return null;
    }
    if (!response.ok) {
      // Transient server trouble (5xx/429): keep the tokens, fail this request.
      return null;
    }
    const pair = (await response.json()) as { accessToken: string; refreshToken: string };
    await saveTokens({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
    return pair.accessToken;
  } catch {
    // Network failure during refresh: keep the tokens (the session may still
    // be valid next time the device is online) but fail this request.
    return null;
  }
}

export async function apiFetch<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const { auth, ...rest } = init ?? {};
  const url = buildUrl(path);

  let accessToken: string | undefined;
  if (auth) {
    accessToken = (await getStoredTokens())?.accessToken;
  }

  const response = await fetch(url, { ...rest, headers: buildHeaders(init, accessToken) });

  if (response.ok) {
    return parseResult<T>(response);
  }

  if (auth && response.status === 401) {
    const newAccessToken = await refreshSession();
    if (newAccessToken) {
      const retry = await fetch(url, {
        ...rest,
        headers: buildHeaders(init, newAccessToken),
      });
      if (retry.ok) {
        return parseResult<T>(retry);
      }
      if (retry.status === 401) {
        await clearTokens();
        emitSessionExpired();
      }
      throw new ApiError(retry.status, path, await parseErrorBody(retry));
    }
    throw new ApiError(401, path);
  }

  throw new ApiError(response.status, path, await parseErrorBody(response));
}

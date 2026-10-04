import type { AuthTokensResponse } from './auth-types';
import {
  clearSession,
  getSession,
  saveSession,
} from '../auth/session';
import type { StoredSession } from '../auth/session';
import { getConfig } from '../config';

/** Error thrown for any non-2xx API response. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/**
 * Minimal typed fetch wrapper around the Labby backend API.
 * JSON bodies are stringified; a FormData body passes through untouched
 * (fetch sets the multipart boundary itself).
 */
export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { apiBaseUrl } = getConfig();
  const url = `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const { body, headers, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const response = await fetch(url, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && !isFormData
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: isFormData ? body : JSON.stringify(body) }
      : {}),
  });

  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, parsed);
  }

  return parsed as T;
}

function withBearer(
  options: ApiRequestOptions,
  accessToken: string,
): ApiRequestOptions {
  return {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  };
}

// Concurrent 401s share one refresh call — reusing a rotated-out refresh
// token would revoke the whole token family server-side.
let refreshInFlight: Promise<StoredSession | null> | null = null;

function refreshStoredSession(): Promise<StoredSession | null> {
  refreshInFlight ??= rotateRefreshToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function rotateRefreshToken(): Promise<StoredSession | null> {
  const session = getSession();
  if (!session) return null;
  try {
    const tokens = await apiFetch<AuthTokensResponse>('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: session.refreshToken },
    });
    const rotated: StoredSession = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: tokens.user,
    };
    await saveSession(rotated);
    return rotated;
  } catch {
    return null;
  }
}

/**
 * Authenticated fetch: adds the bearer header from the stored session.
 * On a 401 it makes exactly ONE refresh attempt (rotating the stored
 * pair), retries the original request, and signs the user out locally
 * when the refresh (or the retried request) is rejected again.
 */
export async function authFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const session = getSession();
  if (!session) {
    throw new ApiError(401, null);
  }

  try {
    return await apiFetch<T>(path, withBearer(options, session.accessToken));
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }

    const rotated = await refreshStoredSession();
    if (!rotated) {
      await clearSession();
      throw error;
    }

    try {
      return await apiFetch<T>(path, withBearer(options, rotated.accessToken));
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) {
        await clearSession();
      }
      throw retryError;
    }
  }
}

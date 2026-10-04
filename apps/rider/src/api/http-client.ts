/**
 * Minimal typed fetch wrapper over the runtime config. No endpoints are
 * defined here yet — feature slices add their own API modules on top of
 * `apiFetch` (M1-T6 wires the first real call).
 */
import { getAppConfig } from '../config/app-config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message?: string,
  ) {
    super(message ?? `API request to ${path} failed with status ${status}`);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiBaseUrl } = getAppConfig();
  const url = `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, path);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

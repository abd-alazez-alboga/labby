import type { RuntimeConfig } from '../config/runtime-config';

/**
 * Minimal typed fetch wrapper around the Labby backend API.
 * The base URL comes from the runtime config (public/config.json) — never
 * from build-time env. Endpoints arrive with later milestones.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string,
    /** The `message` of the backend's error body (ErrorResponse), when it sent one. */
    public readonly serverMessage?: string,
  ) {
    super(message ?? `API request to ${url} failed with HTTP ${status}`);
    this.name = 'ApiError';
  }
}

/** Best-effort read of the backend ErrorResponse `message`; never throws. */
async function readServerMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { message?: unknown } | null;
    return typeof body?.message === 'string' && body.message.trim() !== ''
      ? body.message
      : undefined;
  } catch {
    return undefined;
  }
}

export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  delete<T>(path: string, init?: RequestInit): Promise<T>;
}

export function createApiClient(config: RuntimeConfig): ApiClient {
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new ApiError(response.status, url, undefined, await readServerMessage(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  function withBody(method: string) {
    return <T>(path: string, body?: unknown, init: RequestInit = {}) =>
      request<T>(path, {
        ...init,
        method,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
  }

  return {
    get: <T>(path: string, init: RequestInit = {}) => request<T>(path, { ...init, method: 'GET' }),
    post: withBody('POST'),
    put: withBody('PUT'),
    delete: <T>(path: string, init: RequestInit = {}) =>
      request<T>(path, { ...init, method: 'DELETE' }),
  };
}

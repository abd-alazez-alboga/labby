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
    /** The machine `code` of a domain error (ErrorResponse.code), e.g. `override_above_cap`. */
    public readonly code?: string,
    /** The domain error's `details` (ErrorResponse.details), e.g. `{ cap: 2 }`. */
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message ?? `API request to ${url} failed with HTTP ${status}`);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
}

/** Best-effort read of the backend ErrorResponse (`message`, `code`, `details`); never throws. */
async function readErrorBody(response: Response): Promise<ErrorBody> {
  try {
    const body = (await response.json()) as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
    } | null;
    return {
      message:
        typeof body?.message === 'string' && body.message.trim() !== '' ? body.message : undefined,
      code: typeof body?.code === 'string' ? body.code : undefined,
      details:
        typeof body?.details === 'object' && body.details !== null && !Array.isArray(body.details)
          ? (body.details as Record<string, unknown>)
          : undefined,
    };
  } catch {
    return {};
  }
}

export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
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
      const body = await readErrorBody(response);
      throw new ApiError(response.status, url, undefined, body.message, body.code, body.details);
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
    patch: withBody('PATCH'),
    delete: <T>(path: string, init: RequestInit = {}) =>
      request<T>(path, { ...init, method: 'DELETE' }),
  };
}

import { render } from '@testing-library/react';
import { vi } from 'vitest';

import type { UserProfile } from '../api/auth';
import { App } from '../app/App';
import { SESSION_STORAGE_KEY, type StoredSession } from '../auth/session';
import { ConfigProvider } from '../config/ConfigContext';
import type { RuntimeConfig } from '../config/runtime-config';

export const TEST_CONFIG: RuntimeConfig = {
  apiBaseUrl: 'http://api.test.local',
  environment: 'test',
};

/** The seeded Super Admin dev account (backend/docs/SEEDING.md). */
export const TEST_USER: UserProfile = {
  id: '00000000-0000-4000-8000-000000000004',
  phone: '+963900000004',
  name: 'Super Admin',
  language: 'en',
  photoUrl: null,
  state: 'active',
  roles: [{ role: 'admin', state: 'active' }],
};

export const TEST_SESSION: StoredSession = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  user: TEST_USER,
};

/** Puts a session into sessionStorage, as a previous login would have. */
export function seedStoredSession(session: StoredSession = TEST_SESSION): void {
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function readPersistedSession(): StoredSession | null {
  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as StoredSession) : null;
}

/** Renders the full app shell the same way main.tsx mounts it. */
export function renderShell(config: RuntimeConfig = TEST_CONFIG) {
  return render(
    <ConfigProvider config={config}>
      <App />
    </ConfigProvider>,
  );
}

/* ---------- Contract-level fetch mocking ---------- */

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

export type FetchRouteHandler = (
  method: string,
  pathname: string,
  init: RequestInit | undefined,
) => Response | Promise<Response> | null | undefined;

/**
 * Stubs global fetch with a route handler keyed on method + pathname.
 * Returning null/undefined rejects the call like a network failure, so
 * endpoints a test does not care about (e.g. the meta smoke call) simply
 * behave as offline.
 */
export function stubFetchRoutes(handler: FetchRouteHandler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const pathname = new URL(url).pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const response = await handler(method, pathname, init);
    if (!response) {
      throw new TypeError(`Unhandled fetch in test: ${method} ${pathname}`);
    }
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The calls a fetch mock received for a given path substring. */
export function callsTo(fetchMock: ReturnType<typeof stubFetchRoutes>, pathPart: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(pathPart));
}

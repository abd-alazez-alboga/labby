/**
 * Contract-level fetch mocking for tests (backend/docs/api/auth-v1.yaml).
 *
 * `mockApi` installs a fetch mock keyed by "METHOD /path". Each route's
 * replies are consumed FIFO; the last reply repeats for any further calls
 * (so e.g. a background GET /users/me can run more than once). Calls to
 * unmocked routes reject with a TypeError, which the app treats as a
 * network failure — exactly how an unexpected endpoint should surface.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AuthTokensResponse, UserProfile } from '../api/auth';
import { PROFILE_CACHE_KEY } from '../auth/auth-context';
import { saveTokens } from '../auth/session-store';

export interface MockReply {
  status: number;
  body?: unknown;
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface MockApi {
  fetchMock: jest.Mock;
  calls: RecordedCall[];
  /** Calls to one route, in order. */
  callsTo: (method: string, path: string) => RecordedCall[];
}

export function mockApi(routes: Record<string, MockReply | MockReply[]>): MockApi {
  const queues = new Map<string, MockReply[]>();
  for (const [key, value] of Object.entries(routes)) {
    queues.set(key, Array.isArray(value) ? [...value] : [value]);
  }
  const calls: RecordedCall[] = [];
  const fetchMock = jest.fn(async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init?.body) {
      body = init.body;
    }
    calls.push({ method, path, body, headers });

    const queue = queues.get(`${method} ${path}`);
    if (!queue || queue.length === 0) {
      throw new TypeError(`No mock for ${method} ${path}`);
    }
    const reply = queue.length > 1 ? (queue.shift() as MockReply) : queue[0];
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => {
        if (reply.body === undefined) {
          throw new Error(`Mock reply for ${method} ${path} has no body`);
        }
        return reply.body;
      },
    } as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    fetchMock,
    calls,
    callsTo: (method, path) =>
      calls.filter((c) => c.method === method.toUpperCase() && c.path === path),
  };
}

// ---------------------------------------------------------------------------
// Fixtures

export const sampleUser: UserProfile = {
  id: '6a6e36a2-3a3e-4bd4-9a39-0a9e9b1a0001',
  phone: '+963900000001',
  name: 'Test Rider',
  language: 'en',
  photoUrl: null,
  state: 'active',
  roles: [{ role: 'rider', state: 'active' }],
};

export function tokensResponse(overrides?: Partial<AuthTokensResponse>): AuthTokensResponse {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresInSeconds: 900,
    user: sampleUser,
    ...overrides,
  };
}

/** Seeds secure-store tokens + the AsyncStorage profile cache (signed in). */
export async function seedSignedInSession(user: UserProfile = sampleUser): Promise<void> {
  await saveTokens({ accessToken: 'seed-access', refreshToken: 'seed-refresh' });
  await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(user));
}

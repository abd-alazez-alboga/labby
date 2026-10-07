import type { UserProfile } from "../api/auth-types";
import { SESSION_STORAGE_KEY, saveSession } from "../auth/session";
import type { StoredSession } from "../auth/session";

/**
 * Contract-level fetch mocking (backend/docs/api/auth-v1.yaml): tests
 * declare responses per `METHOD /path`; any request outside the declared
 * contract fails the test loudly.
 */

export interface MockResponse {
  status: number;
  body?: unknown;
}

type RouteValue = MockResponse | MockResponse[];

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface ContractFetch {
  fetchSpy: jest.Mock;
  requests: RecordedRequest[];
  /** Requests matching `METHOD /path`. */
  requestsTo(route: string): RecordedRequest[];
}

function toFetchResponse(mock: MockResponse) {
  const text =
    mock.body === undefined || mock.status === 204
      ? ""
      : JSON.stringify(mock.body);
  return {
    ok: mock.status >= 200 && mock.status < 300,
    status: mock.status,
    text: async () => text,
  };
}

/**
 * Installs globalThis.fetch backed by the given routes. Keys look like
 * 'POST /api/v1/auth/login'. An array value is consumed response by
 * response (the last one repeats).
 */
export function installContractFetch(
  routes: Record<string, RouteValue>,
): ContractFetch {
  const queues = new Map<string, MockResponse[]>();
  for (const [route, value] of Object.entries(routes)) {
    queues.set(route, Array.isArray(value) ? [...value] : [value]);
  }

  const requests: RecordedRequest[] = [];

  const fetchSpy = jest.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const route = `${method} ${path}`;

    let body: unknown = null;
    if (typeof init?.body === "string") {
      body = JSON.parse(init.body);
    } else if (init?.body !== undefined && init?.body !== null) {
      body = init.body; // e.g. FormData
    }
    requests.push({
      method,
      path,
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    const queue = queues.get(route);
    if (!queue || queue.length === 0) {
      throw new Error(
        `Unexpected request outside the mocked contract: ${route}`,
      );
    }
    const next =
      queue.length === 1 ? queue[0] : (queue.shift() as MockResponse);
    return toFetchResponse(next);
  });

  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  return {
    fetchSpy,
    requests,
    requestsTo(route: string) {
      const [method, path] = route.split(" ");
      return requests.filter((r) => r.method === method && r.path === path);
    },
  };
}

// ------------------------------------------------------------- fixtures

/** Account holding rider + ACTIVE driver roles — passes the gate. */
export function driverUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "7f0c8f3e-2f6a-4e3f-9d6b-111111111111",
    phone: "+963900000001",
    name: "Dara Driver",
    language: "en",
    photoUrl: null,
    state: "active",
    roles: [
      { role: "rider", state: "active" },
      { role: "driver", state: "active" },
    ],
    ...overrides,
  };
}

/** Rider-only account — logs in but hits the apply-to-drive gate. */
export function riderOnlyUser(
  overrides: Partial<UserProfile> = {},
): UserProfile {
  return {
    id: "7f0c8f3e-2f6a-4e3f-9d6b-222222222222",
    phone: "+963900000002",
    name: "Rami Rider",
    language: "en",
    photoUrl: null,
    state: "active",
    roles: [{ role: "rider", state: "active" }],
    ...overrides,
  };
}

export function tokensFor(user: UserProfile, suffix = "1") {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    expiresInSeconds: 900,
    user,
  };
}

/** Puts a session into the in-memory store + secure store, as after login. */
export async function seedSession(
  user: UserProfile,
  suffix = "1",
): Promise<StoredSession> {
  const session: StoredSession = {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    user,
  };
  await saveSession(session);
  return session;
}

export { SESSION_STORAGE_KEY };

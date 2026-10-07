import * as SecureStore from "expo-secure-store";

import { getMyProfile } from "../api/auth";
import { ApiError } from "../api/client";
import { clearSession, getSession } from "../auth/session";
import {
  SESSION_STORAGE_KEY,
  driverUser,
  installContractFetch,
  seedSession,
  tokensFor,
} from "../test-utils/contract";

describe("authFetch (bearer + refresh-on-401)", () => {
  beforeEach(async () => {
    await clearSession();
  });

  it("sends the stored access token as a bearer header", async () => {
    const user = driverUser();
    await seedSession(user, "1");
    const contract = installContractFetch({
      "GET /api/v1/users/me": { status: 200, body: user },
    });

    await expect(getMyProfile()).resolves.toEqual(user);
    expect(contract.requests[0].headers.Authorization).toBe("Bearer access-1");
  });

  it("on 401 makes ONE refresh attempt, rotates the stored pair, and retries", async () => {
    const user = driverUser();
    await seedSession(user, "1");
    const contract = installContractFetch({
      "GET /api/v1/users/me": [
        { status: 401, body: { status: 401, message: "expired" } },
        { status: 200, body: user },
      ],
      "POST /api/v1/auth/refresh": {
        status: 200,
        body: tokensFor(user, "2"),
      },
    });

    await expect(getMyProfile()).resolves.toEqual(user);

    // Original call, refresh, retried call — in that order.
    expect(contract.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /api/v1/users/me",
      "POST /api/v1/auth/refresh",
      "GET /api/v1/users/me",
    ]);
    // Refresh used the OLD refresh token (rotation).
    expect(contract.requestsTo("POST /api/v1/auth/refresh")[0].body).toEqual({
      refreshToken: "refresh-1",
    });
    // Retry used the NEW access token.
    expect(contract.requests[2].headers.Authorization).toBe("Bearer access-2");
    // Rotated pair is stored in memory and in the secure store.
    expect(getSession()).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
    const persisted = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
    expect(JSON.parse(persisted as string)).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
  });

  it("signs out (clears the stored session) when the refresh is rejected", async () => {
    const user = driverUser();
    await seedSession(user, "1");
    const contract = installContractFetch({
      "GET /api/v1/users/me": {
        status: 401,
        body: { status: 401, message: "expired" },
      },
      "POST /api/v1/auth/refresh": {
        status: 401,
        body: { status: 401, message: "revoked" },
      },
    });

    await expect(getMyProfile()).rejects.toMatchObject({ status: 401 });

    // Exactly one refresh attempt — no loops.
    expect(contract.requestsTo("POST /api/v1/auth/refresh")).toHaveLength(1);
    expect(contract.requests).toHaveLength(2);
    // Signed out locally: memory and secure store are both empty.
    expect(getSession()).toBeNull();
    expect(await SecureStore.getItemAsync(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("keeps the session when the refresh fails transiently (5xx)", async () => {
    const user = driverUser();
    await seedSession(user, "1");
    const contract = installContractFetch({
      "GET /api/v1/users/me": {
        status: 401,
        body: { status: 401, message: "expired" },
      },
      "POST /api/v1/auth/refresh": {
        status: 500,
        body: { status: 500, message: "flaky" },
      },
    });

    await expect(getMyProfile()).rejects.toMatchObject({ status: 401 });

    expect(contract.requestsTo("POST /api/v1/auth/refresh")).toHaveLength(1);
    // The session survives server trouble: only a contract 401 signs out.
    expect(getSession()).not.toBeNull();
    expect(await SecureStore.getItemAsync(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("rejects immediately with 401 when no session is stored", async () => {
    installContractFetch({});
    await expect(getMyProfile()).rejects.toBeInstanceOf(ApiError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not refresh on non-401 errors", async () => {
    const user = driverUser();
    await seedSession(user, "1");
    const contract = installContractFetch({
      "GET /api/v1/users/me": {
        status: 500,
        body: { status: 500, message: "boom" },
      },
    });

    await expect(getMyProfile()).rejects.toMatchObject({ status: 500 });
    expect(contract.requests).toHaveLength(1);
    // Still signed in — a server hiccup must not log the driver out.
    expect(getSession()).not.toBeNull();
  });
});

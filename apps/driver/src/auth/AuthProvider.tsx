import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { getMyProfile, logout } from "../api/auth";
import type {
  AuthTokensResponse,
  DriverAccess,
  UserProfile,
} from "../api/auth-types";
import { driverAccessOf, hasActiveDriverRole } from "../api/auth-types";
import { onAccountSuspended } from "../api/client";
import {
  clearSession,
  getSession,
  saveSession,
  subscribeToSession,
  updateSessionUser,
} from "./session";
import { runSignOutTasks } from "./sign-out-tasks";

export interface AuthContextValue {
  status: "signedIn" | "signedOut";
  user: UserProfile | null;
  /**
   * The driver gate: an ACTIVE `driver` role on an account that is not
   * suspended — or (M11) a driver whose ride is still in flight while a
   * suspension landed: SOS and finishing the ride keep working (owner
   * ruling 2026-10-15), the ride facade holds the gate open until it ends.
   */
  isDriver: boolean;
  /** M11: how the account may use the driver side (ignores the ride hold). */
  driverAccess: DriverAccess;
  /** M11: the ride facade keeps the driver app open while a ride is in flight. */
  setRideHold: (held: boolean) => void;
  /**
   * Re-reads `GET /users/me` into the session (suspension / reactivation
   * pushes, a 403 `account_suspended`). Resolves null on failure.
   */
  refreshProfile: () => Promise<UserProfile | null>;
  /** Persists a fresh session after login / register complete. */
  applySession: (tokens: AuthTokensResponse) => Promise<void>;
  /** Updates the cached profile (profile edit, phone change, photo). */
  setUser: (user: UserProfile) => Promise<void>;
  /** Revokes the refresh token server-side (best-effort) and signs out. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const session = useSyncExternalStore(
    subscribeToSession,
    getSession,
    getSession,
  );

  const applySession = useCallback(async (tokens: AuthTokensResponse) => {
    await saveSession({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: tokens.user,
    });
  }, []);

  const setUser = useCallback(async (user: UserProfile) => {
    await updateSessionUser(user);
  }, []);

  const [rideHold, setRideHoldState] = useState(false);
  const setRideHold = useCallback((held: boolean) => {
    setRideHoldState(held);
  }, []);

  const refreshInFlight = useRef<Promise<UserProfile | null> | null>(null);
  const refreshProfile = useCallback((): Promise<UserProfile | null> => {
    refreshInFlight.current ??= getMyProfile()
      .then(async (profile) => {
        await updateSessionUser(profile);
        return profile;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight.current = null;
      });
    return refreshInFlight.current;
  }, []);

  // M11 (USR-06): a feature refused with 403 account_suspended means the
  // cached profile is stale — re-read it so the suspended screen shows.
  useEffect(
    () =>
      onAccountSuspended(() => {
        if (getSession()?.user.state !== "suspended") void refreshProfile();
      }),
    [refreshProfile],
  );

  const signOut = useCallback(async () => {
    // Device unregistration / going offline need the live session (M6).
    if (getSession()) {
      await runSignOutTasks();
    }
    const active = getSession();
    if (active) {
      // Best-effort server-side revocation (UC-S-03) through the refreshing
      // client, while the session is still available to it; local sign-out
      // happens regardless of the outcome.
      try {
        await logout(active.refreshToken);
        // If the call triggered a refresh, the pair rotated mid-logout and
        // the server revoked only the stale token — revoke the live one too.
        const latest = getSession();
        if (latest && latest.refreshToken !== active.refreshToken) {
          await logout(latest.refreshToken);
        }
      } catch {
        // ignore — the token also dies server-side at its expiry
      }
    }
    await clearSession();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const driverAccess: DriverAccess = session
      ? driverAccessOf(session.user)
      : "none";
    return {
      status: session ? "signedIn" : "signedOut",
      user: session?.user ?? null,
      isDriver: session
        ? hasActiveDriverRole(session.user) ||
          (rideHold && driverAccess !== "none")
        : false,
      driverAccess,
      setRideHold,
      refreshProfile,
      applySession,
      setUser,
      signOut,
    };
  }, [
    session,
    rideHold,
    setRideHold,
    refreshProfile,
    applySession,
    setUser,
    signOut,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return value;
}

/**
 * Like useAuth, but tolerates a missing provider (components such as the
 * settings screen that also render in provider-less unit tests).
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

import { logout } from "../api/auth";
import type { AuthTokensResponse, UserProfile } from "../api/auth-types";
import { hasActiveDriverRole } from "../api/auth-types";
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
  /** The driver gate: true only for an ACTIVE `driver` role assignment. */
  isDriver: boolean;
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

  const value = useMemo<AuthContextValue>(
    () => ({
      status: session ? "signedIn" : "signedOut",
      user: session?.user ?? null,
      isDriver: session ? hasActiveDriverRole(session.user) : false,
      applySession,
      setUser,
      signOut,
    }),
    [session, applySession, setUser, signOut],
  );

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

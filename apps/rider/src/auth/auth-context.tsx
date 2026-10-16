/**
 * Auth session state for the rider app.
 *
 * - Tokens are persisted ONLY in expo-secure-store (session-store.ts).
 * - The user profile is cached in AsyncStorage (not a credential) so a
 *   relaunch lands signed-in without a network round-trip; a background
 *   `GET /users/me` refreshes it best-effort.
 * - While the stored session is being restored the provider renders null,
 *   which keeps the native splash screen visible (same pattern as
 *   LocaleProvider).
 * - A failed token refresh anywhere in the http client emits
 *   `sessionExpired`; the provider listens and signs out locally.
 * - Logout unregisters this device's push token first (while the session
 *   is still valid); every local sign-out forgets it (M6-T4, ES-03).
 * - A 403 `account_suspended` / `rider_suspended` from any call (M11)
 *   re-reads the profile so its suspension state + reason drive the
 *   suspended screen; until a fresh profile arrives the code itself is
 *   kept as `suspensionSignal`.
 * - `refreshProfile` re-reads `/users/me`: called for the account-state
 *   pushes (suspended / reactivated, received or tapped — see
 *   ACCOUNT_STATE_EVENTS) and, by the provider itself, whenever the app
 *   returns to the foreground while the profile is suspended, so a
 *   reactivated rider leaves the suspended screen without a relaunch.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getMe,
  logout as apiLogout,
  type AuthTokensResponse,
  type UserProfile,
} from "../api/auth";
import { AppState } from "react-native";

import { ApiError } from "../api/http-client";
import {
  forgetPushToken,
  unregisterPushToken,
} from "../notifications/push-registration";
import {
  addSessionExpiredListener,
  clearTokens,
  getStoredTokens,
  saveTokens,
} from "./session-store";
import {
  addSuspensionListener,
  type SuspensionCode,
} from "./suspension-signal";

export const PROFILE_CACHE_KEY = "labby.rider.profile";

/** Push events that change the account / role state (trust-v1, M11). */
export const ACCOUNT_STATE_EVENTS: readonly string[] = [
  "account.suspended",
  "account.reactivated",
  "account.role_suspended",
  "account.role_reactivated",
];

/** Whether the profile (or the last 403 met) says something is suspended. */
function profileSuspended(
  user: UserProfile | null,
  signal: SuspensionCode | null,
): boolean {
  return (
    signal !== null ||
    user?.state === "suspended" ||
    !!user?.roles.some(
      (assignment) =>
        assignment.role === "rider" && assignment.state === "suspended",
    )
  );
}

export type AuthStatus = "loading" | "signedOut" | "signedIn";

/** Why the last local sign-out happened (drives the welcome screen copy). */
export type SignOutReason = "manual" | "expired" | "deleted" | null;

export interface AuthContextValue {
  status: AuthStatus;
  user: UserProfile | null;
  signOutReason: SignOutReason;
  /** Store a fresh session (login / register complete). */
  signIn: (tokens: AuthTokensResponse) => Promise<void>;
  /** Revoke the refresh token server-side (best-effort) and clear locally. */
  signOut: () => Promise<void>;
  /** Local-only sign-out after account deletion (server already revoked). */
  signOutAfterDeletion: () => Promise<void>;
  /** Replace the cached profile after a profile-mutating call. */
  setUser: (user: UserProfile) => void;
  /**
   * The last suspension code a call met (M11) while no fresher profile
   * says otherwise; null once a profile was read after it.
   */
  suspensionSignal: SuspensionCode | null;
  /** Re-reads `/users/me` (best effort) into the cached profile. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function readCachedProfile(): Promise<UserProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

async function writeCachedProfile(user: UserProfile | null): Promise<void> {
  try {
    if (user) {
      await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(user));
    } else {
      await AsyncStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    // cache is best-effort
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [signOutReason, setSignOutReason] = useState<SignOutReason>(null);
  const [suspensionSignal, setSuspensionSignal] =
    useState<SuspensionCode | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Restore the stored session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tokens = await getStoredTokens();
      if (!tokens) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      const cached = await readCachedProfile();
      if (cached) {
        if (!cancelled) {
          setUserState(cached);
          setStatus("signedIn");
        }
        // Background refresh of the profile; ignore failures (offline, …).
        getMe()
          .then((fresh) => {
            if (!cancelled && mounted.current) {
              setUserState(fresh);
            }
            void writeCachedProfile(fresh);
          })
          .catch(() => {});
        return;
      }
      // Tokens without a cached profile (first run after an upgrade, cleared
      // cache): the profile is required, so fetch it before unveiling.
      try {
        const fresh = await getMe();
        await writeCachedProfile(fresh);
        if (!cancelled) {
          setUserState(fresh);
          setStatus("signedIn");
        }
      } catch (error) {
        // Only an auth rejection invalidates the session; a network failure
        // (offline launch) keeps the tokens for the next start.
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          await clearTokens();
        }
        if (!cancelled) setStatus("signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearLocalSession = useCallback(async (reason: SignOutReason) => {
    await forgetPushToken();
    await clearTokens();
    await writeCachedProfile(null);
    if (mounted.current) {
      setUserState(null);
      setSuspensionSignal(null);
      setSignOutReason(reason);
      setStatus("signedOut");
    }
  }, []);

  // A failed refresh in the http client kills the session.
  useEffect(() => {
    return addSessionExpiredListener(() => {
      void clearLocalSession("expired");
    });
  }, [clearLocalSession]);

  // A suspension met by any call: re-read the profile (reachable while
  // suspended) so the screen shows the current state and reason.
  useEffect(() => {
    return addSuspensionListener((code) => {
      if (!mounted.current) return;
      setSuspensionSignal(code);
      getMe()
        .then((fresh) => {
          if (!mounted.current) return;
          setUserState(fresh);
          setSuspensionSignal(null);
          void writeCachedProfile(fresh);
        })
        .catch(() => {
          // Keep the signal — the suspended screen shows without the reason.
        });
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const fresh = await getMe();
      if (!mounted.current) return;
      setUserState(fresh);
      setSuspensionSignal(null);
      void writeCachedProfile(fresh);
    } catch {
      // Offline / transient — the next event or foreground tries again.
    }
  }, []);

  // Back in the foreground while suspended: the state may have been lifted.
  const suspendedNow = status === "signedIn" && profileSuspended(user, suspensionSignal);
  useEffect(() => {
    if (!suspendedNow) return;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") void refreshProfile();
      previous = next;
    });
    return () => subscription.remove();
  }, [suspendedNow, refreshProfile]);

  const signIn = useCallback(async (tokens: AuthTokensResponse) => {
    await saveTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
    await writeCachedProfile(tokens.user);
    if (mounted.current) {
      setUserState(tokens.user);
      setSignOutReason(null);
      setSuspensionSignal(null);
      setStatus("signedIn");
    }
  }, []);

  const signOut = useCallback(async () => {
    const tokens = await getStoredTokens();
    if (tokens) {
      // Stop pushes to this device for this account (best-effort, needs the
      // still-valid session, so it runs before the revocation).
      await unregisterPushToken();
      // Best-effort server-side revocation (UC-S-03); local sign-out happens
      // regardless of network state.
      try {
        await apiLogout(tokens.refreshToken);
        // If the call triggered a refresh, the pair rotated mid-logout and the
        // server revoked only the stale token — revoke the live one too.
        const latest = await getStoredTokens();
        if (latest && latest.refreshToken !== tokens.refreshToken) {
          await apiLogout(latest.refreshToken);
        }
      } catch {
        // ignore — token expires server-side anyway
      }
    }
    await clearLocalSession("manual");
  }, [clearLocalSession]);

  const signOutAfterDeletion = useCallback(async () => {
    await clearLocalSession("deleted");
  }, [clearLocalSession]);

  const setUser = useCallback((next: UserProfile) => {
    setUserState(next);
    setSuspensionSignal(null);
    void writeCachedProfile(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      signOutReason,
      signIn,
      signOut,
      signOutAfterDeletion,
      setUser,
      suspensionSignal,
      refreshProfile,
    }),
    [
      status,
      user,
      signOutReason,
      signIn,
      signOut,
      signOutAfterDeletion,
      setUser,
      suspensionSignal,
      refreshProfile,
    ],
  );

  if (status === "loading") {
    return null; // splash stays visible until the stored session is restored
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

/** The auth state, or null outside the provider (provider-less tests). */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext) ?? null;
}

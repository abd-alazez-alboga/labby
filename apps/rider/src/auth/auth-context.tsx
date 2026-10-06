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
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getMe,
  logout as apiLogout,
  type AuthTokensResponse,
  type UserProfile,
} from '../api/auth';
import { ApiError } from '../api/http-client';
import { forgetPushToken, unregisterPushToken } from '../notifications/push-registration';
import {
  addSessionExpiredListener,
  clearTokens,
  getStoredTokens,
  saveTokens,
} from './session-store';

export const PROFILE_CACHE_KEY = 'labby.rider.profile';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/** Why the last local sign-out happened (drives the welcome screen copy). */
export type SignOutReason = 'manual' | 'expired' | 'deleted' | null;

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
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [signOutReason, setSignOutReason] = useState<SignOutReason>(null);
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
        if (!cancelled) setStatus('signedOut');
        return;
      }
      const cached = await readCachedProfile();
      if (cached) {
        if (!cancelled) {
          setUserState(cached);
          setStatus('signedIn');
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
          setStatus('signedIn');
        }
      } catch (error) {
        // Only an auth rejection invalidates the session; a network failure
        // (offline launch) keeps the tokens for the next start.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          await clearTokens();
        }
        if (!cancelled) setStatus('signedOut');
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
      setSignOutReason(reason);
      setStatus('signedOut');
    }
  }, []);

  // A failed refresh in the http client kills the session.
  useEffect(() => {
    return addSessionExpiredListener(() => {
      void clearLocalSession('expired');
    });
  }, [clearLocalSession]);

  const signIn = useCallback(async (tokens: AuthTokensResponse) => {
    await saveTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    await writeCachedProfile(tokens.user);
    if (mounted.current) {
      setUserState(tokens.user);
      setSignOutReason(null);
      setStatus('signedIn');
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
    await clearLocalSession('manual');
  }, [clearLocalSession]);

  const signOutAfterDeletion = useCallback(async () => {
    await clearLocalSession('deleted');
  }, [clearLocalSession]);

  const setUser = useCallback((next: UserProfile) => {
    setUserState(next);
    void writeCachedProfile(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signOutReason, signIn, signOut, signOutAfterDeletion, setUser }),
    [status, user, signOutReason, signIn, signOut, signOutAfterDeletion, setUser],
  );

  if (status === 'loading') {
    return null; // splash stays visible until the stored session is restored
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

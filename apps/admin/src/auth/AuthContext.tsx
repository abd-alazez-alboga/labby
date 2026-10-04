import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  getMyProfile,
  login as loginRequest,
  logout as logoutRequest,
  type AuthTokensResponse,
  type UserProfile,
} from '../api/auth';
import { createAuthedApiClient } from '../api/authedClient';
import { createApiClient, type ApiClient } from '../api/client';
import { useConfig } from '../config/ConfigContext';
import {
  clearStoredSession,
  persistSession,
  readStoredSession,
  type StoredSession,
} from './session';

export interface AuthContextValue {
  /** The signed-in admin, or null when anonymous. */
  user: UserProfile | null;
  /** True when the last session ended because the refresh failed (expiry). */
  sessionExpired: boolean;
  /** API client that sends the bearer token and auto-refreshes once on 401. */
  apiClient: ApiClient;
  login(phone: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const config = useConfig();

  // Tokens live in memory here; sessionStorage is only the reload mirror.
  const sessionRef = useRef<StoredSession | null>(null);
  const [user, setUser] = useState<UserProfile | null>(() => {
    sessionRef.current = readStoredSession();
    return sessionRef.current?.user ?? null;
  });
  const [sessionExpired, setSessionExpired] = useState(false);

  const applySession = useCallback((tokens: AuthTokensResponse) => {
    const session: StoredSession = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: tokens.user,
    };
    sessionRef.current = session;
    persistSession(session);
    setUser(tokens.user);
  }, []);

  const endSession = useCallback((expired: boolean) => {
    sessionRef.current = null;
    clearStoredSession();
    setUser(null);
    setSessionExpired(expired);
  }, []);

  const rawClient = useMemo(() => createApiClient(config), [config]);

  const apiClient = useMemo(
    () =>
      createAuthedApiClient(config, {
        getTokens: () => sessionRef.current,
        onRotated: applySession,
        onSessionExpired: () => endSession(true),
      }),
    [config, applySession, endSession],
  );

  const login = useCallback(
    async (phone: string, password: string) => {
      const response = await loginRequest(rawClient, { phone, password, client: 'admin' });
      applySession(response);
      setSessionExpired(false);
    },
    [rawClient, applySession],
  );

  const logout = useCallback(async () => {
    const session = sessionRef.current;
    if (session) {
      try {
        await logoutRequest(rawClient, session.accessToken, session.refreshToken);
      } catch {
        // Best-effort revocation: clearing the local session must never fail.
      }
    }
    endSession(false);
  }, [rawClient, endSession]);

  // Revalidate a restored session once on mount: refreshes the profile and,
  // via the authed client, rotates stale tokens or expires the session.
  // Network errors keep the stored session (same spirit as ApiStatus — a
  // dead backend must not log the admin out).
  useEffect(() => {
    if (!sessionRef.current) {
      return;
    }
    let cancelled = false;
    getMyProfile(apiClient)
      .then((profile) => {
        if (cancelled || !sessionRef.current) {
          return;
        }
        const next = { ...sessionRef.current, user: profile };
        sessionRef.current = next;
        persistSession(next);
        setUser(profile);
      })
      .catch(() => {
        // A 401 path already expired the session inside the authed client.
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, sessionExpired, apiClient, login, logout }),
    [user, sessionExpired, apiClient, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Typed access to the auth state and session-aware API client. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}

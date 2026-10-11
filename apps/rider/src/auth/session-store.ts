/**
 * Secure token storage + session-expiry signalling.
 *
 * Tokens live ONLY in expo-secure-store (never AsyncStorage). The http
 * client reads/rotates them during the one-shot 401 refresh; the auth
 * context subscribes to `addSessionExpiredListener` so a failed refresh
 * anywhere in the app signs the user out exactly once.
 */
import * as SecureStore from "expo-secure-store";

export const ACCESS_TOKEN_KEY = "labby.rider.accessToken";
export const REFRESH_TOKEN_KEY = "labby.rider.refreshToken";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export async function getStoredTokens(): Promise<StoredTokens | null> {
  try {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    ]);
    if (!accessToken || !refreshToken) {
      return null;
    }
    return { accessToken, refreshToken };
  } catch {
    // Secure store unavailable — treat as signed out rather than crashing.
    return null;
  }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
  emitTokensChanged();
}

export async function clearTokens(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // best-effort: nothing sensible to do if the keychain is unavailable
  }
  emitTokensChanged();
}

type TokensChangedListener = () => void;
const tokensChangedListeners = new Set<TokensChangedListener>();

/**
 * Fired after the stored token pair was saved (sign-in, refresh rotation)
 * or cleared — the realtime socket re-authenticates on it (realtime-v1).
 */
export function addTokensChangedListener(
  listener: TokensChangedListener,
): () => void {
  tokensChangedListeners.add(listener);
  return () => {
    tokensChangedListeners.delete(listener);
  };
}

function emitTokensChanged(): void {
  for (const listener of tokensChangedListeners) {
    listener();
  }
}

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

/** Fired when a 401 could not be recovered by a refresh (session is dead). */
export function addSessionExpiredListener(
  listener: SessionExpiredListener,
): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  for (const listener of sessionExpiredListeners) {
    listener();
  }
}

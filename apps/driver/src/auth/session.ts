import * as SecureStore from 'expo-secure-store';

import type { UserProfile } from '../api/auth-types';

/**
 * Secure session store: the token pair + the signed-in profile, persisted
 * with expo-secure-store (device keychain/keystore — never AsyncStorage).
 *
 * This module is the single source of truth for "who is signed in": the
 * API client rotates/clears it on 401s and AuthProvider mirrors it into
 * React via subscribe/getSession.
 */

export const SESSION_STORAGE_KEY = 'labby-driver.session';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

let current: StoredSession | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Current in-memory session (null while signed out / before load). */
export function getSession(): StoredSession | null {
  return current;
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredSession>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.user === 'object' &&
    candidate.user !== null &&
    Array.isArray(candidate.user.roles)
  );
}

/**
 * Loads the persisted session into memory (app launch, while the splash
 * screen is still up). Unreadable/corrupt data counts as signed out.
 */
export async function loadStoredSession(): Promise<StoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
    if (raw === null) {
      current = null;
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    current = isStoredSession(parsed) ? parsed : null;
  } catch {
    current = null;
  }
  if (current) emit();
  return current;
}

/** Stores a (possibly rotated) session; persistence is best-effort. */
export async function saveSession(next: StoredSession): Promise<void> {
  current = next;
  emit();
  try {
    await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keychain write failed — the in-memory session still works this run.
  }
}

/** Updates the cached profile without touching the token pair. */
export async function updateSessionUser(user: UserProfile): Promise<void> {
  if (!current) return;
  await saveSession({ ...current, user });
}

/** Local sign-out: forgets the session in memory and on the device. */
export async function clearSession(): Promise<void> {
  current = null;
  emit();
  try {
    await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
  } catch {
    // Nothing usable remains in memory either way.
  }
}

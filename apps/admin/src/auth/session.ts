import type { UserProfile } from '../api/auth';

/**
 * Session persistence: tokens live in memory (the auth context) and are
 * mirrored to sessionStorage so a page reload within the tab keeps the
 * session. Storage can be unavailable or throw (private mode, blocked,
 * quota), so every access is wrapped — the app must work without it.
 */

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

export const SESSION_STORAGE_KEY = 'labby.admin.session';

export function readStoredSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.user !== 'object' ||
      parsed.user === null
    ) {
      return null;
    }
    return parsed as StoredSession;
  } catch {
    // Unreadable or corrupt storage counts as "no session".
    return null;
  }
}

export function persistSession(session: StoredSession): void {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Non-fatal: the session just will not survive a reload.
  }
}

export function clearStoredSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

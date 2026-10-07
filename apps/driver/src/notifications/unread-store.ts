import { useSyncExternalStore } from "react";

import { getUnreadCount } from "../api/notifications";
import { subscribeToSession, getSession } from "../auth/session";

/**
 * The unread badge (UC-S-11): one in-memory count shared by the bell, the
 * center and push handling. The center sets it from each page's `unread`;
 * marking read adjusts it; the bell refreshes it on focus and on pushes.
 * Cleared on sign-out.
 */

let unread = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getUnread(): number {
  return unread;
}

export function setUnread(next: number): void {
  const value = Math.max(0, Math.floor(next));
  if (value === unread) return;
  unread = value;
  emit();
}

export function decrementUnread(): void {
  setUnread(unread - 1);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

subscribeToSession(() => {
  if (!getSession()) setUnread(0);
});

/** Re-reads the count from the server; failures keep the last value. */
export async function refreshUnread(): Promise<void> {
  if (!getSession()) return;
  try {
    setUnread(await getUnreadCount());
  } catch {
    // keep the last known badge
  }
}

export function useUnreadCount(): number {
  return useSyncExternalStore(subscribe, getUnread, getUnread);
}

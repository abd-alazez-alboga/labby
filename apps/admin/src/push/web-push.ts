import type { FirebaseWebConfig } from '../config/runtime-config';

/**
 * The web-push seam (ES-03). The shell talks to this interface only; the
 * Firebase implementation lives in ./firebase-web-push and is reached
 * through a dynamic import, so the Firebase SDK is a separate chunk that is
 * fetched ONLY when config.json carries a `firebaseWeb` block and the admin
 * has granted notification permission. Tests mock ./firebase-web-push.
 */

/** A push received while the admin tab is in the foreground. */
export interface WebPushMessage {
  title?: string;
  body?: string;
  /** FCM data payload (string values). */
  data: Record<string, string>;
}

export interface WebPushClient {
  /** This browser's FCM registration token (requires granted permission). */
  getToken(): Promise<string>;
  /** Subscribes to foreground messages; returns the unsubscribe function. */
  onMessage(listener: (message: WebPushMessage) => void): () => void;
}

/** Loads the Firebase-backed client, or resolves null when this browser cannot do web push. */
export async function loadWebPush(config: FirebaseWebConfig): Promise<WebPushClient | null> {
  const { createFirebaseWebPush } = await import('./firebase-web-push');
  return createFirebaseWebPush(config);
}

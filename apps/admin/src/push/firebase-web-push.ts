import { getApp, getApps, initializeApp, SDK_VERSION } from '@firebase/app';
import { getMessaging, getToken, isSupported, onMessage } from '@firebase/messaging';

import type { FirebaseWebConfig } from '../config/runtime-config';
import type { WebPushClient } from './web-push';

/**
 * Firebase Cloud Messaging for the browser — ONLY ever reached through the
 * dynamic import in ./web-push (keeps the SDK out of the main bundle).
 *
 * FCM needs a service worker to receive pushes; ours is
 * public/firebase-messaging-sw.js. It is given the (public, non-secret)
 * Firebase web config and the SDK version through its URL, because a
 * worker cannot read the page's runtime config synchronously and FCM's
 * listeners must be installed during the worker's first evaluation.
 */
export async function createFirebaseWebPush(
  config: FirebaseWebConfig,
): Promise<WebPushClient | null> {
  if (!('serviceWorker' in navigator) || !(await isSupported())) {
    return null;
  }
  const { vapidKey, ...appConfig } = config;
  const app = getApps().length > 0 ? getApp() : initializeApp(appConfig);
  const messaging = getMessaging(app);

  const base = import.meta.env.BASE_URL;
  const workerParams = new URLSearchParams({
    sdk: SDK_VERSION,
    firebaseConfig: JSON.stringify(appConfig),
  });
  const registration = await navigator.serviceWorker.register(
    `${base}firebase-messaging-sw.js?${workerParams.toString()}`,
    { scope: `${base}firebase-cloud-messaging-push-scope` },
  );

  return {
    getToken: () => getToken(messaging, { vapidKey, serviceWorkerRegistration: registration }),
    onMessage: (listener) =>
      onMessage(messaging, (payload) =>
        listener({
          title: payload.notification?.title,
          body: payload.notification?.body,
          data: payload.data ?? {},
        }),
      ),
  };
}

/*
 * Firebase Cloud Messaging service worker (ES-03, browser push for admins).
 *
 * Registered ONLY by src/push/firebase-web-push.ts, i.e. only when
 * config.json carries a `firebaseWeb` block and the admin granted
 * notification permission. The page passes the (public, non-secret)
 * Firebase web config and the exact SDK version it bundles through this
 * script's URL — a worker cannot await the page's runtime config, and FCM's
 * push listeners must be installed during the first evaluation.
 *
 * With the SDK installed here, pushes arriving while an admin tab is focused
 * are forwarded to the page (shown there as toasts); in the background the
 * SDK displays the push's notification payload itself.
 */
const params = new URL(self.location.href).searchParams;
const sdkVersion = params.get('sdk') || '';
let firebaseConfig = null;
try {
  firebaseConfig = JSON.parse(params.get('firebaseConfig') || 'null');
} catch (error) {
  firebaseConfig = null;
}

if (/^\d+\.\d+\.\d+$/.test(sdkVersion) && firebaseConfig && typeof firebaseConfig === 'object') {
  importScripts(
    `https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-app-compat.js`,
    `https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-messaging-compat.js`,
  );
  firebase.initializeApp(firebaseConfig);
  firebase.messaging();
}

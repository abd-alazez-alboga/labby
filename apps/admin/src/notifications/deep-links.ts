import type { DeepLink } from '../api/notifications';

/** The admin notification center route. */
export const NOTIFICATION_CENTER_PATH = '/notifications';
export const NOTIFICATION_PREFERENCES_PATH = '/notifications/preferences';

/** The live ops map (UC-A-19/20), where an SOS alert is handled. */
export const LIVE_OPS_PATH = '/live-ops';

/** The live map opened on an SOS: its region and ride when the link names them. */
function liveOpsPath(params: Record<string, string>): string {
  const query = new URLSearchParams();
  if (params.regionId) {
    query.set('region', params.regionId);
  }
  if (params.rideId) {
    query.set('ride', params.rideId);
  }
  const search = query.toString();
  return search ? `${LIVE_OPS_PATH}?${search}` : LIVE_OPS_PATH;
}

/**
 * Deep-link catalog → admin routes (UC-S-11). The contract's catalog
 * (realtime-v1.yaml) is `{screen, params}`; "unknown screens open the
 * notification center".
 *
 * The admin screens: the center itself, and the live ops map for the SAFE-01
 * SOS alert (`live_ops`, also accepted as `sos`) — a tap on the safety push,
 * or on its center row, lands where the alert is acknowledged (V1 audit W6).
 * The background web push opens the same-origin `/live-ops` URL the backend
 * sets as its webpush link; that route is the same page. Driver-app screens
 * (`driver_application`, `driver_documents`, `driver_vehicles`) and rider
 * screens (`ride`, `chat`, …) have no admin counterpart and fall back to the
 * center like any unknown screen.
 */
const ADMIN_SCREENS: Record<string, (params: Record<string, string>) => string | null> = {
  notifications: () => NOTIFICATION_CENTER_PATH,
  live_ops: liveOpsPath,
  sos: liveOpsPath,
};

/** The admin route a notification's link opens; anything unmapped opens the center. */
export function deepLinkToPath(link: DeepLink | null | undefined): string {
  if (!link || typeof link.screen !== 'string') {
    return NOTIFICATION_CENTER_PATH;
  }
  const resolve = Object.prototype.hasOwnProperty.call(ADMIN_SCREENS, link.screen)
    ? ADMIN_SCREENS[link.screen]
    : undefined;
  return resolve?.(link.params ?? {}) ?? NOTIFICATION_CENTER_PATH;
}

/**
 * The deep link carried by an FCM push (realtime-v1.yaml "Push payload"):
 * the data map's `screen` plus `params`, a JSON object encoded as a string.
 * Malformed params are dropped rather than failing the whole link.
 */
export function deepLinkFromPushData(data: Record<string, string>): DeepLink | null {
  const screen = data.screen;
  if (!screen) {
    return null;
  }
  let params: Record<string, string> = {};
  if (data.params) {
    try {
      const parsed: unknown = JSON.parse(data.params);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        params = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        );
      }
    } catch {
      params = {};
    }
  }
  return { screen, params };
}

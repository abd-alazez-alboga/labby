import type { DeepLink } from '../api/notifications';

/** The admin notification center route. */
export const NOTIFICATION_CENTER_PATH = '/notifications';
export const NOTIFICATION_PREFERENCES_PATH = '/notifications/preferences';

/**
 * Deep-link catalog → admin routes (UC-S-11). The contract's catalog
 * (realtime-v1.yaml) is `{screen, params}`; "unknown screens open the
 * notification center".
 *
 * Today the catalog only names the center itself plus driver-app screens
 * (`driver_application`, `driver_documents`, `driver_vehicles`) — those are
 * a driver's OWN screens with no admin counterpart, so in this client they
 * fall back to the center like any unknown screen. Later milestones add
 * admin-relevant screens (e.g. M7 `ride`, M10 SOS) as entries here.
 */
const ADMIN_SCREENS: Record<string, (params: Record<string, string>) => string | null> = {
  notifications: () => NOTIFICATION_CENTER_PATH,
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

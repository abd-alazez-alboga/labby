import type { ApiClient } from './client';

/**
 * Contract types and calls for the M6 notification center, preferences and
 * device registration. Source of truth: backend/docs/api/realtime-v1.yaml.
 * Every center call names the calling client (`app=admin`): the admin
 * center lists `admin` + `all` audience rows, and devices registered here
 * only receive admin-audience pushes.
 */

/** The audience this client reads and registers devices for. */
export const APP = 'admin';

export type NotificationCategory =
  'ride' | 'chat' | 'scheduled' | 'promotions' | 'account' | 'safety';

/** Canonical display order (NTF-01 list order). */
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'ride',
  'chat',
  'scheduled',
  'promotions',
  'account',
  'safety',
];

/** `{screen, params}` from the contract's fixed deep-link catalog (UC-S-11). */
export interface DeepLink {
  screen: string;
  params?: Record<string, string>;
}

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  /** Template key, e.g. `driver_application.approved`. */
  event: string;
  /** Rendered server-side in the caller's current language. */
  title: string;
  body: string;
  link?: DeepLink | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  /** Unread count of this client's center. */
  unread: number;
  /** Absent/null on the last page. */
  nextCursor?: string | null;
}

export interface NotificationQuery {
  category?: NotificationCategory;
  /** The previous page's `nextCursor`. */
  before?: string;
  size?: number;
}

export interface NotificationPreference {
  category: NotificationCategory;
  enabled: boolean;
  /** true for ride and safety: always enabled (NTF-02, UC-S-12 E1). */
  locked: boolean;
}

export interface PreferenceChange {
  category: NotificationCategory;
  enabled: boolean;
}

export interface DeviceRegistration {
  token: string;
  platform: 'android' | 'ios' | 'web';
  app: 'rider' | 'driver' | 'admin';
}

/** GET /notifications — one page, newest first (cursor pagination). */
export function listNotifications(
  client: ApiClient,
  query: NotificationQuery = {},
): Promise<NotificationPage> {
  const params = new URLSearchParams({ app: APP });
  if (query.category) params.set('category', query.category);
  if (query.before) params.set('before', query.before);
  if (query.size !== undefined) params.set('size', String(query.size));
  return client.get<NotificationPage>(`/api/v1/notifications?${params.toString()}`);
}

/** GET /notifications/unread-count — the top-bar badge. */
export async function getUnreadCount(client: ApiClient): Promise<number> {
  const result = await client.get<{ unread: number }>(
    `/api/v1/notifications/unread-count?app=${APP}`,
  );
  return result.unread;
}

/** POST /notifications/{id}/read — idempotent. */
export function markNotificationRead(client: ApiClient, notificationId: string): Promise<void> {
  return client.post<void>(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`);
}

/** POST /notifications/read-all — every row of the admin center. */
export function markAllNotificationsRead(client: ApiClient): Promise<void> {
  return client.post<void>(`/api/v1/notifications/read-all?app=${APP}`);
}

/** GET /notifications/preferences — all six categories (account-wide, not per app). */
export function getNotificationPreferences(client: ApiClient): Promise<NotificationPreference[]> {
  return client.get<NotificationPreference[]>('/api/v1/notifications/preferences');
}

/** PUT /notifications/preferences — partial; answers the full updated list. 400 = locked/unknown. */
export function updateNotificationPreferences(
  client: ApiClient,
  changes: PreferenceChange[],
): Promise<NotificationPreference[]> {
  return client.put<NotificationPreference[]>('/api/v1/notifications/preferences', changes);
}

/** PUT /devices — register (or re-assign to this account) a browser's FCM token. */
export function registerDevice(client: ApiClient, token: string): Promise<void> {
  const body: DeviceRegistration = { token, platform: 'web', app: APP };
  return client.put<void>('/api/v1/devices', body);
}

/** DELETE /devices/{token} — on logout; idempotent server-side. */
export function unregisterDevice(client: ApiClient, token: string): Promise<void> {
  return client.delete<void>(`/api/v1/devices/${encodeURIComponent(token)}`);
}

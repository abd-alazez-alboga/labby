import { authFetch } from "./client";
import type {
  DeviceRegistration,
  NotificationCategory,
  NotificationPage,
  NotificationPreference,
} from "./realtime-types";

/**
 * Client slice of realtime-v1.yaml for the notification center (UC-S-11),
 * preferences (UC-S-12) and FCM device registration (UC-S-25). This app's
 * center is `app=driver` (driver audience + `all`).
 */

const APP = "driver";

export const NOTIFICATION_PAGE_SIZE = 20;

/** `GET /api/v1/notifications` — newest first, cursor-paginated. */
export function getNotifications(
  options: {
    category?: NotificationCategory | null;
    before?: string | null;
    size?: number;
  } = {},
): Promise<NotificationPage> {
  const query = [`app=${APP}`];
  if (options.category) query.push(`category=${options.category}`);
  if (options.before)
    query.push(`before=${encodeURIComponent(options.before)}`);
  query.push(`size=${options.size ?? NOTIFICATION_PAGE_SIZE}`);
  return authFetch<NotificationPage>(
    `/api/v1/notifications?${query.join("&")}`,
  );
}

/** `GET /api/v1/notifications/unread-count` — the badge. */
export async function getUnreadCount(): Promise<number> {
  const body = await authFetch<{ unread: number }>(
    `/api/v1/notifications/unread-count?app=${APP}`,
  );
  return body.unread;
}

/** `POST /api/v1/notifications/{id}/read` — idempotent. */
export function markNotificationRead(notificationId: string): Promise<void> {
  return authFetch<void>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "POST" },
  );
}

/** `POST /api/v1/notifications/read-all` — this client's center only. */
export function markAllNotificationsRead(): Promise<void> {
  return authFetch<void>(`/api/v1/notifications/read-all?app=${APP}`, {
    method: "POST",
  });
}

/** `GET /api/v1/notifications/preferences` — all six categories. */
export function getNotificationPreferences(): Promise<
  NotificationPreference[]
> {
  return authFetch<NotificationPreference[]>(
    "/api/v1/notifications/preferences",
  );
}

/** `PUT /api/v1/notifications/preferences` — partial; returns the full list. */
export function updateNotificationPreferences(
  changes: { category: NotificationCategory; enabled: boolean }[],
): Promise<NotificationPreference[]> {
  return authFetch<NotificationPreference[]>(
    "/api/v1/notifications/preferences",
    {
      method: "PUT",
      body: changes,
    },
  );
}

/** `PUT /api/v1/devices` — register / re-assign this device's FCM token. */
export function registerDevice(
  registration: DeviceRegistration,
): Promise<void> {
  return authFetch<void>("/api/v1/devices", {
    method: "PUT",
    body: registration,
  });
}

/** `DELETE /api/v1/devices/{token}` — idempotent unregister (logout). */
export function unregisterDevice(token: string): Promise<void> {
  return authFetch<void>(`/api/v1/devices/${encodeURIComponent(token)}`, {
    method: "DELETE",
  });
}

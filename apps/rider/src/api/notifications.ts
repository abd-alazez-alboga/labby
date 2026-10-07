import { apiFetch } from "./http-client";

/**
 * Client slice of the notifications contract (backend/docs/api/realtime-v1.yaml,
 * NTF-01..03, UC-S-11/12). The rider app always calls with `app=rider`: its
 * center lists the `rider` audience plus account-level `all` notifications.
 */

export const NOTIFICATION_APP = "rider";

export const NOTIFICATION_CATEGORIES = [
  "ride",
  "chat",
  "scheduled",
  "promotions",
  "account",
  "safety",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** `{screen, params}` from the contract's fixed deep-link catalog. */
export interface DeepLink {
  screen: string;
  params?: Record<string, string>;
}

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  /** Template key, e.g. `driver_application.approved`. */
  event: string;
  /** Already in the caller's current language. */
  title: string;
  body: string;
  link?: DeepLink | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  unread: number;
  nextCursor?: string | null;
}

export interface NotificationPreference {
  category: NotificationCategory;
  enabled: boolean;
  /** `ride` and `safety`: always enabled, the API refuses to disable them. */
  locked: boolean;
}

export const NOTIFICATION_PAGE_SIZE = 20;

/** `GET /api/v1/notifications` — newest first, cursor-paginated. */
export function listNotifications(
  options: {
    category?: NotificationCategory | null;
    before?: string | null;
    size?: number;
  } = {},
): Promise<NotificationPage> {
  const query = new URLSearchParams({ app: NOTIFICATION_APP });
  if (options.category) query.set("category", options.category);
  if (options.before) query.set("before", options.before);
  query.set("size", String(options.size ?? NOTIFICATION_PAGE_SIZE));
  return apiFetch<NotificationPage>(
    `/api/v1/notifications?${query.toString()}`,
    { auth: true },
  );
}

/** `GET /api/v1/notifications/unread-count` — the badge. */
export async function getUnreadCount(): Promise<number> {
  const result = await apiFetch<{ unread: number }>(
    `/api/v1/notifications/unread-count?app=${NOTIFICATION_APP}`,
    { auth: true },
  );
  return result.unread;
}

/** `POST /api/v1/notifications/{id}/read` — idempotent. */
export function markNotificationRead(notificationId: string): Promise<void> {
  return apiFetch<void>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    {
      method: "POST",
      auth: true,
    },
  );
}

/** `POST /api/v1/notifications/read-all` — this client's center only. */
export function markAllNotificationsRead(): Promise<void> {
  return apiFetch<void>(
    `/api/v1/notifications/read-all?app=${NOTIFICATION_APP}`,
    {
      method: "POST",
      auth: true,
    },
  );
}

/** `GET /api/v1/notifications/preferences` — all six categories. */
export function getNotificationPreferences(): Promise<
  NotificationPreference[]
> {
  return apiFetch<NotificationPreference[]>(
    "/api/v1/notifications/preferences",
    { auth: true },
  );
}

/** `PUT /api/v1/notifications/preferences` — partial; returns the full list. */
export function updateNotificationPreferences(
  changes: { category: NotificationCategory; enabled: boolean }[],
): Promise<NotificationPreference[]> {
  return apiFetch<NotificationPreference[]>(
    "/api/v1/notifications/preferences",
    {
      method: "PUT",
      auth: true,
      body: JSON.stringify(changes),
    },
  );
}

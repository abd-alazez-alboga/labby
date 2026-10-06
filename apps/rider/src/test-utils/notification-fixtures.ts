/** Contract-shaped fixtures for realtime-v1.yaml notifications. */
import type {
  AppNotification,
  NotificationCategory,
  NotificationPreference,
} from '../api/notifications';

export function notification(
  id: string,
  overrides: Partial<AppNotification> = {},
): AppNotification {
  return {
    id,
    category: 'account',
    event: 'account.updated',
    title: `Title ${id}`,
    body: `Body ${id}`,
    link: null,
    read: false,
    createdAt: '2026-10-06T08:30:00Z',
    ...overrides,
  };
}

export function preferences(
  overrides: Partial<Record<NotificationCategory, boolean>> = {},
): NotificationPreference[] {
  return (['ride', 'chat', 'scheduled', 'promotions', 'account', 'safety'] as const).map(
    (category) => ({
      category,
      enabled: overrides[category] ?? true,
      locked: category === 'ride' || category === 'safety',
    }),
  );
}

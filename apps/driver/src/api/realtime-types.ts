/**
 * Types mirroring the M6 realtime contract: backend/docs/api/realtime-v1.yaml
 * (notifications, preferences, devices, driver availability, location
 * samples). Import-free so every layer can depend on them without cycles.
 */

/** NTF-01 categories. `ride` and `safety` are locked (never mutable, NTF-02). */
export type NotificationCategory =
  | 'ride'
  | 'chat'
  | 'scheduled'
  | 'promotions'
  | 'account'
  | 'safety';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'ride',
  'chat',
  'scheduled',
  'promotions',
  'account',
  'safety',
];

/** `{screen, params}` from the fixed catalog (UC-S-11); see notifications/deep-links. */
export interface DeepLink {
  screen: string;
  params?: Record<string, string> | null;
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
  /** Unread count of this client's center. */
  unread: number;
  /** Absent/null on the last page. */
  nextCursor?: string | null;
}

export interface NotificationPreference {
  category: NotificationCategory;
  enabled: boolean;
  /** true for ride and safety: always enabled. */
  locked: boolean;
}

export type DevicePlatform = 'android' | 'ios' | 'web';

export interface DeviceRegistration {
  token: string;
  platform: DevicePlatform;
  app: 'driver';
}

/** UC-D-04 E1 reasons the GET returns when `canGoOnline` is false. */
export type CannotGoOnlineReason =
  | 'role_suspended'
  | 'not_approved'
  | 'no_active_vehicle';

export interface DriverAvailability {
  online: boolean;
  onlineSince?: string | null;
  canGoOnline: boolean;
  cannotGoOnlineReason?: CannotGoOnlineReason | null;
  /** The driver role's suspensionReason when `role_suspended`. */
  suspensionReason?: string | null;
  /** M8 balance floor (COM-03) — online but no offers; null before M8. */
  offersBlockedReason?: string | null;
  /** While online — a sample arrived within staleAfterSeconds (TRK-04). */
  streamHealthy?: boolean | null;
  streamIntervalSeconds: number;
  staleAfterSeconds: number;
}

/** One GPS sample (contract `LocationSample`). */
export interface LocationSample {
  lat: number;
  lng: number;
  headingDeg?: number | null;
  speedMps?: number | null;
  accuracyM?: number | null;
  /** Device fix time, ISO date-time. */
  recordedAt: string;
}

/** REST fallback batch limit (`samples.maxItems`). */
export const LOCATION_BATCH_MAX = 20;

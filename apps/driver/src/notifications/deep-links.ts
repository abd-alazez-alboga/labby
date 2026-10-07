import type { Href } from 'expo-router';

import { DOCUMENT_TYPES } from '../api/onboarding-types';
import type { DeepLink } from '../api/realtime-types';

/**
 * The single deep-link mapper (UC-S-11): catalog `{screen, params}` →
 * expo-router href, shared by the notification center and push taps.
 *
 * Catalog (realtime-v1.yaml): `driver_application`, `driver_documents`
 * (params: `documentType?`), `driver_vehicles`, `notifications`; M7+ add
 * `ride` and later screens. Unknown screens open the notification center.
 *
 * The target respects the driver gate (the stacks are guarded): an
 * applicant/suspended account has no home or vehicles screen, an active
 * driver no applicant tracker.
 */

export const NOTIFICATIONS_HREF = '/notifications' as const;

export interface DeepLinkContext {
  /** ACTIVE driver role (the in-app gate). */
  isDriver: boolean;
}

export function hrefForLink(
  link: DeepLink | null | undefined,
  context: DeepLinkContext,
): Href {
  switch (link?.screen) {
    case 'driver_application':
      // Approved drivers have no tracker any more — their home is the outcome.
      return context.isDriver ? '/' : '/apply-to-drive';
    case 'driver_documents': {
      const documentType = link.params?.documentType;
      return documentType && (DOCUMENT_TYPES as readonly string[]).includes(documentType)
        ? { pathname: '/documents', params: { documentType } }
        : '/documents';
    }
    case 'driver_vehicles':
      return context.isDriver ? '/vehicles' : NOTIFICATIONS_HREF;
    case 'notifications':
    default:
      return NOTIFICATIONS_HREF;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringParams(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) return null;
  const params: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') params[key] = item;
  }
  return params;
}

export interface PushPayload {
  link: DeepLink | null;
  notificationId: string | null;
}

/**
 * Reads the deep link out of a push's data payload. The contract
 * (realtime-v1.yaml, "Notification delivery") fixes the FCM data keys:
 * `notificationId`, `category`, `event` and, when the notification has a
 * deep link, flat `screen` + `params` (a JSON object encoded as a string).
 * A nested `link` (object or JSON string) is also tolerated, though the
 * backend does not send it.
 */
export function parsePushPayload(data: unknown): PushPayload {
  const record = asRecord(data) ?? {};
  const notificationId =
    typeof record.notificationId === 'string' ? record.notificationId : null;
  const nested = asRecord(record.link);
  const source = nested ?? record;
  const screen = typeof source.screen === 'string' ? source.screen : null;
  return {
    link: screen ? { screen, params: stringParams(source.params) } : null,
    notificationId,
  };
}

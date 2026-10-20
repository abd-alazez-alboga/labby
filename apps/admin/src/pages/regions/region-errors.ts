import type { TFunction } from 'i18next';

import { ApiError } from '../../api/client';
import type { ChecklistItemKey } from './completeness';

/** A translation key plus its interpolation values, rendered as `t(key, values)`. */
export interface UiMessage {
  key: string;
  values?: Record<string, string>;
}

/**
 * The backend's `details.missing` parts (RegionServiceImpl, English phrases)
 * → the activation checklist labels, so the list reads in the UI language.
 */
const MISSING_PARTS: Readonly<Record<string, ChecklistItemKey>> = {
  boundary: 'boundary',
  currency: 'currency',
  'emergency number': 'emergencyNumber',
  'at least one enabled service type': 'serviceType',
  'cancellation values': 'cancellation',
  'wait values': 'wait',
  'pickup-fee values': 'pickupFee',
  'commission tiers': 'commissionTiers',
  'incentive values': 'incentives',
  'suspension thresholds': 'suspensionThresholds',
  'surge cap': 'surgeCap',
};

/** "A, B and C" in the UI language (Arabic uses its own conjunction and comma). */
function listOf(items: readonly string[], language: string): string {
  try {
    return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(language.startsWith('ar') ? '، ' : ', ');
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function missingList(details: ApiError['details'], t: TFunction, language: string): string {
  const parts = stringList(details?.missing).map((part) => {
    const item = MISSING_PARTS[part];
    return item ? t(`regionDetail.activation.items.${item}`) : part;
  });
  return listOf(parts, language);
}

/**
 * The localized message for a regions-v1 409 by its machine code (review V1
 * W37): duplicate names, a boundary overlapping another region, surge zones a
 * boundary edit would leave outside (named), an active region losing
 * mandatory parts and an incomplete activation (listed), a zone outside the
 * boundary or a region without one. Null for anything else, so the caller
 * keeps its generic fallback.
 */
export function regionConflictMessage(
  error: unknown,
  t: TFunction,
  language: string,
): UiMessage | null {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null;
  }
  switch (error.code) {
    case 'region_name_taken':
      return { key: 'regions.errors.nameConflict' };
    case 'boundary_overlap':
      return { key: 'regionDetail.errors.boundaryOverlap' };
    case 'zones_outside_boundary': {
      const zones = stringList(error.details?.zoneNames);
      return zones.length > 0
        ? { key: 'regionDetail.errors.zonesOutside', values: { zones: listOf(zones, language) } }
        : { key: 'regionDetail.errors.zonesOutsideUnnamed' };
    }
    case 'active_region_incomplete':
      return {
        key: 'regionDetail.errors.activeIncomplete',
        values: { missing: missingList(error.details, t, language) },
      };
    case 'region_incomplete':
      return {
        key: 'regionDetail.activation.errors.incompleteParts',
        values: { missing: missingList(error.details, t, language) },
      };
    case 'surge_zone_name_taken':
      return { key: 'surgeZones.errors.nameTaken' };
    case 'zone_outside_boundary':
      return { key: 'surgeZones.errors.outsideBoundary' };
    case 'region_has_no_boundary':
      return { key: 'surgeZones.errors.noRegionBoundary' };
    case 'service_type_name_taken':
      return { key: 'serviceTypes.errors.nameConflict' };
    default:
      return null;
  }
}

/** One claimed scheduled ride blocking a service-type disable (UC-A-07 E1, W38). */
export interface ClaimedRide {
  rideId: string;
  scheduledAt: string;
  claimedDriverUserId: string | null;
}

/** The `details.rides` of a 409 `service_type_has_claimed_rides`, or null for any other error. */
export function claimedRidesOf(error: unknown): ClaimedRide[] | null {
  if (
    !(error instanceof ApiError) ||
    error.status !== 409 ||
    error.code !== 'service_type_has_claimed_rides'
  ) {
    return null;
  }
  const rides = error.details?.rides;
  if (!Array.isArray(rides)) {
    return [];
  }
  return rides.flatMap((ride: unknown) => {
    if (typeof ride !== 'object' || ride === null) {
      return [];
    }
    const { rideId, scheduledAt, claimedDriverUserId } = ride as Record<string, unknown>;
    return typeof rideId === 'string' && typeof scheduledAt === 'string'
      ? [
          {
            rideId,
            scheduledAt,
            claimedDriverUserId:
              typeof claimedDriverUserId === 'string' ? claimedDriverUserId : null,
          },
        ]
      : [];
  });
}

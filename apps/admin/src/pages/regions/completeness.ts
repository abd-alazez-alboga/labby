import type { Region, ServiceType } from '../../api/regions';

/**
 * The activation checklist, derived CLIENT-SIDE from the contract's
 * mandatory list (regions-v1.yaml, POST …/activate): name is always
 * present, so the checklist covers boundary, currency, emergency number,
 * >= 1 ENABLED service type, cancellation values, wait values, pickup-fee
 * values, commission tiers, incentive values, suspension thresholds and
 * the surge cap. It is a preview only — the server's 409 is the truth.
 */

export type ChecklistItemKey =
  | 'boundary'
  | 'currency'
  | 'emergencyNumber'
  | 'serviceType'
  | 'cancellation'
  | 'wait'
  | 'pickupFee'
  | 'commissionTiers'
  | 'incentives'
  | 'suspensionThresholds'
  | 'surgeCap';

export interface ChecklistItem {
  key: ChecklistItemKey;
  done: boolean;
}

function isSet(value: number | null | undefined): boolean {
  return value !== null && value !== undefined;
}

/**
 * Checklist state for a region as the SERVER last reported it. Without
 * pricing:view the service-type list is unavailable, so the region's
 * serviceTypeCount is the best available signal for that item.
 */
export function regionChecklist(
  region: Region,
  serviceTypes: ServiceType[] | null,
): ChecklistItem[] {
  const hasEnabledServiceType = serviceTypes
    ? serviceTypes.some((serviceType) => serviceType.enabled)
    : region.serviceTypeCount > 0;

  return [
    { key: 'boundary', done: region.boundary != null },
    { key: 'currency', done: region.currency != null && region.currency !== '' },
    {
      key: 'emergencyNumber',
      done: region.emergencyNumber != null && region.emergencyNumber !== '',
    },
    { key: 'serviceType', done: hasEnabledServiceType },
    {
      key: 'cancellation',
      done: isSet(region.cancellationGraceMin) && isSet(region.cancellationFee),
    },
    { key: 'wait', done: isSet(region.waitGraceMin) && isSet(region.waitPerMinRate) },
    { key: 'pickupFee', done: isSet(region.pickupFeeThresholdKm) && isSet(region.pickupFeePerKm) },
    { key: 'commissionTiers', done: (region.commissionTiers?.length ?? 0) > 0 },
    { key: 'incentives', done: region.incentiveValues != null },
    { key: 'suspensionThresholds', done: region.suspensionThresholds != null },
    { key: 'surgeCap', done: isSet(region.surgeCap) },
  ];
}

/** Whether every mandatory item is satisfied (the Activate button's gate). */
export function isComplete(items: ChecklistItem[]): boolean {
  return items.every((item) => item.done);
}

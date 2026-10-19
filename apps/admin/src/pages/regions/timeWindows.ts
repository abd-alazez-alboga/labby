/**
 * Shared helpers for the region-local weekly time windows (PRC-01
 * surcharge windows, DRV-08 peak-hour bonus windows): ISO days and the
 * contract's `format: time` strings.
 */

/** ISO day numbers, 1 = Monday … 7 = Sunday (the contract's convention). */
export const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** "07:30:00" (contract, format: time) -> "07:30" (input type=time). */
export function toTimeInput(value: string): string {
  return value.slice(0, 5);
}

/** "07:30" (input type=time) -> "07:30:00" (contract, format: time). */
export function toContractTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

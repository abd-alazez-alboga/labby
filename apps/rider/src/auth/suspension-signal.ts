/**
 * Suspension signal (M11, trust-v1.yaml USR-04..06): the http client emits
 * it whenever ANY call answers 403 `account_suspended` (whole account) or
 * `rider_suspended` (the rider role). The auth context listens, re-reads
 * the profile (`GET /users/me` stays reachable while suspended) and the
 * home screen swaps booking for the suspended screen.
 */
export type SuspensionCode = "account_suspended" | "rider_suspended";

export const SUSPENSION_CODES: readonly SuspensionCode[] = [
  "account_suspended",
  "rider_suspended",
];

type SuspensionListener = (code: SuspensionCode) => void;
const listeners = new Set<SuspensionListener>();

export function addSuspensionListener(listener: SuspensionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSuspension(code: SuspensionCode): void {
  for (const listener of [...listeners]) listener(code);
}

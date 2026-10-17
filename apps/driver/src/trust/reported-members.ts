/**
 * M12: the shared-ride members this driver reported during this app session
 * (`rideId/memberId`). The contract has no read of who a driver already
 * reported, so the member picker marks those sent here, and a 409
 * `report_already_submitted` marks the member too. In memory only — after a
 * restart the server's 409 still guards a second report.
 */
const reported = new Set<string>();

function key(rideId: string, memberId: string): string {
  return `${rideId}/${memberId}`;
}

export function markReported(rideId: string, memberId: string): void {
  reported.add(key(rideId, memberId));
}

export function isReported(rideId: string, memberId: string): boolean {
  return reported.has(key(rideId, memberId));
}

/** Tests only. */
export function clearReported(): void {
  reported.clear();
}

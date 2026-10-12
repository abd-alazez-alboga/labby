import type { AdminRideSummary } from '../../api/rides';

export interface LookupCandidate {
  userId: string;
  name: string;
  rider: boolean;
  driver: boolean;
  /** Matched rides this user appears on. */
  rides: number;
}

/** Distinct users on the matched rides, most-seen first. */
export function candidatesFromRides(
  rides: readonly AdminRideSummary[],
  driversOnly: boolean,
): LookupCandidate[] {
  const byId = new Map<string, LookupCandidate>();
  const seen = (userId: string, name: string, role: 'rider' | 'driver') => {
    const entry = byId.get(userId) ?? { userId, name, rider: false, driver: false, rides: 0 };
    entry[role] = true;
    entry.rides += 1;
    byId.set(userId, entry);
  };
  for (const ride of rides) {
    if (!driversOnly) {
      seen(ride.riderUserId, ride.riderName, 'rider');
    }
    if (ride.driverUserId) {
      seen(ride.driverUserId, ride.driverName ?? ride.driverUserId, 'driver');
    }
  }
  return [...byId.values()].sort((a, b) => b.rides - a.rides);
}

export function seenAsKey(candidate: LookupCandidate): string {
  if (candidate.rider && candidate.driver) {
    return 'money.lookup.seenAs.both';
  }
  return candidate.driver ? 'money.lookup.seenAs.driver' : 'money.lookup.seenAs.rider';
}

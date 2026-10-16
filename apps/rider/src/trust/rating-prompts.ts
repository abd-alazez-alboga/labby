/**
 * Post-ride rating prompt bookkeeping (M11, RATE-01, UC-S-17).
 *
 * The prompt is skippable; a skipped (or answered) ride is remembered on
 * this device so it is not prompted again — it stays reachable from ride
 * history until its window closes (`Ride.myRating`). After a cold start the
 * newest ride still pending (`GET /ratings/pending?as=rider`) that was
 * never prompted here opens the rating screen once.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect } from "react";

import { listPendingRatings } from "../api/trust";

export const PROMPTED_RATINGS_KEY = "labby.rider.rating-prompted";
/** Window is 7 days — older entries can be dropped. */
const MAX_REMEMBERED = 50;

async function readPrompted(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PROMPTED_RATINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/** Marks a ride's prompt as shown (skipped or answered). */
export async function markRatingPrompted(rideId: string): Promise<void> {
  try {
    const ids = await readPrompted();
    if (ids.includes(rideId)) return;
    const next = [rideId, ...ids].slice(0, MAX_REMEMBERED);
    await AsyncStorage.setItem(PROMPTED_RATINGS_KEY, JSON.stringify(next));
  } catch {
    // Best effort — at worst the prompt shows once more.
  }
}

/** The newest pending ride never prompted on this device, or null. */
export async function nextRatingPrompt(): Promise<string | null> {
  try {
    const pending = await listPendingRatings();
    const prompted = await readPrompted();
    return pending.find((item) => !prompted.includes(item.rideId))?.rideId ?? null;
  } catch {
    // Offline, suspended (403) … — the history keeps the entry.
    return null;
  }
}

/** Once per app process: the cold-start check. */
let checkedThisLaunch = false;

/**
 * The launch already showed a rating prompt (the post-ride one): the
 * cold-start check must not open a second one (at most one per launch).
 */
export function markColdStartChecked(): void {
  checkedThisLaunch = true;
}

/** Test hook: forget the once-per-launch flag. */
export function resetRatingPromptCheck(): void {
  checkedThisLaunch = false;
}

/**
 * On the first home mount of a launch, opens the rating screen for the
 * newest unprompted pending ride. `enabled` is false while a ride is on
 * screen or the whole account is suspended.
 */
export function useColdStartRatingPrompt(enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled || checkedThisLaunch) return;
    checkedThisLaunch = true;
    let live = true;
    void nextRatingPrompt().then((rideId) => {
      if (live && rideId) {
        void markRatingPrompted(rideId);
        router.push(`/rate/${encodeURIComponent(rideId)}` as never);
      }
    });
    return () => {
      live = false;
    };
  }, [enabled, router]);
}

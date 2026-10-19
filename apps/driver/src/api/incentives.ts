import { authFetch } from "./client";
import type { IncentiveProgress } from "./incentives-types";

/**
 * Client slice of incentives-v1.yaml for the driver app (M15-T3): the
 * weekly trip bonus, peak-hour bonus and rating reward progress in the
 * region the app is in, plus the recent awards.
 */

/** `GET /driver/incentives?regionId` — this week's live incentive progress. */
export function getIncentives(regionId: string): Promise<IncentiveProgress> {
  return authFetch<IncentiveProgress>(
    `/api/v1/driver/incentives?regionId=${encodeURIComponent(regionId)}`,
  );
}

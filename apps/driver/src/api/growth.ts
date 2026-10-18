import { authFetch } from "./client";
import type { ChallengeView, GamificationView } from "./growth-types";

/**
 * Client slice of growth-v1.yaml for the driver app (M13-T4): badges + level
 * and the region's challenges. The caller's side is always `driver` here.
 */

/** `GET /gamification/me?as=driver` — badges (full catalog) and the level ladder. */
export function getGamification(): Promise<GamificationView> {
  return authFetch<GamificationView>("/api/v1/gamification/me?as=driver");
}

/**
 * `GET /challenges?regionId&as=driver` — the region's challenges with my
 * progress: running first, then upcoming, then recently ended.
 */
export async function getChallenges(regionId: string): Promise<ChallengeView[]> {
  return (
    (await authFetch<ChallengeView[] | null>(
      `/api/v1/challenges?regionId=${encodeURIComponent(regionId)}&as=driver`,
    )) ?? []
  );
}

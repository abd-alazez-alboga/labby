/**
 * In-app signal that a rating was stored (M11): screens that show a ride's
 * own rating state (ride history) update without re-reading it.
 */
type RatingListener = (rideId: string, score: number) => void;
const listeners = new Set<RatingListener>();

export function addRatingSubmittedListener(listener: RatingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitRatingSubmitted(rideId: string, score: number): void {
  for (const listener of [...listeners]) listener(rideId, score);
}

/**
 * Which ride's chat thread is on screen right now (owner ruling 2026-10-14):
 * every chat message also arrives as a push, even while the app is open, so
 * the foreground handler (push.ts) hides the banner ONLY when that ride's
 * chat screen is focused — the message is already landing live there. The
 * chat screen sets it on focus and clears it on blur/unmount.
 */

let openRideId: string | null = null;

/** The chat screen gained focus for `rideId`; returns the matching clear. */
export function setOpenChatRideId(rideId: string): () => void {
  openRideId = rideId;
  return () => {
    // A newer focus (another thread) already took over — leave it.
    if (openRideId === rideId) openRideId = null;
  };
}

/** The rideId whose chat is focused, or null. */
export function openChatRideId(): string | null {
  return openRideId;
}

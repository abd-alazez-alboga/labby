/**
 * Which chat thread is on screen right now (owner ruling 2026-10-14):
 * every chat message also arrives as a push, even while the app is open, so
 * the foreground handler (push.ts) hides the banner ONLY when that thread's
 * chat screen is focused — the message is already landing live there. The
 * chat screen sets it on focus and clears it on blur/unmount. M12 (review
 * H5): a shared ride has one thread per member, so the thread is the ride
 * PLUS the member — another member's message still shows its banner.
 */

export interface OpenChatThread {
  rideId: string;
  /** The shared-ride member whose private thread is open, else null. */
  memberId: string | null;
}

let open: OpenChatThread | null = null;

/** The chat screen gained focus for a thread; returns the matching clear. */
export function setOpenChatRideId(
  rideId: string,
  memberId: string | null = null,
): () => void {
  const mine: OpenChatThread = { rideId, memberId };
  open = mine;
  return () => {
    // A newer focus (another thread) already took over — leave it.
    if (open === mine) open = null;
  };
}

/** The focused thread, or null. */
export function openChatThread(): OpenChatThread | null {
  return open;
}

/** The rideId whose chat is focused, or null. */
export function openChatRideId(): string | null {
  return open?.rideId ?? null;
}

/**
 * Best-effort cleanup that must run while the session is still alive, right
 * before a user-initiated sign-out revokes it: unregistering this device's
 * push token (`DELETE /devices/{token}` needs a live session) and taking an
 * online driver offline. Features register a task while mounted; the
 * AuthProvider runs them all in parallel, each capped by a timeout so a
 * hanging network can never block signing out.
 *
 * A FORCED sign-out (refresh token rejected) cannot run them — the session
 * is already dead server-side; the next login re-assigns the device token.
 */

export type SignOutTask = () => Promise<void>;

/** Per-task cap; sign-out continues regardless after this. */
export const SIGN_OUT_TASK_TIMEOUT_MS = 4000;

const tasks = new Set<SignOutTask>();

export function addSignOutTask(task: SignOutTask): () => void {
  tasks.add(task);
  return () => {
    tasks.delete(task);
  };
}

function withTimeout(task: SignOutTask): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, SIGN_OUT_TASK_TIMEOUT_MS);
    let run: Promise<void>;
    try {
      run = task();
    } catch {
      run = Promise.resolve();
    }
    run
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

/** Runs every registered task; never rejects. */
export async function runSignOutTasks(): Promise<void> {
  await Promise.all([...tasks].map(withTimeout));
}

/**
 * Serializes every runtime-permission PROMPT in the app.
 *
 * Android shows one permission dialog at a time: when two requests fire
 * together (location from the region resolver/home map and notifications from
 * push registration, both right after sign-in) one of them is silently
 * dropped. Every prompting call goes through `runExclusive`, which starts the
 * next prompt only once the previous one has settled. Permission READS do not
 * prompt and must not queue.
 */
let tail: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // A failed prompt must not block the ones queued after it.
  tail = run.catch(() => undefined);
  return run;
}

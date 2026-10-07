/**
 * Android shows ONE runtime-permission dialog at a time: a second request
 * made while another dialog is up is silently dropped. After sign-in the
 * location request (RegionProvider) and the notification request (push)
 * fire together, so every PROMPTING permission call goes through this
 * module-level queue and runs strictly after the previous one settles.
 * Plain reads (get*PermissionsAsync) never show a dialog and skip it.
 */
let tail: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // A failed prompt must not block the ones queued behind it.
  tail = run.catch(() => undefined);
  return run;
}

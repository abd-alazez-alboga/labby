/**
 * Framework-free toast queue (the state behind <ToastProvider>). Kept pure
 * so ordering, de-duplication and the visible cap are unit-testable.
 *
 * Tones: `info` / `success` / `warning` / `error` auto-dismiss; `critical`
 * is sticky (only an explicit acknowledgement removes it) and is never
 * evicted by the cap — it is the variant M10's SOS alerts use (UC-S-16).
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error' | 'critical';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  /** Stable id: showing a toast with an id already on screen replaces it (no duplicates). */
  id?: string;
  tone?: ToastTone;
  title?: string;
  message: string;
  action?: ToastAction;
  /** Auto-dismiss delay; `null` = sticky. Ignored for `critical` (always sticky). */
  durationMs?: number | null;
}

export interface Toast {
  id: string;
  tone: ToastTone;
  title?: string;
  message: string;
  action?: ToastAction;
  /** null = sticky. */
  durationMs: number | null;
}

/** Default auto-dismiss delays — long enough to read twice (WCAG 2.2.1; hover/focus pauses). */
export const DEFAULT_DURATION_MS: Record<Exclude<ToastTone, 'critical'>, number> = {
  info: 6_000,
  success: 6_000,
  warning: 10_000,
  error: 10_000,
};

/** At most this many non-critical toasts at once; the oldest is evicted first. */
export const MAX_NON_CRITICAL = 4;

/** Tones announced assertively (interrupting the screen reader). */
export function isAssertive(tone: ToastTone): boolean {
  return tone === 'error' || tone === 'critical';
}

export function normalizeToast(input: ToastInput, id: string): Toast {
  const tone = input.tone ?? 'info';
  const durationMs =
    tone === 'critical'
      ? null
      : input.durationMs === undefined
        ? DEFAULT_DURATION_MS[tone]
        : input.durationMs;
  return {
    id,
    tone,
    title: input.title,
    message: input.message,
    action: input.action,
    durationMs,
  };
}

/** Adds (or replaces, by id) a toast, then evicts the oldest non-critical ones over the cap. */
export function addToast(queue: readonly Toast[], toast: Toast): Toast[] {
  const existing = queue.findIndex((item) => item.id === toast.id);
  const next =
    existing >= 0
      ? queue.map((item, index) => (index === existing ? toast : item))
      : [...queue, toast];
  let overflow = next.filter((item) => item.tone !== 'critical').length - MAX_NON_CRITICAL;
  if (overflow <= 0) {
    return next;
  }
  return next.filter((item) => {
    if (overflow > 0 && item.tone !== 'critical') {
      overflow -= 1;
      return false;
    }
    return true;
  });
}

export function removeToast(queue: readonly Toast[], id: string): Toast[] {
  return queue.filter((item) => item.id !== id);
}

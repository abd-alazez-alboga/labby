import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  addToast,
  isAssertive,
  normalizeToast,
  removeToast,
  type Toast,
  type ToastInput,
} from './toast-queue';

export interface ToastApi {
  /** Shows a toast and returns its id (pass `id` to replace one already on screen). */
  show(input: ToastInput): string;
  dismiss(id: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * App-wide toast/alert infrastructure — the shared primitive for transient
 * feedback (saved, failed, a push arrived) and for sticky critical alerts
 * (M10 SOS). Two live regions exist from the first render so screen readers
 * announce reliably: polite for info/success/warning, assertive for
 * error/critical. (Plain `aria-live` containers, not `role=alert`, so the
 * idle regions never collide with a page's own inline alerts.) Toasts sit
 * at the inline-end bottom corner, so they mirror in RTL with the shell.
 *
 * Page-level banners (`.banner`) stay the pattern for state that belongs to
 * a page (load failures, validation); toasts are for events.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((queue) => removeToast(queue, id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = input.id ?? `toast-${counter.current}`;
    setToasts((queue) => addToast(queue, normalizeToast(input, id)));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** Typed access to the toast API. */
// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (value === null) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return value;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  const assertive = toasts.filter((toast) => isAssertive(toast.tone));
  const polite = toasts.filter((toast) => !isAssertive(toast.tone));

  return (
    <section className="toast-viewport" aria-label={t('toast.regionLabel')}>
      <div className="toast-stack" aria-live="assertive" aria-relevant="additions">
        {assertive.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {polite.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </section>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const critical = toast.tone === 'critical';

  // Auto-dismiss, paused while hovered or focused (WCAG 2.2.1 timing adjustable).
  useEffect(() => {
    if (remaining.current === null || paused) {
      return;
    }
    const startedAt = Date.now();
    const handle = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(handle);
      if (remaining.current !== null) {
        remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
      }
    };
  }, [paused, onDismiss, toast.id]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Escape dismisses a transient toast; a critical alert needs its explicit button.
    if (event.key === 'Escape' && !critical) {
      event.stopPropagation();
      onDismiss(toast.id);
    }
  }

  return (
    <div
      className={`toast toast--${toast.tone}`}
      data-testid="toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="toast__content">
        <span className="visually-hidden">{t(`toast.tone.${toast.tone}`)}</span>
        {toast.title ? <p className="toast__title">{toast.title}</p> : null}
        <p className="toast__message">{toast.message}</p>
        {toast.action || critical ? (
          <div className="toast__actions">
            {toast.action ? (
              <button
                type="button"
                className="btn btn--small toast__action"
                onClick={() => {
                  toast.action?.onClick();
                  onDismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            {critical ? (
              <button
                type="button"
                className="btn btn--small toast__action"
                onClick={() => onDismiss(toast.id)}
              >
                {t('toast.acknowledge')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {critical ? null : (
        <button
          type="button"
          className="toast__close"
          aria-label={t('toast.dismiss')}
          onClick={() => onDismiss(toast.id)}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

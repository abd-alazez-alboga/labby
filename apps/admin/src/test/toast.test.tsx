import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import { addToast, MAX_NON_CRITICAL, normalizeToast, removeToast } from '../toast/toast-queue';
import { ToastProvider, useToast } from '../toast/ToastProvider';
import type { ToastInput } from '../toast/toast-queue';

/** A page that fires the toasts a test asks for. */
function Harness({ toasts }: { toasts: Record<string, ToastInput> }) {
  const { show } = useToast();
  return (
    <div>
      {Object.entries(toasts).map(([label, input]) => (
        <button key={label} type="button" onClick={() => show(input)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function renderToasts(toasts: Record<string, ToastInput>) {
  return render(
    <ToastProvider>
      <Harness toasts={toasts} />
    </ToastProvider>,
  );
}

function politeRegion(): HTMLElement {
  return document.querySelector('[aria-live="polite"]') as HTMLElement;
}

function assertiveRegion(): HTMLElement {
  return document.querySelector('[aria-live="assertive"]') as HTMLElement;
}

describe('toast queue (pure)', () => {
  it('applies tone defaults: critical is always sticky, others auto-dismiss', () => {
    expect(normalizeToast({ message: 'x' }, 'a')).toMatchObject({ tone: 'info', durationMs: 6000 });
    expect(normalizeToast({ message: 'x', tone: 'error' }, 'a').durationMs).toBe(10000);
    expect(normalizeToast({ message: 'x', tone: 'info', durationMs: null }, 'a').durationMs).toBe(
      null,
    );
    expect(
      normalizeToast({ message: 'x', tone: 'critical', durationMs: 1000 }, 'a').durationMs,
    ).toBeNull();
  });

  it('caps non-critical toasts (oldest evicted) and never evicts a critical one', () => {
    let queue = addToast([], normalizeToast({ message: 'sos', tone: 'critical' }, 'sos'));
    for (let i = 1; i <= MAX_NON_CRITICAL + 2; i += 1) {
      queue = addToast(queue, normalizeToast({ message: `m${i}` }, `t${i}`));
    }
    expect(queue.map((toast) => toast.id)).toEqual(['sos', 't3', 't4', 't5', 't6']);
  });

  it('replaces a toast with the same id instead of duplicating it', () => {
    let queue = addToast([], normalizeToast({ message: 'one' }, 'same'));
    queue = addToast(queue, normalizeToast({ message: 'two' }, 'same'));
    expect(queue).toHaveLength(1);
    expect(queue[0].message).toBe('two');
    expect(removeToast(queue, 'same')).toEqual([]);
  });
});

describe('<ToastProvider>', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps both live regions mounted and routes tones to polite vs assertive', () => {
    renderToasts({
      info: { message: 'Saved quietly', tone: 'success' },
      error: { message: 'It broke', tone: 'error' },
    });
    // Regions exist before any toast, so the first announcement is not lost.
    expect(politeRegion()).toBeEmptyDOMElement();
    expect(assertiveRegion()).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    fireEvent.click(screen.getByRole('button', { name: 'error' }));

    expect(within(politeRegion()).getByText('Saved quietly')).toBeInTheDocument();
    expect(within(politeRegion()).getByText('Success:')).toBeInTheDocument();
    expect(within(assertiveRegion()).getByText('It broke')).toBeInTheDocument();
    expect(within(assertiveRegion()).getByText('Error:')).toBeInTheDocument();
  });

  it('auto-dismisses after its duration, pausing while hovered', () => {
    renderToasts({ info: { message: 'Heads up', tone: 'info' } });
    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    const toast = screen.getByText('Heads up').closest('.toast') as HTMLElement;

    act(() => vi.advanceTimersByTime(4000));
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText('Heads up')).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Heads up')).not.toBeInTheDocument();
  });

  it('dismisses with the close button or Escape (keyboard)', () => {
    renderToasts({
      first: { message: 'First toast' },
      second: { message: 'Second toast' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'first' }));
    fireEvent.click(screen.getByRole('button', { name: 'second' }));

    const first = screen.getByText('First toast').closest('.toast') as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('First toast')).not.toBeInTheDocument();

    const second = screen.getByText('Second toast').closest('.toast') as HTMLElement;
    const close = within(second).getByRole('button', { name: 'Dismiss' });
    act(() => close.focus());
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByText('Second toast')).not.toBeInTheDocument();
  });

  it('keeps a critical alert until it is explicitly acknowledged', () => {
    renderToasts({
      sos: { tone: 'critical', title: 'SOS', message: 'Rider pressed SOS', durationMs: 1000 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sos' }));
    const alert = within(assertiveRegion()).getByText('Rider pressed SOS').closest('.toast')!;
    expect(within(alert as HTMLElement).getByText('Critical alert:')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(10 * 60_000));
    // No close (×) shortcut and Escape does nothing — acknowledgement is deliberate.
    expect(within(alert as HTMLElement).queryByRole('button', { name: 'Dismiss' })).toBeNull();
    const acknowledge = within(alert as HTMLElement).getByRole('button', { name: 'Acknowledge' });
    fireEvent.keyDown(acknowledge, { key: 'Escape' });
    expect(screen.getByText('Rider pressed SOS')).toBeInTheDocument();

    fireEvent.click(acknowledge);
    expect(screen.queryByText('Rider pressed SOS')).not.toBeInTheDocument();
  });

  it('runs the action and dismisses the toast', () => {
    const onClick = vi.fn();
    renderToasts({ act: { message: 'New thing', action: { label: 'Open it', onClick } } });
    fireEvent.click(screen.getByRole('button', { name: 'act' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('New thing')).not.toBeInTheDocument();
  });

  it('caps the visible stack at the newest non-critical toasts', () => {
    const toasts: Record<string, ToastInput> = {};
    for (let i = 1; i <= MAX_NON_CRITICAL + 1; i += 1) {
      toasts[`t${i}`] = { message: `Toast ${i}`, durationMs: null };
    }
    renderToasts(toasts);
    for (let i = 1; i <= MAX_NON_CRITICAL + 1; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: `t${i}` }));
    }
    expect(screen.getAllByTestId('toast')).toHaveLength(MAX_NON_CRITICAL);
    expect(screen.queryByText('Toast 1')).not.toBeInTheDocument();
    expect(screen.getByText(`Toast ${MAX_NON_CRITICAL + 1}`)).toBeInTheDocument();
  });

  it('speaks Arabic in RTL', async () => {
    await act(() => i18n.changeLanguage('ar'));
    renderToasts({ info: { message: 'رسالة' } });
    fireEvent.click(screen.getByRole('button', { name: 'info' }));

    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('region', { name: 'التنبيهات' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeInTheDocument();
    await act(() => i18n.changeLanguage('en'));
  });
});

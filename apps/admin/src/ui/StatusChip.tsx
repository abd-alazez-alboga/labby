import type { ReactNode } from 'react';

export type ChipTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

/**
 * Status chip (design system 2026-10-07): 13/700, tone ground + tone text.
 * Status colours appear only in chips and banners, never as accents.
 */
export function StatusChip({
  tone = 'neutral',
  strike = false,
  children,
}: {
  tone?: ChipTone;
  /** Superseded items: muted + struck through. */
  strike?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`chip chip--${tone}${strike ? ' chip--strike' : ''}`} data-tone={tone}>
      {children}
    </span>
  );
}

import type { ReactNode } from 'react';

/**
 * Two-column review layout: the reviewable content, and a right-hand
 * DecisionPanel aside (left in RTL) holding the page's decision controls —
 * primary action first, then outline, then destructive text, then history.
 */
export function ReviewLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="review-layout">
      <div className="review-layout__main">{children}</div>
      {aside}
    </div>
  );
}

export function DecisionPanel({
  title,
  children,
  label,
}: {
  title: ReactNode;
  children: ReactNode;
  label?: string;
}) {
  return (
    <aside className="decision-panel" aria-label={label}>
      <h2 className="decision-panel__title">{title}</h2>
      {children}
    </aside>
  );
}

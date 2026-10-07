import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** "Back to …" link with a chevron that flips in RTL. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="back-link" to={to}>
      <svg
        className="back-link__chevron"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {children}
    </Link>
  );
}

/**
 * Page title block: h1 30/800 + muted 15 px description, with the page's
 * primary action at the inline end (mirrors in RTL).
 */
export function PageHeader({
  title,
  description,
  actions,
  leading,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional element before the title (e.g. an avatar). */
  leading?: ReactNode;
  /** Optional inline element after the title (e.g. a status chip). */
  meta?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__main">
        {leading}
        <div className="page-header__text">
          <h1 className="page-header__title">{title}</h1>
          {description ? <div className="page-header__description">{description}</div> : null}
        </div>
        {meta ? <div className="page-header__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

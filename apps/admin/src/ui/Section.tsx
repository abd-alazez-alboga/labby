import type { ReactNode } from 'react';

/**
 * White card section (radius 16, `line` border) with an 18/800 heading and
 * optional actions at the inline end. Renders a <section> so tests and
 * assistive tech can scope to it by its heading.
 */
export function Section({
  title,
  actions,
  children,
  className,
  headingLevel = 2,
  ariaLabel,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
  ariaLabel?: string;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      className={className ? `card section ${className}` : 'card section'}
      aria-label={ariaLabel}
    >
      {title || actions ? (
        <div className="section__head">
          {title ? <Heading className="section__heading">{title}</Heading> : null}
          {actions ? <div className="section__actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

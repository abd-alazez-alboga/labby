import type { ReactNode } from 'react';

/**
 * Table card: white, radius 16, `line` border; optional 18/800 title row with
 * actions, the table itself (horizontally scrollable on narrow screens), a
 * plain empty state instead of an empty table, and an optional footer.
 * Children are the table's <thead>/<tbody>.
 */
export function DataTable({
  title,
  actions,
  empty,
  isEmpty = false,
  footer,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  /** What to show instead of the table when `isEmpty`. */
  empty?: ReactNode;
  isEmpty?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="table-card">
      {actions ? (
        <div className="table-card__head">
          {title ? <h2 className="table-card__title">{title}</h2> : null}
          <div className="table-card__actions">{actions}</div>
        </div>
      ) : title ? (
        // Without actions the heading is followed directly by the table.
        <h2 className="table-card__title table-card__title--solo">{title}</h2>
      ) : null}
      {isEmpty ? (
        <div className="table-card__empty">{empty}</div>
      ) : (
        <div className="table-card__scroll">
          <table className="table">{children}</table>
        </div>
      )}
      {footer ? <div className="table-card__footer">{footer}</div> : null}
    </section>
  );
}

/** Footer pager: a status line plus outlined previous/next buttons. */
export function TablePager({
  status,
  previousLabel,
  nextLabel,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: {
  status: ReactNode;
  previousLabel: string;
  nextLabel: string;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="pager">
      <span className="pager__status">{status}</span>
      <span className="pager__buttons">
        <button
          className="btn btn--small"
          type="button"
          disabled={!canPrevious}
          onClick={onPrevious}
        >
          {previousLabel}
        </button>
        <button className="btn btn--small" type="button" disabled={!canNext} onClick={onNext}>
          {nextLabel}
        </button>
      </span>
    </div>
  );
}

import type { ReactNode } from 'react';

/** White KPI card: 13/700 muted label over a 30/800 value, optional hint. */
export function KpiTile({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'default' | 'warning' | 'danger';
  /** Small muted caption under the value (e.g. a due's origin). */
  hint?: ReactNode;
}) {
  return (
    <div className={tone === 'default' ? 'kpi' : `kpi kpi--${tone}`}>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
      {hint ? <span className="kpi__hint">{hint}</span> : null}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="kpi-row">{children}</div>;
}

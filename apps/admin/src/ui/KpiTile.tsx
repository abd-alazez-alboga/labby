import type { ReactNode } from 'react';

/** White KPI card: 13/700 muted label over a 30/800 value. */
export function KpiTile({
  label,
  value,
  tone = 'default',
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className={tone === 'danger' ? 'kpi kpi--danger' : 'kpi'}>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="kpi-row">{children}</div>;
}

import { useTranslation } from 'react-i18next';

import { useConfig } from '../config/ConfigContext';
import { PageHeader } from '../ui';

/**
 * Dashboard: a clean welcome until real dashboard content arrives in a later
 * milestone (no KPI tiles — the page has no numbers to show yet).
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const config = useConfig();

  return (
    <section className="page">
      <PageHeader title={t('dashboard.title')} description={t('dashboard.placeholder')} />
      {config.environment ? (
        <div>
          <span className="chip chip--neutral">{config.environment}</span>
        </div>
      ) : null}
    </section>
  );
}

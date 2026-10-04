import { useTranslation } from 'react-i18next';

import { useConfig } from '../config/ConfigContext';

/** Placeholder dashboard page — real content arrives in later milestones. */
export default function DashboardPage() {
  const { t } = useTranslation();
  const config = useConfig();

  return (
    <section>
      <h2 className="page__title">{t('dashboard.title')}</h2>
      <div className="card">
        <p className="page__subtitle">{t('dashboard.placeholder')}</p>
        {config.environment ? <p className="page__subtitle">{config.environment}</p> : null}
      </div>
    </section>
  );
}

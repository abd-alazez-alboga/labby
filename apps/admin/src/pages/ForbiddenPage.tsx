import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/** Shown by RequirePermission when the admin lacks a route's permission. */
export default function ForbiddenPage() {
  const { t } = useTranslation();

  return (
    <section className="status-page">
      <span className="status-page__code">403</span>
      <h1 className="status-page__title">{t('forbidden.title')}</h1>
      <p className="status-page__body">{t('forbidden.body')}</p>
      <Link className="btn btn--primary" to="/">
        {t('forbidden.backToDashboard')}
      </Link>
    </section>
  );
}

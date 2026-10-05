import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/** Shown by RequirePermission when the admin lacks a route's permission. */
export default function ForbiddenPage() {
  const { t } = useTranslation();

  return (
    <section>
      <h1 className="page__title">{t('forbidden.title')}</h1>
      <p className="page__subtitle">{t('forbidden.body')}</p>
      <Link to="/">{t('forbidden.backToDashboard')}</Link>
    </section>
  );
}

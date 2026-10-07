import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <section className="status-page">
      <span className="status-page__code">404</span>
      <h2 className="status-page__title">{t('notFound.title')}</h2>
      <p className="status-page__body">{t('notFound.body')}</p>
      <Link className="btn btn--primary" to="/">
        {t('notFound.backToDashboard')}
      </Link>
    </section>
  );
}

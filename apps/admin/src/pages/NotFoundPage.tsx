import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <section>
      <h2 className="page__title">{t('notFound.title')}</h2>
      <p className="page__subtitle">{t('notFound.body')}</p>
      <Link to="/">{t('notFound.backToDashboard')}</Link>
    </section>
  );
}

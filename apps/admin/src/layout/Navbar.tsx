import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from './LanguageSwitcher';

/** Top navbar placeholder: app title + language switcher. */
export function Navbar() {
  const { t } = useTranslation();

  return (
    <header className="navbar">
      <h1 className="navbar__title">{t('app.title')}</h1>
      <LanguageSwitcher />
    </header>
  );
}

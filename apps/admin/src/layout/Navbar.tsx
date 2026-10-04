import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';

/** Top navbar: app title, the signed-in admin's name, language switch, logout. */
export function Navbar() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="navbar">
      <h1 className="navbar__title">{t('app.title')}</h1>
      <div className="navbar__actions">
        {user ? <span className="navbar__user">{user.name}</span> : null}
        <LanguageSwitcher />
        {user ? (
          <button
            type="button"
            className="btn"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            {t('auth.logout')}
          </button>
        ) : null}
      </div>
    </header>
  );
}

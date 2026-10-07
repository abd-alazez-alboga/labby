import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/AuthContext';
import { NotificationBell } from '../notifications/NotificationBell';
import { Avatar } from '../ui';
import { LanguageSwitcher } from './LanguageSwitcher';

/**
 * Top bar (68 px, white): notification bell (unread badge), language
 * switch, the signed-in admin (avatar + name) and sign out. The canvas'
 * search field is intentionally not rendered: there is no search endpoint
 * yet, and a dead input would mislead.
 */
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
    <header className="topbar">
      <span className="topbar__spacer" />
      {user ? <NotificationBell /> : null}
      <LanguageSwitcher />
      {user ? (
        <span className="topbar__user">
          <Avatar name={user.name} />
          <span dir="auto">{user.name}</span>
        </span>
      ) : null}
      {user ? (
        <button
          type="button"
          className="btn btn--small"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
        >
          {t('auth.logout')}
        </button>
      ) : null}
    </header>
  );
}

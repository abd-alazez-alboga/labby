import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/AuthContext';
import type { AccessBlock } from '../auth/permissions';
import { BrandMark } from '../layout/BrandMark';
import { Avatar } from '../ui';
import { formatDay } from './money/money-format';

/**
 * USR-06 / V1 audit W5 + I31 (board V1FAdminAccessDeactivated): a signed-in
 * admin whose admin access is deactivated — or whose whole account is
 * suspended — sees this screen in place of the whole dashboard (no sidebar,
 * no empty pages, no "No access"): the note recorded with the deactivation
 * and its date, and Log out.
 */
export default function AccessDeactivatedPage({ block }: { block: AccessBlock }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const account = block.kind === 'account';
  const when = block.since ? formatDay(block.since, i18n.language) : null;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="access-blocked">
      <header className="access-blocked__bar">
        <span className="brand access-blocked__brand">
          <BrandMark />
          <span className="brand__name">{t('app.title')}</span>
        </span>
        {user ? (
          <span className="access-blocked__user">
            <Avatar name={user.name} />
            <span className="access-blocked__who">
              <span className="access-blocked__name" dir="auto">
                {user.name}
              </span>
              <span className="access-blocked__phone" dir="ltr">
                {user.phone}
              </span>
            </span>
          </span>
        ) : null}
      </header>
      <main className="access-blocked__main">
        <section className="access-blocked__card" aria-labelledby="access-blocked-title">
          <span className="access-blocked__icon" aria-hidden="true">
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
            </svg>
          </span>
          <div className="access-blocked__text">
            <h1 id="access-blocked-title" className="access-blocked__title">
              {t(account ? 'accessBlocked.account.title' : 'accessBlocked.admin.title')}
            </h1>
            <p className="access-blocked__body">
              {t(account ? 'accessBlocked.account.body' : 'accessBlocked.admin.body')}
            </p>
          </div>
          <div className="access-blocked__note">
            <span className="access-blocked__note-label">
              {when
                ? t(account ? 'accessBlocked.account.noteLabel' : 'accessBlocked.admin.noteLabel', {
                    date: when,
                  })
                : t(
                    account
                      ? 'accessBlocked.account.noteLabelUndated'
                      : 'accessBlocked.admin.noteLabelUndated',
                  )}
            </span>
            <span className="access-blocked__note-text" dir="auto">
              {block.note
                ? t('accessBlocked.quoted', { note: block.note })
                : t('accessBlocked.noNote')}
            </span>
          </div>
          {account ? null : <p className="access-blocked__hint">{t('accessBlocked.admin.hint')}</p>}
          <button
            className="btn btn--primary btn--lg"
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            {t('auth.logout')}
          </button>
        </section>
      </main>
    </div>
  );
}

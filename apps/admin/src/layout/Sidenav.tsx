import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { ApiStatus } from './ApiStatus';

/**
 * Sidenav placeholder with the Labby brand.
 * Logo files under public/images/ are copies — the source of truth is
 * /assets/images at the monorepo root.
 */
export function Sidenav() {
  const { t } = useTranslation();

  return (
    <aside className="sidenav">
      <div className="sidenav__brand">
        <img className="sidenav__logo" src="/images/labby-logo-white.png" alt="Labby" />
      </div>
      <nav className="sidenav__nav">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            isActive ? 'sidenav__link sidenav__link--active' : 'sidenav__link'
          }
        >
          {t('nav.dashboard')}
        </NavLink>
      </nav>
      <div className="sidenav__footer">
        <ApiStatus />
      </div>
    </aside>
  );
}

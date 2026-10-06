import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { usePermissions } from '../auth/usePermissions';
import { ApiStatus } from './ApiStatus';

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'sidenav__link sidenav__link--active' : 'sidenav__link';
}

/**
 * Sidenav with the Labby brand. Menu entries are gated by the same
 * permission strings the backend enforces (RBAC-03) — an admin only sees
 * what their role allows.
 * Logo files under public/images/ are copies — the source of truth is
 * /assets/images at the monorepo root.
 */
export function Sidenav() {
  const { t } = useTranslation();
  const { can } = usePermissions();

  return (
    <aside className="sidenav">
      <div className="sidenav__brand">
        <img className="sidenav__logo" src="/images/labby-logo-white.png" alt="Labby" />
      </div>
      <nav className="sidenav__nav">
        <NavLink to="/" end className={linkClass}>
          {t('nav.dashboard')}
        </NavLink>
        {can('regions:view') ? (
          <NavLink to="/regions" className={linkClass}>
            {t('nav.regions')}
          </NavLink>
        ) : null}
        {can('driver-review:view') ? (
          <>
            <NavLink to="/driver-applications" className={linkClass}>
              {t('nav.driverApplications')}
            </NavLink>
            <NavLink to="/vehicle-reviews" className={linkClass}>
              {t('nav.vehicleReviews')}
            </NavLink>
            <NavLink to="/document-expiries" className={linkClass}>
              {t('nav.documentExpiries')}
            </NavLink>
          </>
        ) : null}
        {can('admins:view') ? (
          <NavLink to="/admins" className={linkClass}>
            {t('nav.admins')}
          </NavLink>
        ) : null}
        {can('roles:view') ? (
          <NavLink to="/roles" className={linkClass}>
            {t('nav.roles')}
          </NavLink>
        ) : null}
        {can('audit:view') ? (
          <NavLink to="/audit-log" className={linkClass}>
            {t('nav.auditLog')}
          </NavLink>
        ) : null}
      </nav>
      <div className="sidenav__footer">
        <ApiStatus />
      </div>
    </aside>
  );
}

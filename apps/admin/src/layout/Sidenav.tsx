import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { usePermissions } from '../auth/usePermissions';
import { ApiStatus } from './ApiStatus';
import { BrandMark } from './BrandMark';

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'sidenav__link sidenav__link--active' : 'sidenav__link';
}

/**
 * White 248 px sidebar (design system 2026-10-07): brand mark, the
 * operations pages, a divider, then the RBAC/admin pages. Menu entries are
 * gated by the same permission strings the backend enforces (RBAC-03) — an
 * admin only sees what their role allows. It sits at the inline start, so it
 * moves to the right in Arabic.
 */
export function Sidenav() {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const showAdminGroup = can('admins:view') || can('roles:view') || can('audit:view');

  return (
    <aside className="sidenav">
      <div className="brand">
        <BrandMark />
        <h1 className="brand__name">{t('app.title')}</h1>
      </div>
      <nav className="sidenav__nav">
        <NavLink to="/" end className={linkClass}>
          {t('nav.dashboard')}
        </NavLink>
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
        {can('regions:view') ? (
          <NavLink to="/regions" className={linkClass}>
            {t('nav.regions')}
          </NavLink>
        ) : null}
        {showAdminGroup ? <div className="sidenav__divider" role="separator" /> : null}
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

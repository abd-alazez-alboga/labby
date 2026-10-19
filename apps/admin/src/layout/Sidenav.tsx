import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { usePermissions } from '../auth/usePermissions';
import { useSosAlerts } from '../sos/SosAlertsProvider';
import { ApiStatus } from './ApiStatus';
import { BrandMark } from './BrandMark';
import { useTrustQueueCounts } from './useTrustQueueCounts';

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
  const { openCount } = useSosAlerts();
  const queueCounts = useTrustQueueCounts();
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
        {can('rides:view') ? (
          <>
            <NavLink to="/live-ops" className={linkClass}>
              {t('nav.liveMap')}
              {openCount !== null && openCount > 0 ? (
                <span className="sidenav__alert-badge" aria-label={t('nav.openSosAlerts')}>
                  {openCount}
                </span>
              ) : null}
            </NavLink>
            <NavLink to="/rides" className={linkClass}>
              {t('nav.rides')}
            </NavLink>
          </>
        ) : null}
        {can('users:view') || can('wallets:view') ? (
          <NavLink to="/users" className={linkClass}>
            {t('nav.users')}
          </NavLink>
        ) : null}
        {can('users:view') ? (
          <NavLink to="/drivers" className={linkClass}>
            {t('nav.drivers')}
          </NavLink>
        ) : null}
        {can('wallets:view') && can('settlements:view') ? (
          <NavLink to="/transactions" className={linkClass}>
            {t('nav.transactions')}
          </NavLink>
        ) : null}
        {can('reports:view') ? (
          <NavLink to="/reports" className={linkClass}>
            {t('nav.reports')}
            {queueCounts.reports ? (
              <span
                className="sidenav__count"
                aria-label={t('nav.openCount', { count: queueCounts.reports })}
              >
                {queueCounts.reports}
              </span>
            ) : null}
          </NavLink>
        ) : null}
        {can('users:view') ? (
          <NavLink to="/flags" className={linkClass}>
            {t('nav.flags')}
            {queueCounts.flags ? (
              <span
                className="sidenav__count"
                aria-label={t('nav.openCount', { count: queueCounts.flags })}
              >
                {queueCounts.flags}
              </span>
            ) : null}
          </NavLink>
        ) : null}
        {can('support:view') ? (
          <>
            <NavLink to="/support" className={linkClass}>
              {t('nav.support')}
              {queueCounts.support ? (
                <span
                  className="sidenav__count"
                  aria-label={t('nav.openCount', { count: queueCounts.support })}
                >
                  {queueCounts.support}
                </span>
              ) : null}
            </NavLink>
            <NavLink to="/lost-items" className={linkClass}>
              {t('nav.lostItems')}
            </NavLink>
            <NavLink to="/feedback" className={linkClass}>
              {t('nav.feedback')}
            </NavLink>
          </>
        ) : null}
        {can('content:view') ? (
          <NavLink to="/help-center" className={linkClass}>
            {t('nav.helpCenter')}
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
        {can('promos:view') ? (
          <NavLink to="/promos" className={linkClass}>
            {t('nav.promos')}
          </NavLink>
        ) : null}
        {can('challenges:view') ? (
          <NavLink to="/challenges" className={linkClass}>
            {t('nav.challenges')}
          </NavLink>
        ) : null}
        {can('settlements:view') ? (
          <NavLink to="/driver-ledgers" className={linkClass}>
            {t('nav.driverLedgers')}
          </NavLink>
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

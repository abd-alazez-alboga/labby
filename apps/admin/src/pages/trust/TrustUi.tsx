import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router-dom';

import type { PartySummary, ReportStatus } from '../../api/trust';
import { usePermissions } from '../../auth/usePermissions';
import { StatusChip } from '../../ui';
import { REPORT_STATUS_TONES } from './trust-format';

/** Report lifecycle chip (open → substantiated | unsubstantiated). */
export function ReportStatusChip({ status }: { status: ReportStatus }) {
  const { t } = useTranslation();
  return (
    <StatusChip tone={REPORT_STATUS_TONES[status]}>{t(`reports.status.${status}`)}</StatusChip>
  );
}

/**
 * A party's name: a link to their trust profile when the admin may open it
 * (`users:view`), plain text otherwise.
 */
export function PartyName({ party, className }: { party: PartySummary; className?: string }) {
  const { can } = usePermissions();
  if (!can('users:view')) {
    return (
      <span className={className ?? 'person__name'} dir="auto">
        {party.name}
      </span>
    );
  }
  return (
    <Link
      className={className ?? 'table__link'}
      to={`/users/${party.userId}/trust`}
      state={{ name: party.name }}
      dir="auto"
    >
      {party.name}
    </Link>
  );
}

function tabClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'profile-tabs__tab profile-tabs__tab--active' : 'profile-tabs__tab';
}

/**
 * The user profile's section tabs (UC-A-13): ratings/reports/flags
 * (`users:view`) and wallet (`wallets:view`) — each shown only when the
 * admin may open it. Hidden when only one section is reachable.
 */
export function UserProfileTabs({ userId, name }: { userId: string; name?: string }) {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const tabs = [
    can('users:view') ? { to: `/users/${userId}/trust`, label: t('trust.tabs.trust') } : null,
    can('wallets:view') ? { to: `/users/${userId}/wallet`, label: t('trust.tabs.wallet') } : null,
  ].filter((tab): tab is { to: string; label: string } => tab !== null);
  if (tabs.length < 2) {
    return null;
  }
  return (
    <nav className="profile-tabs" aria-label={t('trust.tabs.label')}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} className={tabClass} to={tab.to} state={name ? { name } : undefined}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import {
  getUserTrust,
  listAdminReports,
  REPORT_STATUSES,
  type AdminReportSummary,
  type AdminUserTrust,
  type PartyRole,
  type RoleTrust,
  type SuspensionAction,
} from '../api/trust';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { BackLink, DataTable, PageHeader, ReviewLayout, StatusChip, type ChipTone } from '../ui';
import { formatDay } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { SuspensionPanel } from './trust/SuspensionPanel';
import { ReportStatusChip, UserProfileTabs } from './trust/TrustUi';
import { flagRule, formatRating, metricRule } from './trust/trust-format';

const ACCOUNT_TONES: Record<AdminUserTrust['accountState'], ChipTone> = {
  active: 'success',
  suspended: 'danger',
  deleted: 'neutral',
};

/** The reports against the user, all statuses, newest first (`reports:view`). */
function useReportsAgainst(userId: string, refresh: number) {
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canReports = can('reports:view');
  const [reports, setReports] = useState<AdminReportSummary[] | null>(null);

  useEffect(() => {
    if (!canReports) {
      setReports(null);
      return;
    }
    let cancelled = false;
    // The queue filters one status at a time; three small pages cover a profile.
    Promise.all(
      REPORT_STATUSES.map((status) =>
        listAdminReports(apiClient, { status, reportedUserId: userId, size: 50 }),
      ),
    )
      .then((pages) => {
        if (!cancelled) {
          setReports(
            pages
              .flatMap((page) => page.items)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReports(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, userId, canReports, refresh]);

  return reports;
}

/**
 * UC-A-13 trust sections + UC-A-14 suspension: per-role state cards (live
 * average, suspension reason and rule), open flags, active metric warnings
 * and reports against the user; with `users:suspend`, the suspend/reactivate
 * panel (mandatory reason shown to the user). `users:view` (route guard).
 */
export default function UserTrustPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { userId = '' } = useParams<{ userId: string }>();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canSuspend = can('users:suspend');

  const [trust, setTrust] = useState<AdminUserTrust | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<{
    key: string;
    tone: 'success' | 'warning' | 'error';
  } | null>(null);
  const reports = useReportsAgainst(userId, refresh);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getUserTrust(apiClient, userId)
      .then((loaded) => {
        if (!cancelled) {
          setTrust(loaded);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(classifyError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, userId, refresh]);

  const backLink = <BackLink to="/users">{t('trust.back')}</BackLink>;

  if (trust === null) {
    return (
      <section className="page">
        {backLink}
        {loadError ? (
          <LoadFailure
            kind={loadError}
            notFoundKey="trust.notFound"
            onRetry={() => setRefresh((n) => n + 1)}
          />
        ) : (
          <div className="loading">{t('common.loading')}</div>
        )}
      </section>
    );
  }

  function onUpdated(updated: AdminUserTrust, action: SuspensionAction) {
    setTrust(updated);
    // A driver reactivation answers 200 but keeps the role suspended while a
    // current document is expired (DRV-04): say so instead of "reactivated".
    if (action.kind === 'reactivateRole') {
      const role = updated.roles.find((entry) => entry.role === action.role);
      if (role?.state === 'suspended' && role.suspensionReason === 'document_expired') {
        setNotice({ key: 'trust.done.reactivateRoleDocumentExpired', tone: 'warning' });
        return;
      }
    }
    setNotice({ key: `trust.done.${action.kind}`, tone: 'success' });
  }

  function onFailed(errorKey: string) {
    setNotice({ key: errorKey, tone: 'error' });
    // The state may have moved under us (another admin, a renewal): reload.
    setRefresh((n) => n + 1);
  }

  const reportsByRole = (role: PartyRole) =>
    reports?.filter((report) => report.reported.role === role) ?? null;

  return (
    <section className="page">
      {backLink}
      <PageHeader
        title={<span dir="auto">{trust.name}</span>}
        meta={
          <StatusChip tone={ACCOUNT_TONES[trust.accountState]}>
            {t(`trust.account.${trust.accountState}`)}
          </StatusChip>
        }
      />
      <UserProfileTabs userId={userId} name={trust.name} />

      {trust.accountState === 'suspended' ? (
        <div className="banner banner--error" role="status">
          <strong>
            {t('trust.accountSuspendedBanner', {
              when: trust.accountSuspendedAt ? formatDay(trust.accountSuspendedAt, language) : '—',
            })}
          </strong>
          {trust.accountSuspensionNote ? (
            <span className="banner__detail" dir="auto">
              {trust.accountSuspensionNote}
            </span>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p
          className={`banner banner--${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {t(notice.key)}
        </p>
      ) : null}

      <ReviewLayout
        aside={
          canSuspend ? (
            <SuspensionPanel trust={trust} onUpdated={onUpdated} onFailed={onFailed} />
          ) : null
        }
      >
        {trust.roles.length === 0 ? (
          <p className="panel__hint">{t('trust.noRoles')}</p>
        ) : (
          <div className="role-cards">
            {trust.roles.map((role) => (
              <RoleCard key={role.role} role={role} />
            ))}
          </div>
        )}

        {trust.roles.map((role) => (
          <RoleSections
            key={role.role}
            role={role}
            reports={reportsByRole(role.role)}
            language={language}
          />
        ))}
      </ReviewLayout>
    </section>
  );
}

function RoleCard({ role }: { role: RoleTrust }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const suspended = role.state === 'suspended';
  const since = role.suspendedAt ? formatDay(role.suspendedAt, language) : '—';
  const against = role.reportHistory?.reportsAgainst ?? 0;

  return (
    <section
      className={suspended ? 'card role-card role-card--suspended' : 'card role-card'}
      aria-label={t(`trust.roleCard.title.${role.role}`)}
    >
      <div className="role-card__head">
        <h2 className="section__heading">{t(`trust.roleCard.title.${role.role}`)}</h2>
        <StatusChip tone={suspended ? 'warning' : 'success'}>
          {suspended && role.suspensionReason
            ? t('trust.roleCard.suspendedChip', {
                reason: t(`trust.reason.${role.suspensionReason}`),
              })
            : suspended
              ? t('trust.roleCard.suspended')
              : t('trust.roleCard.active')}
        </StatusChip>
      </div>
      <span className="role-card__rating">
        {role.liveAverage != null ? formatRating(role.liveAverage, language) : '—'}{' '}
        <span className="role-card__count">
          {role.liveAverage != null
            ? t('trust.roleCard.live', { count: role.liveRatingCount })
            : t('trust.roleCard.noRatings')}
        </span>
      </span>
      {suspended ? (
        <p className="role-card__text">
          {role.suspensionReason
            ? t(`trust.roleCard.rule.${role.suspensionReason}`, { when: since })
            : null}
          {role.suspensionNote ? (
            <span className="trust-note" dir="auto">
              {role.suspensionNote}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="role-card__text">
          {role.openFlags.length === 0
            ? t('trust.roleCard.noFlags', { against })
            : t('trust.roleCard.flags', { flags: role.openFlags.length, against })}
        </p>
      )}
    </section>
  );
}

function RoleSections({
  role,
  reports,
  language,
}: {
  role: RoleTrust;
  reports: AdminReportSummary[] | null;
  language: string;
}) {
  const { t } = useTranslation();
  const roleName = t(`trust.role.${role.role}`);
  const history = role.reportHistory;

  return (
    <>
      {role.openFlags.length > 0 ? (
        <DataTable title={t('trust.sections.flags', { role: roleName })}>
          <tbody>
            {role.openFlags.map((flag) => (
              <tr key={flag.id}>
                <td className="reports__category">{t(`flags.kind.${flag.kind}`)}</td>
                <td className="table__muted">{flagRule(t, language, flag)}</td>
                <td className="table__muted table__num">{formatDay(flag.raisedAt, language)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}

      {role.activeWarnings.length > 0 ? (
        <DataTable title={t('trust.sections.warnings', { role: roleName })}>
          <tbody>
            {role.activeWarnings.map((warning) => (
              <tr key={`${warning.metric}-${warning.raisedAt}`}>
                <td className="reports__category">{t(`trust.metric.${warning.metric}`)}</td>
                <td className="table__muted">{metricRule(t, language, warning)}</td>
                <td className="table__muted table__num">{formatDay(warning.raisedAt, language)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}

      {reports !== null && reports.length > 0 ? (
        <DataTable
          title={t('trust.sections.reports', { role: roleName })}
          actions={
            history ? (
              <span className="panel__hint">
                {t('trust.sections.reportsCount', {
                  total: history.reportsAgainst,
                  substantiated: history.substantiatedAgainst,
                })}
              </span>
            ) : undefined
          }
        >
          <tbody>
            {reports.map((report) => (
              <tr key={report.id}>
                <td>
                  <Link className="table__link" to={`/reports/${report.id}`}>
                    {t(`reports.category.${report.category}`)}
                  </Link>
                </td>
                <td>
                  <ReportStatusChip status={report.status} />
                </td>
                <td className="table__muted table__num">{formatDay(report.createdAt, language)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
    </>
  );
}

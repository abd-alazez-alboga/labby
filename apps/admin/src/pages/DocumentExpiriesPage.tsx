import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  getExpiryDashboard,
  listRenewals,
  type DocumentRenewal,
  type ExpiryDashboard,
  type ExpiryRow,
} from '../api/onboarding';
import { useAuth } from '../auth/AuthContext';
import { DataTable, KpiRow, KpiTile, PageHeader, StatusChip } from '../ui';
import { ApplicantCell, LoadFailure } from './onboarding/ReviewUi';
import { classifyError, formatDateTime, type FailureKind } from './onboarding/review-utils';

/** The two horizons UC-A-12 names (the contract allows 1..30). */
const HORIZONS = [30, 7] as const;
type Horizon = (typeof HORIZONS)[number];

/** Load state for one memoized read (`load` changes = reload). */
function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    load()
      .then((loaded) => {
        if (!cancelled) {
          setData(loaded);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(classifyError(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  return { data, error, retry: () => setAttempt((n) => n + 1) };
}

function ExpiryRows({ rows, expired }: { rows: ExpiryRow[]; expired: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <thead>
        <tr>
          <th>{t('expiries.columns.driver')}</th>
          <th>{t('expiries.columns.document')}</th>
          <th>{t('expiries.columns.expiresOn')}</th>
          <th>{expired ? t('expiries.columns.daysOverdue') : t('expiries.columns.daysLeft')}</th>
          <th>{t('expiries.columns.state')}</th>
          <th>{t('expiries.columns.reminders')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.document.id}>
            <td>
              <ApplicantCell person={row.driver} />
            </td>
            <td>
              <span className="person">
                <span>{t(`review.documentType.${row.document.type}`)}</span>
                <span className="person__phone" dir="auto">
                  {row.document.number}
                </span>
              </span>
            </td>
            <td>
              <span dir="ltr">{row.document.expiresOn}</span>
            </td>
            <td>
              <StatusChip tone={expired ? 'danger' : 'warning'}>
                {row.daysLeft === 0 ? t('expiries.lastDay') : String(Math.abs(row.daysLeft))}
              </StatusChip>
            </td>
            <td>
              <span className="chip-list">
                {row.driverSuspended ? (
                  <StatusChip tone="danger">{t('expiries.suspendedChip')}</StatusChip>
                ) : null}
                {row.renewalPending ? (
                  <StatusChip tone="accent">{t('expiries.renewalPendingChip')}</StatusChip>
                ) : null}
                {!row.driverSuspended && !row.renewalPending ? '—' : null}
              </span>
            </td>
            <td>
              <span className="reminders">
                <span>
                  {t('expiries.reminder30', {
                    at: row.reminder30SentAt
                      ? formatDateTime(row.reminder30SentAt, i18n.language)
                      : t('expiries.notSent'),
                  })}
                </span>
                <span>
                  {t('expiries.reminder7', {
                    at: row.reminder7SentAt
                      ? formatDateTime(row.reminder7SentAt, i18n.language)
                      : t('expiries.notSent'),
                  })}
                </span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

/**
 * UC-A-12: document expiry monitoring. Pending renewals first (the work
 * that lifts suspensions), then approved current documents expiring within
 * the chosen horizon (30 or 7 days), then those already expired (their
 * drivers are auto-suspended). Requires driver-review:view (route guard).
 */
export default function DocumentExpiriesPage() {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const [horizon, setHorizon] = useState<Horizon>(30);

  const renewals = useLoad<DocumentRenewal[]>(
    useCallback(() => listRenewals(apiClient), [apiClient]),
  );
  const dashboard = useLoad<ExpiryDashboard>(
    useCallback(() => getExpiryDashboard(apiClient, horizon), [apiClient, horizon]),
  );

  return (
    <section className="page">
      <PageHeader title={t('expiries.title')} description={t('expiries.subtitle')} />

      <KpiRow>
        <KpiTile
          label={t('expiries.kpi.renewals')}
          value={renewals.data ? renewals.data.length : '—'}
        />
        <KpiTile
          label={t('expiries.kpi.upcoming', { days: horizon })}
          value={dashboard.data ? dashboard.data.upcoming.length : '—'}
        />
        <KpiTile
          label={t('expiries.kpi.expired')}
          value={dashboard.data ? dashboard.data.expired.length : '—'}
          tone={dashboard.data && dashboard.data.expired.length > 0 ? 'danger' : 'default'}
        />
      </KpiRow>

      {renewals.error ? (
        <LoadFailure
          kind={renewals.error}
          notFoundKey="review.errors.server"
          onRetry={renewals.retry}
        />
      ) : renewals.data === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <DataTable
          title={t('renewals.title')}
          isEmpty={renewals.data.length === 0}
          empty={t('renewals.empty')}
        >
          <thead>
            <tr>
              <th>{t('expiries.columns.driver')}</th>
              <th>{t('expiries.columns.document')}</th>
              <th>{t('renewals.columns.currentExpiry')}</th>
              <th>{t('renewals.columns.newExpiry')}</th>
              <th>{t('renewals.columns.submitted')}</th>
              <th>{t('expiries.columns.state')}</th>
              <th className="table__cell--action">
                <span className="visually-hidden">{t('applications.columns.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {renewals.data.map((item, index) => (
              <tr key={item.renewal.id}>
                <td>
                  <ApplicantCell person={item.driver} />
                </td>
                <td>{t(`review.documentType.${item.renewal.type}`)}</td>
                <td>
                  <span dir="ltr">{item.current.expiresOn}</span>
                </td>
                <td>
                  <span dir="ltr">{item.renewal.expiresOn}</span>
                </td>
                <td className="table__muted">
                  {formatDateTime(item.renewal.submittedAt, i18n.language)}
                </td>
                <td>
                  {item.driverSuspended ? (
                    <StatusChip tone="danger">{t('expiries.suspendedChip')}</StatusChip>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="table__cell--action">
                  <Link
                    className={index === 0 ? 'btn btn--primary' : 'btn'}
                    to={`/document-renewals/${item.renewal.id}`}
                    aria-label={t('renewals.reviewFor', { name: item.driver.name })}
                  >
                    {t('renewals.review')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <DataTable
        title={t('expiries.upcomingTitle', { days: horizon })}
        actions={
          <div className="segmented" role="group" aria-label={t('expiries.horizonLabel')}>
            {HORIZONS.map((days) => (
              <button
                key={days}
                type="button"
                className="segmented__option"
                aria-pressed={days === horizon}
                onClick={() => setHorizon(days)}
              >
                {t('expiries.horizon', { days })}
              </button>
            ))}
          </div>
        }
        isEmpty={dashboard.data === null || dashboard.data.upcoming.length === 0}
        empty={
          dashboard.error ? (
            <LoadFailure
              kind={dashboard.error}
              notFoundKey="review.errors.server"
              onRetry={dashboard.retry}
            />
          ) : dashboard.data === null ? (
            t('common.loading')
          ) : (
            t('expiries.upcomingEmpty', { days: horizon })
          )
        }
      >
        {dashboard.data ? <ExpiryRows rows={dashboard.data.upcoming} expired={false} /> : null}
      </DataTable>

      {dashboard.data ? (
        <DataTable
          title={t('expiries.expiredTitle')}
          isEmpty={dashboard.data.expired.length === 0}
          empty={t('expiries.expiredEmpty')}
        >
          <ExpiryRows rows={dashboard.data.expired} expired />
        </DataTable>
      ) : null}
    </section>
  );
}

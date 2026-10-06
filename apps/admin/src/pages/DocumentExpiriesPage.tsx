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

function ExpiryTable({ rows, expired }: { rows: ExpiryRow[]; expired: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <table className="table">
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
              <span>{t(`review.documentType.${row.document.type}`)}</span>
              <br />
              <span className="person__phone" dir="auto">
                {row.document.number}
              </span>
            </td>
            <td>
              <span dir="ltr">{row.document.expiresOn}</span>
            </td>
            <td>{row.daysLeft === 0 ? t('expiries.lastDay') : String(Math.abs(row.daysLeft))}</td>
            <td>
              <span className="chip-list">
                {row.driverSuspended ? (
                  <span className="chip chip--flag">{t('expiries.suspendedChip')}</span>
                ) : null}
                {row.renewalPending ? (
                  <span className="chip chip--under_review">
                    {t('expiries.renewalPendingChip')}
                  </span>
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
    </table>
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
    <section>
      <h1 className="page__title">{t('expiries.title')}</h1>
      <p className="page__subtitle">{t('expiries.subtitle')}</p>

      <h2 className="section__title">
        {t('renewals.title')}
        {renewals.data ? <span className="count-badge">{renewals.data.length}</span> : null}
      </h2>
      {renewals.error ? (
        <LoadFailure
          kind={renewals.error}
          notFoundKey="review.errors.server"
          onRetry={renewals.retry}
        />
      ) : renewals.data === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : renewals.data.length === 0 ? (
        <p className="banner banner--info">{t('renewals.empty')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('expiries.columns.driver')}</th>
              <th>{t('expiries.columns.document')}</th>
              <th>{t('renewals.columns.currentExpiry')}</th>
              <th>{t('renewals.columns.newExpiry')}</th>
              <th>{t('renewals.columns.submitted')}</th>
              <th>{t('expiries.columns.state')}</th>
              <th>
                <span className="visually-hidden">{t('applications.columns.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {renewals.data.map((item) => (
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
                <td>{formatDateTime(item.renewal.submittedAt, i18n.language)}</td>
                <td>
                  {item.driverSuspended ? (
                    <span className="chip chip--flag">{t('expiries.suspendedChip')}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <Link
                    to={`/document-renewals/${item.renewal.id}`}
                    aria-label={t('renewals.reviewFor', { name: item.driver.name })}
                  >
                    {t('renewals.review')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section__header">
        <h2 className="section__title">{t('expiries.upcomingTitle', { days: horizon })}</h2>
        <div className="filter-chips" role="group" aria-label={t('expiries.horizonLabel')}>
          {HORIZONS.map((days) => (
            <button
              key={days}
              type="button"
              className={days === horizon ? 'filter-chip filter-chip--active' : 'filter-chip'}
              aria-pressed={days === horizon}
              onClick={() => setHorizon(days)}
            >
              {t('expiries.horizon', { days })}
            </button>
          ))}
        </div>
      </div>
      {dashboard.error ? (
        <LoadFailure
          kind={dashboard.error}
          notFoundKey="review.errors.server"
          onRetry={dashboard.retry}
        />
      ) : dashboard.data === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <>
          {dashboard.data.upcoming.length === 0 ? (
            <p className="banner banner--info">{t('expiries.upcomingEmpty', { days: horizon })}</p>
          ) : (
            <ExpiryTable rows={dashboard.data.upcoming} expired={false} />
          )}

          <h2 className="section__title">
            {t('expiries.expiredTitle')}
            <span className="count-badge">{dashboard.data.expired.length}</span>
          </h2>
          {dashboard.data.expired.length === 0 ? (
            <p className="banner banner--info">{t('expiries.expiredEmpty')}</p>
          ) : (
            <ExpiryTable rows={dashboard.data.expired} expired />
          )}
        </>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  APPLICATION_STATUSES,
  DEFAULT_QUEUE_STATUSES,
  listApplications,
  type ApplicationStatus,
  type ApplicationSummaryPage,
} from '../api/onboarding';
import { useAuth } from '../auth/AuthContext';
import {
  ApplicantCell,
  ApplicationStatusChip,
  DuplicatePlateChip,
  LoadFailure,
} from './onboarding/ReviewUi';
import { classifyError, formatDateTime, type FailureKind } from './onboarding/review-utils';

const PAGE_SIZE = 25;

function parseStatuses(statusKey: string): ApplicationStatus[] {
  const picked = statusKey
    .split(',')
    .filter((value): value is ApplicationStatus =>
      (APPLICATION_STATUSES as readonly string[]).includes(value),
    );
  return picked.length > 0 ? picked : [...DEFAULT_QUEUE_STATUSES];
}

/**
 * UC-A-10 step 1: the driver-application queue, oldest submission first,
 * filtered by status (default submitted + under review) and paginated. The
 * filter + page live in the URL so returning from a detail keeps them.
 * Requires driver-review:view (the route guard).
 */
export default function DriverApplicationsPage() {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const [params, setParams] = useSearchParams();

  const statusKey = params.getAll('status').join(',');
  const statuses = useMemo(() => parseStatuses(statusKey), [statusKey]);
  const page = Math.max(0, Number(params.get('page')) || 0);

  const [result, setResult] = useState<ApplicationSummaryPage | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    listApplications(apiClient, { statuses, page, size: PAGE_SIZE })
      .then((loaded) => {
        if (!cancelled) {
          setResult(loaded);
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
  }, [apiClient, statuses, page, attempt]);

  function navigate(nextStatuses: ApplicationStatus[], nextPage: number) {
    const next = new URLSearchParams();
    for (const status of APPLICATION_STATUSES.filter((s) => nextStatuses.includes(s))) {
      next.append('status', status);
    }
    if (nextPage > 0) {
      next.set('page', String(nextPage));
    }
    setParams(next);
  }

  function toggleStatus(status: ApplicationStatus) {
    const next = statuses.includes(status)
      ? statuses.filter((value) => value !== status)
      : [...statuses, status];
    navigate(next, 0);
  }

  const lastPage = result ? Math.max(0, Math.ceil(result.totalItems / result.size) - 1) : 0;

  return (
    <section>
      <h1 className="page__title">{t('applications.title')}</h1>
      <p className="page__subtitle">{t('applications.subtitle')}</p>

      <div className="card panel">
        <div className="filter-chips" role="group" aria-label={t('applications.filterLabel')}>
          {APPLICATION_STATUSES.map((status) => {
            const active = statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                className={active ? 'filter-chip filter-chip--active' : 'filter-chip'}
                aria-pressed={active}
                // Never empty: the last selected status cannot be cleared.
                disabled={active && statuses.length === 1}
                onClick={() => toggleStatus(status)}
              >
                {t(`review.applicationStatus.${status}`)}
              </button>
            );
          })}
        </div>
      </div>

      {loadError ? (
        <LoadFailure
          kind={loadError}
          notFoundKey="review.errors.server"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : result === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <>
          <p className="queue-count" role="status">
            {t('applications.count', { total: result.totalItems })}
          </p>
          {result.items.length === 0 ? (
            <p className="banner banner--info">{t('applications.empty')}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('applications.columns.applicant')}</th>
                  <th>{t('applications.columns.status')}</th>
                  <th>{t('applications.columns.submitted')}</th>
                  <th>{t('applications.columns.plate')}</th>
                  <th>
                    <span className="visually-hidden">{t('applications.columns.open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <ApplicantCell person={item.applicant} />
                    </td>
                    <td>
                      <ApplicationStatusChip status={item.status} />
                    </td>
                    <td>{formatDateTime(item.submittedAt, i18n.language)}</td>
                    <td>
                      <span dir="auto">{item.plate}</span>{' '}
                      {item.duplicatePlate ? <DuplicatePlateChip /> : null}
                    </td>
                    <td>
                      <Link
                        to={`/driver-applications/${item.id}`}
                        aria-label={t('applications.openFor', { name: item.applicant.name })}
                      >
                        {t('applications.open')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.totalItems > result.size ? (
            <div className="panel__row audit__pagination">
              <button
                className="btn"
                type="button"
                disabled={page === 0}
                onClick={() => navigate(statuses, page - 1)}
              >
                {t('audit.previous')}
              </button>
              <span>{t('applications.pageOf', { page: page + 1, total: lastPage + 1 })}</span>
              <button
                className="btn"
                type="button"
                disabled={page >= lastPage}
                onClick={() => navigate(statuses, page + 1)}
              >
                {t('audit.next')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

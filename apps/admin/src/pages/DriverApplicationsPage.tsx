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
import { DataTable, FilterChips, PageHeader, Plate, TablePager } from '../ui';
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
    <section className="page">
      <PageHeader title={t('applications.title')} description={t('applications.subtitle')} />

      <FilterChips
        label={t('applications.filterLabel')}
        options={APPLICATION_STATUSES.map((status) => ({
          value: status,
          label: t(`review.applicationStatus.${status}`),
        }))}
        isSelected={(status) => statuses.includes(status)}
        // Never empty: the last selected status cannot be cleared.
        isDisabled={(status) => statuses.includes(status) && statuses.length === 1}
        onSelect={toggleStatus}
      />

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
          <DataTable
            isEmpty={result.items.length === 0}
            empty={t('applications.empty')}
            footer={
              result.totalItems > result.size ? (
                <TablePager
                  status={t('applications.pageOf', { page: page + 1, total: lastPage + 1 })}
                  previousLabel={t('audit.previous')}
                  nextLabel={t('audit.next')}
                  canPrevious={page > 0}
                  canNext={page < lastPage}
                  onPrevious={() => navigate(statuses, page - 1)}
                  onNext={() => navigate(statuses, page + 1)}
                />
              ) : null
            }
          >
            <thead>
              <tr>
                <th>{t('applications.columns.applicant')}</th>
                <th>{t('applications.columns.status')}</th>
                <th>{t('applications.columns.submitted')}</th>
                <th>{t('applications.columns.plate')}</th>
                <th className="table__cell--action">
                  <span className="visually-hidden">{t('applications.columns.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item, index) => (
                <tr key={item.id}>
                  <td>
                    <ApplicantCell person={item.applicant} />
                  </td>
                  <td>
                    <ApplicationStatusChip status={item.status} />
                  </td>
                  <td className="table__muted">
                    {formatDateTime(item.submittedAt, i18n.language)}
                  </td>
                  <td>
                    <span className="chip-list">
                      <Plate value={item.plate} />
                      {item.duplicatePlate ? <DuplicatePlateChip /> : null}
                    </span>
                  </td>
                  <td className="table__cell--action">
                    <Link
                      // The queue's first row carries the one primary action.
                      className={index === 0 ? 'btn btn--primary' : 'btn'}
                      to={`/driver-applications/${item.id}`}
                      aria-label={t('applications.openFor', { name: item.applicant.name })}
                    >
                      {t('applications.open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
    </section>
  );
}

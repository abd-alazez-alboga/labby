import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  listAdminReports,
  REPORT_STATUSES,
  type AdminReportPage,
  type ReportStatus,
} from '../api/trust';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, PageHeader, TablePager } from '../ui';
import { formatMoment } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { rideRef } from './rides/ride-format';
import { PartyName } from './trust/TrustUi';
import { waitingParts } from './trust/trust-format';

const PAGE_SIZE = 20;

function parseStatus(value: string | null): ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as ReportStatus)
    : 'open';
}

/**
 * UC-A-17 step 1: the reports queue, oldest first, one status tab at a time
 * (Open / Substantiated / Unsubstantiated) and paginated. Tab + page live in
 * the URL so returning from a report keeps them. Requires `reports:view`
 * (route guard).
 */
export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();

  const status = parseStatus(params.get('status'));
  const page = Math.max(0, Number(params.get('page')) || 0);

  const [result, setResult] = useState<AdminReportPage | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    listAdminReports(apiClient, { status, page, size: PAGE_SIZE })
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
  }, [apiClient, status, page, attempt]);

  function navigate(nextStatus: ReportStatus, nextPage: number) {
    const next = new URLSearchParams();
    if (nextStatus !== 'open') {
      next.set('status', nextStatus);
    }
    if (nextPage > 0) {
      next.set('page', String(nextPage));
    }
    setParams(next);
  }

  function waiting(since: string): string {
    const { unit, count } = waitingParts(since);
    return t(`reports.waiting.${unit}`, { count });
  }

  const lastPage = result ? Math.max(0, Math.ceil(result.totalElements / result.size) - 1) : 0;
  const openCount = status === 'open' && result ? result.totalElements : null;

  return (
    <section className="page">
      <PageHeader
        title={t('reports.title')}
        description={t('reports.subtitle')}
        actions={
          <div className="segmented" role="group" aria-label={t('reports.statusLabel')}>
            {REPORT_STATUSES.map((option) => (
              <button
                key={option}
                type="button"
                className="segmented__option"
                aria-pressed={option === status}
                onClick={() => navigate(option, 0)}
              >
                {option === 'open' && openCount !== null
                  ? t('reports.tabs.openCount', { count: openCount })
                  : t(`reports.tabs.${option}`)}
              </button>
            ))}
          </div>
        }
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
        <DataTable
          isEmpty={result.items.length === 0}
          empty={t(`reports.empty.${status}`)}
          footer={
            result.totalElements > result.size ? (
              <TablePager
                status={t('money.pageOf', { page: page + 1, total: lastPage + 1 })}
                previousLabel={t('audit.previous')}
                nextLabel={t('audit.next')}
                canPrevious={page > 0}
                canNext={page < lastPage}
                onPrevious={() => navigate(status, page - 1)}
                onNext={() => navigate(status, page + 1)}
              />
            ) : null
          }
        >
          <thead>
            <tr>
              <th>{t('reports.columns.category')}</th>
              <th>{t('reports.columns.reported')}</th>
              <th>{t('reports.columns.by')}</th>
              <th>{t('reports.columns.ride')}</th>
              <th>{t('reports.columns.evidence')}</th>
              <th>
                {status === 'open' ? t('reports.columns.waiting') : t('reports.columns.resolved')}
              </th>
              <th className="table__cell--action">
                <span className="visually-hidden">{t('reports.columns.action')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((report, index) => (
              <tr key={report.id}>
                <td className="reports__category">{t(`reports.category.${report.category}`)}</td>
                <td>
                  <span className="person">
                    <PartyName party={report.reported} />
                    <span className="person__phone">{t(`trust.role.${report.reported.role}`)}</span>
                  </span>
                </td>
                <td>
                  <span className="person">
                    <span dir="auto">{report.reporter.name}</span>
                    <span className="person__phone">{t(`trust.role.${report.reporter.role}`)}</span>
                  </span>
                </td>
                <td className="table__muted">
                  {can('rides:view') ? (
                    <Link className="table__link" to={`/rides/${report.rideId}`} dir="ltr">
                      {rideRef(report.rideId)}
                    </Link>
                  ) : (
                    <span dir="ltr">{rideRef(report.rideId)}</span>
                  )}
                  <span className="person__phone">
                    {' '}
                    · {formatMoment(report.createdAt, language)}
                  </span>
                </td>
                <td className="table__muted">
                  {report.photoCount === 0
                    ? t('reports.evidenceNoPhotos')
                    : report.photoCount === 1
                      ? t('reports.evidenceOnePhoto')
                      : t('reports.evidencePhotos', { count: report.photoCount })}
                </td>
                <td className="table__muted">
                  {status === 'open'
                    ? waiting(report.createdAt)
                    : report.resolvedAt
                      ? formatMoment(report.resolvedAt, language)
                      : '—'}
                </td>
                <td className="table__cell--action">
                  <Link
                    // The oldest report carries the queue's one primary action.
                    className={index === 0 && page === 0 ? 'btn btn--primary' : 'btn'}
                    to={`/reports/${report.id}`}
                    aria-label={t('reports.investigateFor', {
                      category: t(`reports.category.${report.category}`),
                      name: report.reported.name,
                    })}
                  >
                    {status === 'open' ? t('reports.investigate') : t('reports.view')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

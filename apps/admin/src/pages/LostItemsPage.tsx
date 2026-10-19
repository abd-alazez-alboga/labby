import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  CASE_STATUSES,
  listAdminLostItems,
  type AdminTicket,
  type AdminTicketPage,
  type CaseStatus,
} from '../api/support';
import { useAuth } from '../auth/AuthContext';
import { DataTable, FilterChips, PageHeader, StatusChip, TablePager } from '../ui';
import { formatDay } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { rideRef } from './rides/ride-format';
import { ageParts, CASE_STATUS_TONES, ticketExcerpt } from './support/support-format';

const PAGE_SIZE = 20;

/** The chip row: the default "open cases" view (non-closed) or one status. */
type QueueTab = 'open' | CaseStatus;

function parseTab(value: string | null): QueueTab {
  return (CASE_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as CaseStatus)
    : 'open';
}

/**
 * UC-A-22 step 1: the lost-item case queue (the lost-item slice of the ticket
 * queue, same priority+age sort). While a case is open the ride chat between
 * its rider and driver stays open — closing the case makes it read-only
 * again (LOST-01). Requires `support:view` (route guard).
 */
export default function LostItemsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const [params, setParams] = useSearchParams();

  const tab = parseTab(params.get('caseStatus'));
  const page = Math.max(0, Number(params.get('page')) || 0);

  const [result, setResult] = useState<AdminTicketPage | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    listAdminLostItems(apiClient, {
      caseStatus: tab === 'open' ? undefined : [tab],
      page,
      size: PAGE_SIZE,
    })
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
  }, [apiClient, tab, page, attempt]);

  function navigate(nextTab: QueueTab, nextPage: number) {
    const next = new URLSearchParams();
    if (nextTab !== 'open') {
      next.set('caseStatus', nextTab);
    }
    if (nextPage > 0) {
      next.set('page', String(nextPage));
    }
    setParams(next);
  }

  function reported(ticket: AdminTicket): string {
    const { unit, count } = ageParts(ticket.ageSeconds);
    return t(`support.age.${unit}`, { count });
  }

  const lastPage = result ? Math.max(0, Math.ceil(result.totalItems / result.size) - 1) : 0;
  const openCount = tab === 'open' && result ? result.totalItems : null;

  return (
    <section className="page">
      <PageHeader title={t('lostItems.title')} description={t('lostItems.subtitle')} />

      <FilterChips<QueueTab>
        label={t('lostItems.statusLabel')}
        options={[
          { value: 'open', label: t('lostItems.tabs.open'), count: openCount ?? undefined },
          ...CASE_STATUSES.map((status) => ({
            value: status as QueueTab,
            label: t(`lostItems.caseStatus.${status}`),
          })),
        ]}
        isSelected={(value) => value === tab}
        onSelect={(value) => navigate(value, 0)}
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
          empty={t('lostItems.empty')}
          footer={
            result.totalItems > result.size ? (
              <TablePager
                status={t('money.pageOf', { page: page + 1, total: lastPage + 1 })}
                previousLabel={t('audit.previous')}
                nextLabel={t('audit.next')}
                canPrevious={page > 0}
                canNext={page < lastPage}
                onPrevious={() => navigate(tab, page - 1)}
                onNext={() => navigate(tab, page + 1)}
              />
            ) : null
          }
        >
          <thead>
            <tr>
              <th>{t('lostItems.columns.item')}</th>
              <th>{t('lostItems.columns.rider')}</th>
              <th>{t('lostItems.columns.driver')}</th>
              <th>{t('lostItems.columns.ride')}</th>
              <th>{t('lostItems.columns.caseStatus')}</th>
              <th>{t('lostItems.columns.reported')}</th>
              <th className="table__cell--action">
                <span className="visually-hidden">{t('support.columns.action')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((ticket, index) => (
              <tr key={ticket.ticketId}>
                <td dir="auto">{ticketExcerpt(ticket.description)}</td>
                <td className="table__muted" dir="auto">
                  {ticket.user.name}
                </td>
                <td className="table__muted" dir="auto">
                  {/* The queue row's driver = the other party of the ride. */}
                  {ticket.ride?.counterpartName ?? '—'}
                </td>
                <td className="table__muted">
                  {ticket.ride ? (
                    <>
                      <span dir="ltr">{rideRef(ticket.ride.rideId)}</span>
                      {ticket.ride.startedAt
                        ? ` · ${formatDay(ticket.ride.startedAt, language)}`
                        : ''}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {ticket.caseStatus ? (
                    <StatusChip tone={CASE_STATUS_TONES[ticket.caseStatus]}>
                      {t(`lostItems.caseStatus.${ticket.caseStatus}`)}
                    </StatusChip>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="table__muted">{reported(ticket)}</td>
                <td className="table__cell--action">
                  <Link
                    className={index === 0 && page === 0 ? 'btn btn--primary' : 'btn'}
                    to={`/lost-items/${ticket.ticketId}`}
                    aria-label={t('support.openFor', {
                      excerpt: ticketExcerpt(ticket.description),
                    })}
                  >
                    {t('support.open')}
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

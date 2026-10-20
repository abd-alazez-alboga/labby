import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  listAdminTicketCategories,
  listAdminTickets,
  listPickableTicketCategories,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type AdminTicket,
  type AdminTicketPage,
  type AdminTicketQuery,
  type LocalizedText,
  type TicketPriority,
  type TicketStatus,
} from '../api/support';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, FilterChips, KpiRow, KpiTile, PageHeader, StatusChip, TablePager } from '../ui';
import { ExportCsvButton, ExportFailureBanner } from './exports/CsvExport';
import { exportNote, useCsvExport } from './exports/use-csv-export';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { rideRef } from './rides/ride-format';
import {
  ageParts,
  localizedName,
  PRIORITY_TONES,
  TICKET_STATUS_TONES,
  ticketExcerpt,
} from './support/support-format';

const PAGE_SIZE = 20;

/** The chip row: the default "needs action" view (non-closed) or one status. */
type QueueTab = 'needs_action' | TicketStatus;

function parseTab(value: string | null): QueueTab {
  return (TICKET_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as TicketStatus)
    : 'needs_action';
}

function parsePriority(value: string | null): TicketPriority | '' {
  return (TICKET_PRIORITIES as readonly string[]).includes(value ?? '')
    ? (value as TicketPriority)
    : '';
}

type AssigneeFilter = '' | 'me' | 'unassigned';

interface QueueKpis {
  openUnassigned: number | null;
  waitingOnUser: number | null;
  urgentNotResolved: number | null;
}

/**
 * UC-A-21 step 1: the ticket queue of both kinds, sorted by the server
 * (priority, then oldest first — SUP-03). Status chips, category / priority /
 * assignee filters and the page live in the URL so returning from a ticket
 * keeps them. Requires `support:view` (route guard).
 */
export default function SupportTicketsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient, user } = useAuth();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();

  const tab = parseTab(params.get('status'));
  const categoryId = params.get('categoryId') ?? '';
  const priority = parsePriority(params.get('priority'));
  const assignee = (params.get('assignee') ?? '') as AssigneeFilter;
  const page = Math.max(0, Number(params.get('page')) || 0);

  const [result, setResult] = useState<AdminTicketPage | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [kpis, setKpis] = useState<QueueKpis>({
    openUnassigned: null,
    waitingOnUser: null,
    urgentNotResolved: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [categories, setCategories] = useState<{ id: string; name: LocalizedText }[]>([]);
  const canContentView = can('content:view');

  // The queue filter, shared by the page and its CSV export (ADM-06).
  const filter = useMemo<AdminTicketQuery>(() => {
    const query: AdminTicketQuery = {};
    if (tab !== 'needs_action') {
      query.status = [tab];
    }
    if (categoryId) {
      query.categoryId = categoryId;
    }
    if (priority) {
      query.priority = priority;
    }
    if (assignee === 'me' && user) {
      query.assigneeUserId = user.id;
    } else if (assignee === 'unassigned') {
      query.unassigned = true;
    }
    return query;
  }, [tab, categoryId, priority, assignee, user]);
  const exporter = useCsvExport('tickets', filter);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    listAdminTickets(apiClient, { ...filter, page, size: PAGE_SIZE })
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
  }, [apiClient, filter, page, attempt]);

  // The category filter lists every category (V1 audit W18): the full list
  // (incl. inactive + the lost-item system row) with content:view, else the
  // active ones any account may read. Best effort — the page rows still fill in.
  useEffect(() => {
    let cancelled = false;
    const load: Promise<{ id: string; name: LocalizedText }[]> = canContentView
      ? listAdminTicketCategories(apiClient).then((all) =>
          all.map((c) => ({ id: c.ticketCategoryId, name: { en: c.nameEn, ar: c.nameAr } })),
        )
      : listPickableTicketCategories(apiClient).then((active) =>
          active.map((c) => ({ id: c.ticketCategoryId, name: c.name })),
        );
    load
      .then((loaded) => {
        if (!cancelled) {
          setCategories(loaded);
        }
      })
      .catch(() => {
        // Keep the options the loaded page's rows provide.
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, canContentView]);

  // KPI tiles — one 1-item page each (`totalItems`), like the menu badges.
  useEffect(() => {
    let cancelled = false;
    const count = (query: AdminTicketQuery, apply: (n: number | null) => void) => {
      listAdminTickets(apiClient, { ...query, size: 1 })
        .then((loaded) => !cancelled && apply(loaded.totalItems))
        .catch(() => !cancelled && apply(null));
    };
    count({ status: ['open'], unassigned: true }, (n) =>
      setKpis((k) => ({ ...k, openUnassigned: n })),
    );
    count({ status: ['waiting_on_user'] }, (n) => setKpis((k) => ({ ...k, waitingOnUser: n })));
    count({ status: ['open', 'in_progress', 'waiting_on_user'], priority: 'urgent' }, (n) =>
      setKpis((k) => ({ ...k, urgentNotResolved: n })),
    );
    return () => {
      cancelled = true;
    };
  }, [apiClient, attempt]);

  function navigate(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    next.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    setParams(next);
  }

  function setPage(nextPage: number) {
    const next = new URLSearchParams(params);
    if (nextPage > 0) {
      next.set('page', String(nextPage));
    } else {
      next.delete('page');
    }
    setParams(next);
  }

  function age(ticket: AdminTicket): string {
    const { unit, count } = ageParts(ticket.ageSeconds);
    return t(`support.age.${unit}`, { count });
  }

  // Category filter options: the loaded category list, plus any category the
  // page's own rows carry that the list lacks (e.g. inactive without content:view).
  const categoryOptions = new Map<string, string>();
  for (const category of categories) {
    categoryOptions.set(category.id, localizedName(category.name, language));
  }
  for (const ticket of result?.items ?? []) {
    categoryOptions.set(
      ticket.category.ticketCategoryId,
      localizedName(ticket.category.name, language),
    );
  }

  const lastPage = result ? Math.max(0, Math.ceil(result.totalItems / result.size) - 1) : 0;
  const needsActionCount = tab === 'needs_action' && result ? result.totalItems : null;

  return (
    <section className="page">
      <PageHeader
        title={t('support.title')}
        actions={
          <>
            <ExportCsvButton state={exporter} />
            {can('content:view') ? (
              <Link className="btn" to="/support/categories">
                {t('support.manageCategories')}
              </Link>
            ) : null}
          </>
        }
      />
      <ExportFailureBanner state={exporter} />

      <KpiRow>
        <KpiTile label={t('support.kpi.openUnassigned')} value={kpis.openUnassigned ?? '—'} />
        <KpiTile label={t('support.kpi.waitingOnUser')} value={kpis.waitingOnUser ?? '—'} />
        <KpiTile
          tone={kpis.urgentNotResolved ? 'danger' : 'default'}
          label={t('support.kpi.urgentNotResolved')}
          value={kpis.urgentNotResolved ?? '—'}
        />
      </KpiRow>

      <div className="rides-filters">
        <FilterChips<QueueTab>
          label={t('support.statusLabel')}
          options={[
            {
              value: 'needs_action',
              label: t('support.tabs.needsAction'),
              count: needsActionCount ?? undefined,
            },
            ...TICKET_STATUSES.map((status) => ({
              value: status as QueueTab,
              label: t(`support.status.${status}`),
            })),
          ]}
          isSelected={(value) => value === tab}
          onSelect={(value) =>
            navigate({ status: value === 'needs_action' ? '' : (value as string) })
          }
        />
        <select
          aria-label={t('support.filters.category')}
          value={categoryOptions.has(categoryId) ? categoryId : categoryId || ''}
          onChange={(event) => navigate({ categoryId: event.target.value })}
        >
          <option value="">{t('support.filters.allCategories')}</option>
          {[...categoryOptions.entries()].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
          {categoryId && !categoryOptions.has(categoryId) ? (
            <option value={categoryId}>{t('support.filters.currentCategory')}</option>
          ) : null}
        </select>
        <select
          aria-label={t('support.filters.priority')}
          value={priority}
          onChange={(event) => navigate({ priority: event.target.value })}
        >
          <option value="">{t('support.filters.allPriorities')}</option>
          {TICKET_PRIORITIES.map((option) => (
            <option key={option} value={option}>
              {t(`support.priority.${option}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('support.filters.assignee')}
          value={assignee}
          onChange={(event) => navigate({ assignee: event.target.value })}
        >
          <option value="">{t('support.filters.anyAssignee')}</option>
          <option value="me">{t('support.filters.assignedToMe')}</option>
          <option value="unassigned">{t('support.filters.unassigned')}</option>
        </select>
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
        <DataTable
          isEmpty={result.items.length === 0}
          empty={t('support.empty')}
          footer={
            <TablePager
              status={[
                t('support.sortNote', { page: page + 1, total: lastPage + 1 }),
                exportNote(exporter, t, 'tickets', result.totalItems, language),
              ]
                .filter(Boolean)
                .join(' · ')}
              previousLabel={t('audit.previous')}
              nextLabel={t('audit.next')}
              canPrevious={page > 0}
              canNext={page < lastPage}
              onPrevious={() => setPage(page - 1)}
              onNext={() => setPage(page + 1)}
            />
          }
        >
          <thead>
            <tr>
              <th>{t('support.columns.ticket')}</th>
              <th>{t('support.columns.category')}</th>
              <th>{t('support.columns.priority')}</th>
              <th>{t('support.columns.status')}</th>
              <th>{t('support.columns.assignee')}</th>
              <th>{t('support.columns.age')}</th>
              <th className="table__cell--action">
                <span className="visually-hidden">{t('support.columns.action')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((ticket, index) => {
              const to =
                ticket.kind === 'lost_item'
                  ? `/lost-items/${ticket.ticketId}`
                  : `/support/${ticket.ticketId}`;
              return (
                <tr key={ticket.ticketId}>
                  <td>
                    <span className="person">
                      <span dir="auto">{ticketExcerpt(ticket.description)}</span>
                      <span className="person__phone">
                        <span dir="auto">{ticket.user.name}</span> ·{' '}
                        {t(`trust.role.${ticket.user.role}`)}
                        {ticket.ride ? (
                          <span dir="ltr"> · {rideRef(ticket.ride.rideId)}</span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td className="table__muted">{localizedName(ticket.category.name, language)}</td>
                  <td>
                    <StatusChip tone={PRIORITY_TONES[ticket.priority]}>
                      {t(`support.priority.${ticket.priority}`)}
                    </StatusChip>
                  </td>
                  <td>
                    <StatusChip tone={TICKET_STATUS_TONES[ticket.status]}>
                      {t(`support.status.${ticket.status}`)}
                    </StatusChip>
                  </td>
                  <td className="table__muted">
                    {ticket.assignee ? <span dir="auto">{ticket.assignee.name}</span> : '—'}
                  </td>
                  <td className="table__muted">{age(ticket)}</td>
                  <td className="table__cell--action">
                    <Link
                      // The queue's top row carries the single primary action.
                      className={index === 0 && page === 0 ? 'btn btn--primary' : 'btn'}
                      to={to}
                      aria-label={t('support.openFor', {
                        excerpt: ticketExcerpt(ticket.description),
                      })}
                    >
                      {t('support.open')}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

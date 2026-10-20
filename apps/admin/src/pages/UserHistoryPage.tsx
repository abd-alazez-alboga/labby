import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import type { ApiClient } from '../api/client';
import { getUserGamification, type AdminUserGamification } from '../api/growth';
import { queryAuditLog, type AuditLogEntry } from '../api/rbac';
import { searchAdminRides, type AdminRideSummary } from '../api/rides';
import { listAdminTickets, type AdminTicket, type TicketStatus } from '../api/support';
import { getUserTrust, type AdminUserTrust } from '../api/trust';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { BackLink, DataTable, PageHeader, StatusChip } from '../ui';
import { formatDay, formatMoment, formatMoney, formatNumber } from './money/money-format';
import { useCurrencyLabel } from './money/use-currency-label';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { rideRef, rideStateTone } from './rides/ride-format';
import { localizedName, TICKET_STATUS_TONES } from './support/support-format';
import { UserProfileTabs } from './trust/TrustUi';
import { ACCOUNT_TONES } from './trust/trust-format';

/** Each section shows the user's latest entries; the full lists live on their own pages. */
const LATEST = 10;
/** Every ticket status, so closed tickets count too (the queue's default hides them). */
const ALL_TICKET_STATUSES: readonly TicketStatus[] = [
  'open',
  'in_progress',
  'waiting_on_user',
  'resolved',
  'closed',
];
/** The ticket list sorts by priority then age; one 50-row page is re-sorted by last update. */
const TICKET_PAGE = 50;

interface Latest<T> {
  items: T[];
  total: number;
}

type SectionState<T> = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: T };

/** One section's read: loads when allowed, reloads on retry, ignores stale answers. */
function useSection<T>(
  enabled: boolean,
  userId: string,
  load: (client: ApiClient, userId: string) => Promise<T>,
): { state: SectionState<T>; retry: () => void } {
  const { apiClient } = useAuth();
  const [state, setState] = useState<SectionState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    load(apiClient, userId)
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch(() => !cancelled && setState({ status: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, [apiClient, enabled, userId, load, attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}

async function loadRides(client: ApiClient, userId: string): Promise<Latest<AdminRideSummary>> {
  const page = await searchAdminRides(client, { userId, size: LATEST });
  return { items: page.items, total: page.totalItems };
}

async function loadTickets(client: ApiClient, userId: string): Promise<Latest<AdminTicket>> {
  const page = await listAdminTickets(client, {
    userId,
    status: ALL_TICKET_STATUSES,
    size: TICKET_PAGE,
  });
  const items = [...page.items]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, LATEST);
  return { items, total: page.totalItems };
}

async function loadAudit(client: ApiClient, userId: string): Promise<Latest<AuditLogEntry>> {
  const page = await queryAuditLog(client, { targetId: userId, size: LATEST });
  return { items: page.items, total: page.totalItems };
}

/** The human reason of an audit entry: the admin's note, else the recorded reason. */
function auditReason(entry: AuditLogEntry): string | null {
  for (const key of ['note', 'reason']) {
    const value = entry.after?.[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return null;
}

/**
 * UC-A-13 / ADM-05 "full history" (approved boards "Admin · User history"
 * EN + AR): the user's latest rides (rides:view, linking to the Rides page
 * filtered to them), support tickets (support:view), badges and levels
 * (users:view) and the audit trail of admin actions on them (audit:view).
 * Each section shows only when the admin holds its permission. `users:view`
 * (route guard).
 */
export default function UserHistoryPage() {
  const { t } = useTranslation();
  const { userId = '' } = useParams<{ userId: string }>();
  const { apiClient } = useAuth();
  const { can } = usePermissions();

  const [trust, setTrust] = useState<AdminUserTrust | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getUserTrust(apiClient, userId)
      .then((loaded) => !cancelled && setTrust(loaded))
      .catch((error: unknown) => !cancelled && setLoadError(classifyError(error)));
    return () => {
      cancelled = true;
    };
  }, [apiClient, userId, refresh]);

  const rides = useSection(can('rides:view'), userId, loadRides);
  const tickets = useSection(can('support:view'), userId, loadTickets);
  const gamification = useSection(true, userId, getUserGamification);
  const audit = useSection(can('audit:view'), userId, loadAudit);

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

      {can('rides:view') ? (
        <RidesSection userId={userId} state={rides.state} onRetry={rides.retry} />
      ) : null}
      <div className="history-grid">
        {can('support:view') ? (
          <TicketsSection state={tickets.state} onRetry={tickets.retry} />
        ) : null}
        <GamificationSection state={gamification.state} onRetry={gamification.retry} />
      </div>
      {can('audit:view') ? <AuditSection state={audit.state} onRetry={audit.retry} /> : null}
    </section>
  );
}

/** "Latest 10 of 143", or "Total: 3" when everything is shown. */
function CountHint({ shown, total }: { shown: number; total: number }) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => formatNumber(value, i18n.language);
  return (
    <span className="panel__hint">
      {total > shown
        ? t('history.latest', { shown: number(shown), total: number(total) })
        : t('history.total', { total: number(total) })}
    </span>
  );
}

/** A section card's loading / failure body; null once the data is ready. */
function SectionStatus<T>({ state, onRetry }: { state: SectionState<T>; onRetry: () => void }) {
  const { t } = useTranslation();
  if (state.status === 'loading') {
    return <p className="panel__hint">{t('history.loading')}</p>;
  }
  if (state.status === 'failed') {
    return (
      <p className="banner banner--error" role="alert">
        <span>{t('history.loadFailed')}</span>{' '}
        <button className="btn btn--small" type="button" onClick={onRetry}>
          {t('history.retry')}
        </button>
      </p>
    );
  }
  return null;
}

function RidesSection({
  userId,
  state,
  onRetry,
}: {
  userId: string;
  state: SectionState<Latest<AdminRideSummary>>;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const currencyLabel = useCurrencyLabel();
  const ready = state.status === 'ready' ? state.data : null;

  function fare(ride: AdminRideSummary) {
    if (ride.total !== null && ride.total !== undefined) {
      return (
        <span dir="ltr">
          {formatMoney(ride.total, currencyLabel(ride.currency ?? ''), language)}
        </span>
      );
    }
    if (ride.cancellationFee !== null && ride.cancellationFee !== undefined) {
      return (
        <span dir="ltr">
          {t('rides.fareFee', {
            amount: formatMoney(ride.cancellationFee, currencyLabel(ride.currency ?? ''), language),
          })}
        </span>
      );
    }
    return <span className="table__muted">—</span>;
  }

  return (
    <DataTable
      title={t('history.rides.title')}
      actions={
        <>
          {ready && ready.total > 0 ? (
            <CountHint shown={ready.items.length} total={ready.total} />
          ) : null}
          {/* The Rides page filters a pasted user id to that user's rides (rider OR driver). */}
          <Link className="btn btn--primary" to={`/rides?${new URLSearchParams({ q: userId })}`}>
            {t('history.rides.viewAll')}
          </Link>
        </>
      }
      isEmpty={!ready || ready.items.length === 0}
      empty={ready ? t('history.rides.empty') : <SectionStatus state={state} onRetry={onRetry} />}
    >
      <thead>
        <tr>
          <th>{t('history.rides.columns.ride')}</th>
          <th>{t('history.rides.columns.when')}</th>
          <th>{t('history.rides.columns.as')}</th>
          <th>{t('history.rides.columns.state')}</th>
          <th>{t('history.rides.columns.fare')}</th>
        </tr>
      </thead>
      <tbody>
        {ready?.items.map((ride) => (
          <tr key={ride.id}>
            <td>
              <Link className="rides-ref" to={`/rides/${ride.id}`} dir="ltr">
                {rideRef(ride.id)}
              </Link>
            </td>
            <td className="table__muted">{formatMoment(ride.requestedAt, language)}</td>
            <td>{t(`history.rides.as.${ride.riderUserId === userId ? 'rider' : 'driver'}`)}</td>
            <td>
              <StatusChip tone={rideStateTone(ride.state)}>
                {t(`money.rideState.${ride.state}`)}
              </StatusChip>
            </td>
            <td>{fare(ride)}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function TicketsSection({
  state,
  onRetry,
}: {
  state: SectionState<Latest<AdminTicket>>;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const ready = state.status === 'ready' ? state.data : null;

  return (
    <DataTable
      title={t('history.tickets.title')}
      actions={
        ready && ready.total > 0 ? (
          <CountHint shown={ready.items.length} total={ready.total} />
        ) : undefined
      }
      isEmpty={!ready || ready.items.length === 0}
      empty={ready ? t('history.tickets.empty') : <SectionStatus state={state} onRetry={onRetry} />}
    >
      <thead>
        <tr>
          <th>{t('history.tickets.columns.category')}</th>
          <th>{t('history.tickets.columns.status')}</th>
          <th>{t('history.tickets.columns.updated')}</th>
        </tr>
      </thead>
      <tbody>
        {ready?.items.map((ticket) => (
          <tr key={ticket.ticketId}>
            <td>
              <Link
                className="table__link"
                to={
                  ticket.kind === 'lost_item'
                    ? `/lost-items/${ticket.ticketId}`
                    : `/support/${ticket.ticketId}`
                }
                dir="auto"
              >
                {localizedName(ticket.category.name, language)}
              </Link>
            </td>
            <td>
              <StatusChip tone={TICKET_STATUS_TONES[ticket.status]}>
                {t(`support.status.${ticket.status}`)}
              </StatusChip>
            </td>
            <td className="table__muted table__num">{formatDay(ticket.updatedAt, language)}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function GamificationSection({
  state,
  onRetry,
}: {
  state: SectionState<AdminUserGamification>;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const number = (value: number) => formatNumber(value, language);
  const ready = state.status === 'ready' ? state.data : null;
  // Badges are per account: both role views carry the same catalog.
  const badges = (ready?.rider ?? ready?.driver)?.badges ?? [];
  const earnedAny = badges.some((badge) => badge.earned);

  return (
    <section className="card panel" aria-label={t('history.gamification.title')}>
      <h2 className="panel__title">{t('history.gamification.title')}</h2>
      {!ready ? (
        <SectionStatus state={state} onRetry={onRetry} />
      ) : !ready.rider && !ready.driver ? (
        <p className="panel__hint">{t('trust.noRoles')}</p>
      ) : (
        <>
          <div className="history-levels">
            {ready.rider ? (
              <div className="history-level">
                <span className="kpi__label">{t('history.gamification.riderLevel')}</span>
                <span className="history-level__value">
                  {t(`history.gamification.level.${ready.rider.level}`)}
                </span>
                <span className="kpi__hint">
                  {t('history.gamification.riderLifetime', {
                    points: number(ready.rider.lifetime),
                  })}
                </span>
              </div>
            ) : null}
            {ready.driver ? (
              <div className="history-level">
                <span className="kpi__label">{t('history.gamification.driverLevel')}</span>
                <span className="history-level__value">
                  {t(`history.gamification.level.${ready.driver.level}`)}
                </span>
                <span className="kpi__hint">
                  {t('history.gamification.driverLifetime', {
                    trips: number(ready.driver.driverTrips ?? 0),
                    points: number(ready.driver.challengePoints ?? 0),
                  })}
                </span>
              </div>
            ) : null}
          </div>
          {earnedAny ? (
            <ul className="history-badges" aria-label={t('history.gamification.badges')}>
              {badges.map((badge) => {
                const name = t(`history.gamification.badge.${badge.badgeCode}`);
                return (
                  <li
                    key={badge.badgeCode}
                    className={
                      badge.earned ? 'history-badge history-badge--earned' : 'history-badge'
                    }
                  >
                    {badge.earned && badge.awardedAt
                      ? `✓ ${t('history.gamification.earned', {
                          badge: name,
                          when: formatDay(badge.awardedAt, language),
                        })}`
                      : badge.earned
                        ? `✓ ${name}`
                        : name}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="panel__hint">{t('history.gamification.empty')}</p>
          )}
        </>
      )}
    </section>
  );
}

function AuditSection({
  state,
  onRetry,
}: {
  state: SectionState<Latest<AuditLogEntry>>;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const ready = state.status === 'ready' ? state.data : null;

  return (
    <DataTable
      title={t('history.audit.title')}
      actions={
        ready && ready.total > 0 ? (
          <CountHint shown={ready.items.length} total={ready.total} />
        ) : undefined
      }
      isEmpty={!ready || ready.items.length === 0}
      empty={ready ? t('history.audit.empty') : <SectionStatus state={state} onRetry={onRetry} />}
    >
      <thead>
        <tr>
          <th>{t('history.audit.columns.when')}</th>
          <th>{t('history.audit.columns.admin')}</th>
          <th>{t('history.audit.columns.action')}</th>
          <th>{t('history.audit.columns.reason')}</th>
        </tr>
      </thead>
      <tbody>
        {ready?.items.map((entry) => {
          const reason = auditReason(entry);
          return (
            <tr key={entry.id}>
              <td className="table__muted">{formatMoment(entry.createdAt, language)}</td>
              <td dir="auto">{entry.actorName}</td>
              <td>
                <code dir="ltr">{entry.action}</code>
              </td>
              <td dir="auto">{reason ?? <span className="table__muted">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

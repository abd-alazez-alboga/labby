import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { resolveFileUrl } from '../api/onboarding';
import { listAdmins, type AdminAccount } from '../api/rbac';
import {
  getAdminTicket,
  postAdminTicketMessage,
  setTicketAssignee,
  setTicketPriority,
  setTicketStatus,
  TICKET_PRIORITIES,
  TICKET_TRANSITIONS,
  type AdminTicketDetail,
  type TicketPriority,
  type TicketStatus,
} from '../api/support';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useConfig } from '../config/ConfigContext';
import { BackLink, ReviewLayout, StatusChip } from '../ui';
import { formatMoment } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { rideRef } from './rides/ride-format';
import {
  localizedName,
  PRIORITY_TONES,
  TICKET_STATUS_TONES,
  ticketExcerpt,
} from './support/support-format';
import { TicketThread } from './support/TicketThread';

const UNASSIGNED = '__unassigned__';

/**
 * UC-A-21 steps 2–4: one ticket — the user <-> support thread with the event
 * history inline, the reply composer, the status controls exactly per the
 * SUP-02 state machine, priority override, assignee, the linked ride, and
 * the wallet-credit remedy deep link (A2). Writes need `support:handle`;
 * `support:view` (route) reads everything.
 */
export default function SupportTicketDetailPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { ticketId = '' } = useParams<{ ticketId: string }>();
  const { apiClient, user } = useAuth();
  const { apiBaseUrl } = useConfig();
  const { can } = usePermissions();
  const canHandle = can('support:handle');

  const [ticket, setTicket] = useState<AdminTicketDetail | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getAdminTicket(apiClient, ticketId)
      .then((loaded) => {
        if (!cancelled) {
          setTicket(loaded);
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
  }, [apiClient, ticketId, attempt]);

  // The assignee select's options — only loadable with `admins:view`; the
  // "assign to me" / unassign options work without it.
  useEffect(() => {
    if (!canHandle || !can('admins:view')) {
      return;
    }
    let cancelled = false;
    listAdmins(apiClient)
      .then((loaded) => !cancelled && setAdmins(loaded.filter((a) => a.state === 'active')))
      .catch(() => !cancelled && setAdmins(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiClient, canHandle]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      setAttempt((n) => n + 1);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'assignee_not_handler') {
        setActionError(t('ticketDetail.errors.assigneeNotHandler'));
      } else if (error instanceof ApiError && error.status === 409) {
        // Another admin moved it first (or it closed) — reload and say so.
        setActionError(t('ticketDetail.errors.conflict'));
        setAttempt((n) => n + 1);
      } else {
        setActionError(t('ticketDetail.errors.actionFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  function sendReply(event: FormEvent) {
    event.preventDefault();
    const body = reply.trim();
    if (!body || busy) {
      return;
    }
    void act(async () => {
      await postAdminTicketMessage(apiClient, ticketId, body);
      setReply('');
    });
  }

  const backLink = <BackLink to="/support">{t('ticketDetail.back')}</BackLink>;

  if (ticket === null) {
    return (
      <section className="page">
        {backLink}
        {loadError ? (
          <LoadFailure
            kind={loadError}
            notFoundKey="ticketDetail.notFound"
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : (
          <div className="loading">{t('common.loading')}</div>
        )}
      </section>
    );
  }

  const transitions: readonly TicketStatus[] =
    ticket.kind === 'lost_item' ? [] : TICKET_TRANSITIONS[ticket.status];
  const assigneeValue = ticket.assignee?.userId ?? UNASSIGNED;
  const closed = ticket.status === 'closed';

  return (
    <section className="page">
      {backLink}
      <header className="page-header">
        <div className="page-header__main">
          <div className="page-header__text">
            <h1 className="page-header__title" dir="auto">
              {ticketExcerpt(ticket.description, 120)}
            </h1>
          </div>
          <div className="page-header__meta ride-detail__chips">
            <StatusChip tone={TICKET_STATUS_TONES[ticket.status]}>
              {t(`support.status.${ticket.status}`)}
            </StatusChip>
            <StatusChip tone={PRIORITY_TONES[ticket.priority]}>
              {t(`support.priority.${ticket.priority}`)}
            </StatusChip>
            <span className="table__muted">
              {localizedName(ticket.category.name, language)} ·{' '}
              {t('ticketDetail.opened', { when: formatMoment(ticket.createdAt, language) })}
              {ticket.waitingSince
                ? ` · ${t('ticketDetail.waitingSince', {
                    when: formatMoment(ticket.waitingSince, language),
                  })}`
                : ''}
            </span>
          </div>
        </div>
      </header>
      <p className="panel__hint">
        <span dir="auto">{ticket.user.name}</span> · {t(`trust.role.${ticket.user.role}`)}
        {ticket.userPhone ? (
          <>
            {' · '}
            <span dir="ltr">{ticket.userPhone}</span>
          </>
        ) : null}
        {ticket.openedBy.side === 'support' ? (
          <> · {t('ticketDetail.openedBy', { name: ticket.openedBy.name })}</>
        ) : null}
      </p>

      {actionError ? (
        <p className="banner banner--error" role="alert">
          {actionError}
        </p>
      ) : null}
      {ticket.kind === 'lost_item' ? (
        <p className="banner" role="status">
          {t('ticketDetail.lostItemNotice')}{' '}
          <Link className="table__link" to={`/lost-items/${ticket.ticketId}`}>
            {t('ticketDetail.openCase')}
          </Link>
        </p>
      ) : null}

      <ReviewLayout
        aside={
          <div className="review-layout__aside">
            {canHandle && !closed && transitions.length > 0 ? (
              <section className="card section" aria-label={t('ticketDetail.statusTitle')}>
                <h2 className="section__heading">{t('ticketDetail.statusTitle')}</h2>
                {transitions.map((target, index) => (
                  <button
                    key={target}
                    type="button"
                    className={index === 0 ? 'btn btn--primary btn--block' : 'btn btn--block'}
                    disabled={busy}
                    onClick={() => void act(() => setTicketStatus(apiClient, ticketId, target))}
                  >
                    {t(`ticketDetail.moveTo.${target}`)}
                  </button>
                ))}
                <p className="panel__hint">{t('ticketDetail.statusHint')}</p>
              </section>
            ) : null}

            {canHandle && !closed ? (
              <section className="card section" aria-label={t('ticketDetail.triageTitle')}>
                <h2 className="section__heading">{t('ticketDetail.triageTitle')}</h2>
                <div className="form-field">
                  <label htmlFor="ticket-priority">{t('ticketDetail.priorityLabel')}</label>
                  <select
                    id="ticket-priority"
                    value={ticket.priority}
                    disabled={busy}
                    onChange={(event) =>
                      void act(() =>
                        setTicketPriority(
                          apiClient,
                          ticketId,
                          event.target.value as TicketPriority,
                        ),
                      )
                    }
                  >
                    {TICKET_PRIORITIES.map((option) => (
                      <option key={option} value={option}>
                        {option === ticket.category.defaultPriority
                          ? t('ticketDetail.priorityDefault', {
                              priority: t(`support.priority.${option}`),
                            })
                          : t(`support.priority.${option}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="ticket-assignee">{t('ticketDetail.assigneeLabel')}</label>
                  <select
                    id="ticket-assignee"
                    value={assigneeValue}
                    disabled={busy}
                    onChange={(event) =>
                      void act(() =>
                        setTicketAssignee(
                          apiClient,
                          ticketId,
                          event.target.value === UNASSIGNED ? null : event.target.value,
                        ),
                      )
                    }
                  >
                    <option value={UNASSIGNED}>{t('support.filters.unassigned')}</option>
                    {user && !admins?.some((a) => a.id === user.id) ? (
                      <option value={user.id}>
                        {t('ticketDetail.assigneeMe', { name: user.name })}
                      </option>
                    ) : null}
                    {ticket.assignee &&
                    ticket.assignee.userId !== user?.id &&
                    !admins?.some((a) => a.id === ticket.assignee?.userId) ? (
                      <option value={ticket.assignee.userId}>{ticket.assignee.name}</option>
                    ) : null}
                    {(admins ?? []).map((admin) => (
                      <option key={admin.id} value={admin.id}>
                        {admin.id === user?.id
                          ? t('ticketDetail.assigneeMe', { name: admin.name })
                          : admin.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="panel__hint">{t('ticketDetail.triageHint')}</p>
              </section>
            ) : null}

            {ticket.ride ? (
              <section className="card section" aria-label={t('ticketDetail.rideTitle')}>
                <h2 className="section__heading">{t('ticketDetail.rideTitle')}</h2>
                {can('rides:view') ? (
                  <Link className="table__link" to={`/rides/${ticket.ride.rideId}`} dir="ltr">
                    {rideRef(ticket.ride.rideId)}
                  </Link>
                ) : (
                  <span dir="ltr">{rideRef(ticket.ride.rideId)}</span>
                )}
                <p className="panel__hint">
                  {ticket.ride.startedAt ? formatMoment(ticket.ride.startedAt, language) : '—'} ·{' '}
                  <span dir="auto">{ticket.ride.counterpartName}</span>
                </p>
              </section>
            ) : null}

            {/* The link opens the wallet page, which itself needs wallets:view (I101). */}
            {can('wallets:view') && can('wallets:manage') ? (
              <section className="card section" aria-label={t('ticketDetail.remedyTitle')}>
                <h2 className="section__heading">{t('ticketDetail.remedyTitle')}</h2>
                <Link
                  className="btn btn--block"
                  to={`/users/${ticket.user.userId}/wallet`}
                  state={{
                    name: ticket.user.name,
                    grantReason: t('ticketDetail.remedyReason', {
                      ref: rideRef(ticket.ticketId).replace('R-', 'T-'),
                    }),
                  }}
                >
                  {t('ticketDetail.grantCredit')}
                </Link>
                <p className="panel__hint">{t('ticketDetail.remedyHint')}</p>
              </section>
            ) : null}
          </div>
        }
      >
        <TicketThread
          ticket={ticket}
          attachments={
            ticket.attachments.length > 0 ? (
              <div className="thread__attachments">
                {ticket.attachments.map((attachment, index) => (
                  <a
                    key={attachment.fileId}
                    className="table__link"
                    href={resolveFileUrl(attachment.url, apiBaseUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('ticketDetail.attachment', { n: index + 1 })}
                  </a>
                ))}
              </div>
            ) : null
          }
          composer={
            canHandle && !closed ? (
              <form className="thread__composer" onSubmit={sendReply}>
                <input
                  value={reply}
                  placeholder={t('ticketDetail.replyPlaceholder', { name: ticket.user.name })}
                  aria-label={t('ticketDetail.replyLabel')}
                  maxLength={2000}
                  onChange={(event) => setReply(event.target.value)}
                />
                <button
                  className="btn btn--primary"
                  type="submit"
                  disabled={busy || reply.trim() === ''}
                >
                  {t('ticketDetail.send')}
                </button>
              </form>
            ) : closed ? (
              <p className="panel__hint">{t('ticketDetail.closedReadOnly')}</p>
            ) : null
          }
        />
      </ReviewLayout>
    </section>
  );
}

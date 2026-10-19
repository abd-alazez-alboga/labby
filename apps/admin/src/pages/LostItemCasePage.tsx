import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { resolveFileUrl } from '../api/onboarding';
import {
  CASE_TRANSITIONS,
  getAdminTicket,
  postAdminTicketMessage,
  setCaseStatus,
  type AdminTicketDetail,
  type CaseStatus,
} from '../api/support';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useConfig } from '../config/ConfigContext';
import { BackLink, ReviewLayout, Section, StatusChip } from '../ui';
import { formatMoment } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { ChatLogCard } from './rides/ChatLogCard';
import { rideRef } from './rides/ride-format';
import { CASE_STATUS_TONES, ticketExcerpt } from './support/support-format';
import { TicketThread } from './support/TicketThread';

/** The A14LostCase progress rail: one row per stage of the LOST-02 machine. */
const CASE_STAGES: readonly { key: string; statuses: readonly CaseStatus[] }[] = [
  { key: 'reported', statuses: ['reported'] },
  { key: 'driverContacted', statuses: ['driver_contacted'] },
  { key: 'outcome', statuses: ['found', 'not_found'] },
  { key: 'closure', statuses: ['returned', 'closed'] },
];

/**
 * UC-A-22 steps 2–3: one lost-item case — the rider's report with photos,
 * the reopened ride chat (read-only for admins, LOST-01), the rider ticket
 * thread with the reply composer, and the case progression per the LOST-02
 * machine. The ticket status mirrors the case; every change notifies both
 * parties; closing the case returns the chat to read-only. `support:view`
 * (route); progression and replies need `support:handle`.
 */
export default function LostItemCasePage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { ticketId = '' } = useParams<{ ticketId: string }>();
  const { apiClient } = useAuth();
  const { apiBaseUrl } = useConfig();
  const { can } = usePermissions();
  const canHandle = can('support:handle');

  const [ticket, setTicket] = useState<AdminTicketDetail | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
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

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      setAttempt((n) => n + 1);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
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

  const backLink = <BackLink to="/lost-items">{t('lostCase.back')}</BackLink>;

  if (ticket === null) {
    return (
      <section className="page">
        {backLink}
        {loadError ? (
          <LoadFailure
            kind={loadError}
            notFoundKey="lostCase.notFound"
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : (
          <div className="loading">{t('common.loading')}</div>
        )}
      </section>
    );
  }

  if (ticket.kind !== 'lost_item' || ticket.caseStatus === null) {
    return (
      <section className="page">
        {backLink}
        <p className="banner" role="status">
          {t('lostCase.notACase')}{' '}
          <Link className="table__link" to={`/support/${ticket.ticketId}`}>
            {t('lostCase.openTicket')}
          </Link>
        </p>
      </section>
    );
  }

  const caseStatus = ticket.caseStatus;
  const driver = ticket.lostItem?.driver ?? null;
  const transitions = CASE_TRANSITIONS[caseStatus];

  // When each case status was entered, from the event history (the rail's
  // timestamps); `reported` is the ticket's own creation.
  const enteredAt = new Map<string, string>([['reported', ticket.createdAt]]);
  for (const event of ticket.events) {
    if (event.type === 'case_status_changed' && event.toValue) {
      enteredAt.set(event.toValue, event.createdAt);
    }
  }
  const reachedIndex = CASE_STAGES.findIndex((stage) =>
    stage.statuses.some((status) => status === caseStatus),
  );

  function stageLabel(stage: (typeof CASE_STAGES)[number], done: boolean): string {
    if (done) {
      // Name the branch actually taken (Found vs Not found, Returned vs Closed).
      const reached = stage.statuses.find((status) => enteredAt.has(status));
      if (reached) {
        return t(`lostItems.caseStatus.${reached}`);
      }
    }
    return t(`lostCase.stage.${stage.key}`);
  }

  function stageWhen(stage: (typeof CASE_STAGES)[number]): string | null {
    for (const status of [...stage.statuses].reverse()) {
      const when = enteredAt.get(status);
      if (when) {
        return formatMoment(when, language);
      }
    }
    return null;
  }

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
            <StatusChip tone={CASE_STATUS_TONES[caseStatus]}>
              {t(`lostItems.caseStatus.${caseStatus}`)}
            </StatusChip>
            <span className="table__muted">
              {t('lostCase.reportedAt', { when: formatMoment(ticket.createdAt, language) })} ·{' '}
              <span dir="auto">{ticket.user.name}</span>
              {driver ? (
                <>
                  {' · '}
                  <span dir="auto">{driver.name}</span>
                </>
              ) : null}
              {ticket.ride ? (
                <>
                  {' · '}
                  {can('rides:view') ? (
                    <Link className="table__link" to={`/rides/${ticket.ride.rideId}`} dir="ltr">
                      {rideRef(ticket.ride.rideId)}
                    </Link>
                  ) : (
                    <span dir="ltr">{rideRef(ticket.ride.rideId)}</span>
                  )}
                </>
              ) : null}
            </span>
          </div>
        </div>
      </header>

      {actionError ? (
        <p className="banner banner--error" role="alert">
          {actionError}
        </p>
      ) : null}

      <ReviewLayout
        aside={
          <div className="review-layout__aside">
            <section className="card section" aria-label={t('lostCase.progressTitle')}>
              <h2 className="section__heading">{t('lostCase.progressTitle')}</h2>
              <ol className="case-steps">
                {CASE_STAGES.map((stage, index) => {
                  const done = index <= reachedIndex;
                  return (
                    <li
                      key={stage.key}
                      className={
                        done
                          ? 'case-steps__step case-steps__step--done'
                          : 'case-steps__step case-steps__step--upcoming'
                      }
                    >
                      <span className="case-steps__dot" aria-hidden="true" />
                      <span>{stageLabel(stage, done)}</span>
                      {done && stageWhen(stage) ? (
                        <span className="case-steps__when">{stageWhen(stage)}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {canHandle && transitions.length > 0 ? (
                <>
                  {transitions.map((target, index) => (
                    <button
                      key={target}
                      type="button"
                      className={
                        target === 'not_found'
                          ? 'btn btn--danger-text btn--block'
                          : index === 0
                            ? 'btn btn--primary btn--block'
                            : 'btn btn--block'
                      }
                      disabled={busy}
                      onClick={() => void act(() => setCaseStatus(apiClient, ticketId, target))}
                    >
                      {t(`lostCase.moveTo.${target}`)}
                    </button>
                  ))}
                </>
              ) : null}
              <p className="panel__hint">{t('lostCase.progressHint')}</p>
            </section>
          </div>
        }
      >
        <Section title={t('lostCase.reportTitle')}>
          <p className="trust-quote" dir="auto">
            {ticket.description}
          </p>
          {ticket.attachments.length > 0 ? (
            <div className="photo-strip">
              {ticket.attachments.map((attachment, index) => {
                const src = resolveFileUrl(attachment.url, apiBaseUrl);
                return (
                  <a
                    key={attachment.fileId}
                    className="file-view"
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      className="file-view__img"
                      src={src}
                      alt={t('lostCase.photo', { n: index + 1 })}
                    />
                  </a>
                );
              })}
            </div>
          ) : null}
        </Section>

        {ticket.ride ? (
          <>
            <p className="panel__hint">
              {ticket.lostItem?.chatWindow === 'reopened'
                ? t('lostCase.chatReopened')
                : t('lostCase.chatReadOnly')}
            </p>
            <ChatLogCard
              rideId={ticket.ride.rideId}
              riderName={ticket.user.name}
              driverName={driver?.name ?? null}
              memberId={ticket.lostItem?.memberId ?? null}
            />
          </>
        ) : null}

        <TicketThread
          ticket={ticket}
          title={t('lostCase.threadTitle', { name: ticket.user.name })}
          composer={
            canHandle && caseStatus !== 'closed' ? (
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
            ) : caseStatus === 'closed' ? (
              <p className="panel__hint">{t('ticketDetail.closedReadOnly')}</p>
            ) : null
          }
        />
      </ReviewLayout>
    </section>
  );
}

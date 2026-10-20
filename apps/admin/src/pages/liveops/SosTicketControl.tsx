import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { listSosEvents, openSosTicket, type AdminSosEvent } from '../../api/comms';
import {
  getAdminTicket,
  listPickableTicketCategories,
  TICKET_PRIORITIES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../../api/support';
import { useAuth } from '../../auth/AuthContext';
import { usePermissions } from '../../auth/usePermissions';
import { StatusChip } from '../../ui';
import { localizedName, TICKET_STATUS_TONES, ticketRef } from '../support/support-format';

/** How far the 409 lookup walks the alert list for the winner's ticket. */
const LOOKUP_PAGE_SIZE = 50;

type FormError =
  | 'liveOps.sosTicket.errors.categoryUnavailable'
  | 'liveOps.sosTicket.errors.descriptionRequired'
  | 'liveOps.sosTicket.errors.failed'
  | 'liveOps.sosTicket.errors.categoriesFailed';

/**
 * The SOS-linked support ticket (UC-A-20 step 3, support-v1 ruling 9; V1
 * audit W16, board V1FAdminSosTicket) — on the live map's alert card and the
 * ride detail's SOS block. Once linked it is a "View ticket T-…" link to the
 * ticket (one per SOS). Before that, a `support:handle` admin opens the
 * inline form: category (the pickable ones — never Lost item or an inactive
 * one), priority (starts at the category's default) and a description; the
 * ticket belongs to the SOS caller, starts in progress and assigned to the
 * admin. A 409 `ticket_already_linked` (another admin was faster) shows
 * their ticket instead of a dead end.
 */
export function SosTicketControl({
  event,
  emphasis = 'secondary',
  onLinked,
}: {
  event: AdminSosEvent;
  /** The ride detail's SOS block makes the open action its primary (board). */
  emphasis?: 'primary' | 'secondary';
  /** The event now points at `ticketId` — the caller keeps it across re-reads. */
  onLinked?: (ticketId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canHandle = can('support:handle');
  const formId = useId();

  const [linkedId, setLinkedId] = useState<string | null>(event.ticketId ?? null);
  const [status, setStatus] = useState<TicketStatus | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [categories, setCategories] = useState<TicketCategory[] | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [alreadyLinked, setAlreadyLinked] = useState(false);

  // A ticket linked elsewhere (a re-read of the list) wins over the local state.
  useEffect(() => {
    if (event.ticketId) {
      setLinkedId(event.ticketId);
    }
  }, [event.ticketId]);

  // The linked ticket's status chip (board "Ticket T-… · In progress"); best effort.
  useEffect(() => {
    if (!linkedId || status !== null) {
      return;
    }
    let cancelled = false;
    getAdminTicket(apiClient, linkedId)
      .then((ticket) => {
        if (!cancelled) {
          setStatus(ticket.status);
        }
      })
      .catch(() => {
        // The link alone is enough to reach the ticket.
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, linkedId, status]);

  // The pickable categories, read when the form first opens.
  useEffect(() => {
    if (!formOpen || categories !== null) {
      return;
    }
    let cancelled = false;
    listPickableTicketCategories(apiClient)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        const sorted = [...loaded].sort((a, b) => a.sortOrder - b.sortOrder);
        setCategories(sorted);
        if (sorted.length > 0) {
          setCategoryId(sorted[0].ticketCategoryId);
          setPriority(sorted[0].defaultPriority);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('liveOps.sosTicket.errors.categoriesFailed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, formOpen, categories]);

  const category = categories?.find((item) => item.ticketCategoryId === categoryId) ?? null;

  function pickCategory(id: string) {
    setCategoryId(id);
    const picked = categories?.find((item) => item.ticketCategoryId === id);
    if (picked) {
      setPriority(picked.defaultPriority);
    }
    if (error === 'liveOps.sosTicket.errors.categoryUnavailable') {
      setError(null);
    }
  }

  function linked(ticketId: string, ticketStatus: TicketStatus | null) {
    setLinkedId(ticketId);
    setStatus(ticketStatus);
    setFormOpen(false);
    onLinked?.(ticketId);
  }

  /** Another admin opened the ticket first: find it on the alert list (best effort). */
  async function showWinner() {
    setAlreadyLinked(true);
    setFormOpen(false);
    try {
      const page = await listSosEvents(apiClient, {
        status: 'all',
        regionId: event.regionId,
        size: LOOKUP_PAGE_SIZE,
      });
      const current = page.items.find((item) => item.sosEventId === event.sosEventId);
      if (current?.ticketId) {
        linked(current.ticketId, null);
      }
    } catch {
      // The message stands on its own; the alert list's next read links it.
    }
  }

  async function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!category) {
      return;
    }
    if (description.trim() === '') {
      setError('liveOps.sosTicket.errors.descriptionRequired');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ticket = await openSosTicket(apiClient, event.sosEventId, {
        categoryId: category.ticketCategoryId,
        description: description.trim(),
        priority,
      });
      linked(ticket.ticketId, ticket.status);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        if (failure.code === 'ticket_already_linked') {
          await showWinner();
        } else {
          // category_inactive / category_reserved: the form stays open.
          setError('liveOps.sosTicket.errors.categoryUnavailable');
          setCategories(null);
        }
      } else {
        setError('liveOps.sosTicket.errors.failed');
      }
    } finally {
      setBusy(false);
    }
  }

  const winnerNotice = alreadyLinked ? (
    <p className="banner banner--error" role="alert">
      {t('liveOps.sosTicket.alreadyLinked')}
    </p>
  ) : null;

  if (linkedId) {
    const ref = ticketRef(linkedId);
    return (
      <div className="sos-ticket">
        {winnerNotice}
        <span className="sos-ticket__row">
          <span className="sos-ticket__ref">
            {t('liveOps.sosTicket.ticket')} <bdi dir="ltr">{ref}</bdi>
          </span>
          {status ? (
            <StatusChip tone={TICKET_STATUS_TONES[status]}>
              {t(`support.status.${status}`)}
            </StatusChip>
          ) : null}
        </span>
        <Link className={alreadyLinked ? 'btn btn--primary' : 'btn'} to={`/support/${linkedId}`}>
          {t('liveOps.sosTicket.view')} <bdi dir="ltr">{ref}</bdi>
        </Link>
      </div>
    );
  }

  if (!canHandle) {
    return winnerNotice;
  }

  if (!formOpen) {
    return (
      <div className="sos-ticket">
        {winnerNotice}
        <button
          className={emphasis === 'primary' ? 'btn btn--primary' : 'btn'}
          type="button"
          onClick={() => {
            setError(null);
            setFormOpen(true);
          }}
        >
          {t('liveOps.sosTicket.open')}
        </button>
      </div>
    );
  }

  const callerHint = t(
    event.triggeredByRole === 'driver'
      ? 'liveOps.sosTicket.forDriver'
      : 'liveOps.sosTicket.forRider',
    { name: event.triggeredBy.name },
  );

  return (
    <form
      className="sos-ticket sos-ticket--form"
      aria-labelledby={`${formId}-title`}
      onSubmit={(submitEvent) => void submit(submitEvent)}
    >
      <span id={`${formId}-title`} className="sos-ticket__title">
        {t('liveOps.sosTicket.open')}
      </span>
      <span className="sos-ticket__hint">
        <bdi>{callerHint}</bdi>
      </span>
      {categories === null && error === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : null}
      {categories !== null ? (
        <>
          <label className="sos-ticket__field">
            {t('liveOps.sosTicket.category')}
            <select
              value={categoryId}
              disabled={busy}
              onChange={(change) => pickCategory(change.target.value)}
            >
              {categories.map((item) => (
                <option key={item.ticketCategoryId} value={item.ticketCategoryId}>
                  {localizedName(item.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
          <label className="sos-ticket__field">
            {t('liveOps.sosTicket.priority')}
            <select
              value={priority}
              disabled={busy}
              onChange={(change) => setPriority(change.target.value as TicketPriority)}
            >
              {TICKET_PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {option === category?.defaultPriority
                    ? t('liveOps.sosTicket.priorityDefault', {
                        priority: t(`support.priority.${option}`),
                      })
                    : t(`support.priority.${option}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="sos-ticket__field">
            {t('liveOps.sosTicket.description')}
            <textarea
              rows={4}
              maxLength={4000}
              value={description}
              disabled={busy}
              onChange={(change) => setDescription(change.target.value)}
            />
          </label>
        </>
      ) : null}
      {error ? (
        <p className="banner banner--error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <span className="sos-ticket__actions">
        <button
          className="btn btn--primary sos-ticket__submit"
          type="submit"
          disabled={busy || category === null}
        >
          {busy ? t('liveOps.sosTicket.opening') : t('liveOps.sosTicket.submit')}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() => {
            setFormOpen(false);
            setError(null);
          }}
        >
          {t('common.cancel')}
        </button>
      </span>
    </form>
  );
}

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdminTicketDetail, TicketEvent, TicketMessage } from '../../api/support';
import { Section } from '../../ui';
import { formatMoment } from '../money/money-format';

type ThreadItem =
  | { kind: 'opening'; at: string }
  | { kind: 'message'; at: string; message: TicketMessage }
  | { kind: 'event'; at: string; event: TicketEvent };

/**
 * The ticket's conversation (UC-A-21 step 2): the opening description, then
 * user and support messages as chat bubbles with the event history (status,
 * priority, assignment, reminders) inline between them, oldest first. User
 * bubbles sit at the inline start, support at the end — mirrored in RTL by
 * the chat-log styles. Shared by the ticket detail and lost-item case pages.
 */
export function TicketThread({
  ticket,
  attachments,
  composer,
  title,
}: {
  ticket: AdminTicketDetail;
  /** Rendered inside the opening bubble (attachment links). */
  attachments?: ReactNode;
  /** The reply form (or a read-only note) under the thread. */
  composer?: ReactNode;
  title?: string;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  const items: ThreadItem[] = [
    ...ticket.messages.map((message): ThreadItem => {
      return { kind: 'message', at: message.createdAt, message };
    }),
    // The `created` event renders as the opening bubble's own chip instead.
    ...ticket.events
      .filter((event) => event.type !== 'created')
      .map((event): ThreadItem => {
        return { kind: 'event', at: event.createdAt, event };
      }),
    // By instant, not string: the server's precision varies (`…:00Z` vs
    // `…:00.123Z`); the stable sort keeps server order for equal instants.
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  function eventText(event: TicketEvent): string {
    const when = formatMoment(event.createdAt, language);
    switch (event.type) {
      case 'status_changed':
        return t('ticketDetail.event.status', {
          from: t(`support.status.${event.fromValue ?? 'open'}`),
          to: t(`support.status.${event.toValue ?? 'open'}`),
          when,
        });
      case 'priority_changed':
        return t('ticketDetail.event.priority', {
          from: t(`support.priority.${event.fromValue ?? 'normal'}`),
          to: t(`support.priority.${event.toValue ?? 'normal'}`),
          when,
        });
      case 'assigned':
        return event.toValue === null
          ? t('ticketDetail.event.unassigned', { name: event.actorName ?? '—', when })
          : t('ticketDetail.event.assigned', { name: event.actorName ?? '—', when });
      case 'case_status_changed':
        return t('ticketDetail.event.caseStatus', {
          from: t(`lostItems.caseStatus.${event.fromValue ?? 'reported'}`),
          to: t(`lostItems.caseStatus.${event.toValue ?? 'reported'}`),
          when,
        });
      case 'reminder_sent':
        return t('ticketDetail.event.reminder', { when });
      default:
        return when;
    }
  }

  return (
    <Section
      title={title ?? t('ticketDetail.threadTitle')}
      actions={
        ticket.attachments.length > 0 ? (
          <span className="panel__hint">
            {t('ticketDetail.attachmentCount', { count: ticket.attachments.length })}
          </span>
        ) : undefined
      }
    >
      <ol className="chat-log thread">
        <li className="thread__event">
          {t('ticketDetail.event.opened', { when: formatMoment(ticket.createdAt, language) })}
        </li>
        <li className="chat-log__bubble chat-log__bubble--driver">
          <span className="chat-log__meta">
            <span dir="auto">{ticket.user.name}</span> · {t(`trust.role.${ticket.user.role}`)}
          </span>
          <span className="chat-log__text" dir="auto">
            {ticket.description}
          </span>
          {attachments}
        </li>
        {items.map((item) =>
          item.kind === 'event' ? (
            <li key={item.event.eventId} className="thread__event">
              {eventText(item.event)}
            </li>
          ) : item.kind === 'message' ? (
            <li
              key={item.message.messageId}
              className={
                item.message.senderSide === 'user'
                  ? 'chat-log__bubble chat-log__bubble--driver'
                  : 'chat-log__bubble chat-log__bubble--rider'
              }
            >
              <span className="chat-log__meta">
                <span dir="auto">{item.message.senderName}</span>
                {' · '}
                {formatMoment(item.message.createdAt, language)}
              </span>
              <span className="chat-log__text" dir="auto">
                {item.message.body}
              </span>
            </li>
          ) : null,
        )}
      </ol>
      {composer}
    </Section>
  );
}

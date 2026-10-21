import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { CaseStatus, TicketStatus } from '../../api/support';
import {
  getAdminRideRelated,
  type AdminRelatedParty,
  type AdminRideRelated,
} from '../../api/rides';
import type { ReportStatus } from '../../api/trust';
import { useAuth } from '../../auth/AuthContext';
import { bdiMark, Section, StatusChip, withBdi, type ChipTone } from '../../ui';
import { formatMoment } from '../money/money-format';
import { CASE_STATUS_TONES, TICKET_STATUS_TONES } from '../support/support-format';
import { REPORT_STATUS_TONES } from '../trust/trust-format';

type Icon = 'report' | 'ticket' | 'lost' | 'sos';

const ICON_PATHS: Record<Icon, ReactNode> = {
  report: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  ticket: <path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4a2 2 0 0 1 0-4V6H3z" />,
  lost: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.6" y2="16.6" />
    </>
  ),
  sos: (
    <>
      <path d="M12 3 2.5 20h19z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </>
  ),
};

interface RowProps {
  icon: Icon;
  title: ReactNode;
  sub: ReactNode;
  chip: { tone: ChipTone; label: string };
  /** The record's page; without it the row is plain text. */
  to?: string;
}

function RelatedRow({ icon, title, sub, chip, to }: RowProps) {
  const { t } = useTranslation();
  const body = (
    <>
      <span className="related__icon" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICON_PATHS[icon]}
        </svg>
      </span>
      <span className="related__text">
        <span className="related__title">{title}</span>
        <span className="related__sub">{sub}</span>
      </span>
      <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      {to ? <span className="related__open">{t('rideDetail.related.open')}</span> : null}
    </>
  );
  return (
    <li className="related__item">
      {to ? (
        <Link className="related__row" to={to}>
          {body}
        </Link>
      ) : (
        <span className="related__row">{body}</span>
      )}
    </li>
  );
}

/**
 * UC-A-18 "related reports/tickets/SOS" on the ride detail (V1 audit W15,
 * board V1FAdminRideRelated) over GET /admin/rides/{id}/related: the ride's
 * reports (reports:view), support tickets, lost-item cases and SOS events
 * (support:view), each group shown only when the server served it, each row
 * opening its record. Best effort — the ride detail stands without it.
 */
export function RelatedCard({ rideId }: { rideId: string }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const [related, setRelated] = useState<AdminRideRelated | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRelated(null);
    getAdminRideRelated(apiClient, rideId)
      .then((loaded) => !cancelled && setRelated(loaded))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient, rideId]);

  if (related === null) {
    return null;
  }
  const { reports, tickets, lostItems, sos } = related;
  const groups = [reports, tickets, lostItems, sos].filter((group) => group !== undefined);
  if (groups.length === 0) {
    // The admin may see none of the sections.
    return null;
  }

  const party = (key: string, who: AdminRelatedParty, values: Record<string, string> = {}) =>
    withBdi(
      t(key, {
        ...values,
        role: t(`rideDetail.related.role.${who.role}`),
        name: bdiMark(who.name),
      }),
    );
  const when = (at: string) => formatMoment(at, language);

  if (groups.every((group) => group.length === 0)) {
    return (
      <Section title={t('rideDetail.related.title')} ariaLabel={t('rideDetail.related.title')}>
        <p className="panel__hint">{t('rideDetail.related.empty')}</p>
      </Section>
    );
  }

  function group(key: string, count: number, emptyKey: string, rows: ReactNode) {
    return (
      <div className="related__group">
        <span className="related__group-title">{t(`rideDetail.related.${key}`, { n: count })}</span>
        {count === 0 ? (
          <p className="related__none">{t(emptyKey)}</p>
        ) : (
          <ul className="related__list">{rows}</ul>
        )}
      </div>
    );
  }

  return (
    <Section
      title={t('rideDetail.related.title')}
      ariaLabel={t('rideDetail.related.title')}
      className="related"
    >
      {reports
        ? group(
            'reports',
            reports.length,
            'rideDetail.related.noReports',
            reports.map((report) => (
              <RelatedRow
                key={report.id}
                icon="report"
                to={`/reports/${report.id}`}
                title={party('rideDetail.related.reportTitle', report.reporter, {
                  category: t(`reports.category.${report.category}`, report.category),
                })}
                sub={party('rideDetail.related.reportSub', report.reported, {
                  when: when(report.createdAt),
                })}
                chip={{
                  tone: REPORT_STATUS_TONES[report.status as ReportStatus] ?? 'neutral',
                  label: t(`reports.status.${report.status}`, report.status),
                }}
              />
            )),
          )
        : null}
      {tickets
        ? group(
            'tickets',
            tickets.length,
            'rideDetail.related.noTickets',
            tickets.map((ticket) => (
              <RelatedRow
                key={ticket.id}
                icon="ticket"
                to={`/support/${ticket.id}`}
                title={
                  <>
                    {language.startsWith('ar') ? ticket.categoryNameAr : ticket.categoryNameEn}
                    {' · '}
                    <bdi>{ticket.summary}</bdi>
                  </>
                }
                sub={party('rideDetail.related.recordSub', ticket.user, {
                  ref: bdiMark(`T-${ticket.ref}`),
                  when: when(ticket.createdAt),
                })}
                chip={{
                  tone: TICKET_STATUS_TONES[ticket.status as TicketStatus] ?? 'neutral',
                  label: t(`support.status.${ticket.status}`, ticket.status),
                }}
              />
            )),
          )
        : null}
      {lostItems
        ? group(
            'lostItems',
            lostItems.length,
            'rideDetail.related.noLostItems',
            lostItems.map((item) => (
              <RelatedRow
                key={item.id}
                icon="lost"
                to={`/lost-items/${item.id}`}
                title={<bdi>{item.summary}</bdi>}
                sub={party('rideDetail.related.recordSub', item.user, {
                  ref: bdiMark(`L-${item.ref}`),
                  when: when(item.createdAt),
                })}
                chip={{
                  tone: CASE_STATUS_TONES[item.caseStatus as CaseStatus] ?? 'neutral',
                  label: t(`lostItems.caseStatus.${item.caseStatus}`, item.caseStatus),
                }}
              />
            )),
          )
        : null}
      {sos
        ? group(
            'sos',
            sos.length,
            'rideDetail.related.noSos',
            sos.map((event) => (
              <RelatedRow
                key={event.id}
                icon="sos"
                to={event.ticketId ? `/support/${event.ticketId}` : undefined}
                title={party('rideDetail.related.sosTitle', event.triggeredBy)}
                sub={when(event.triggeredAt)}
                chip={
                  event.acknowledged
                    ? { tone: 'neutral', label: t('liveOps.sos.acknowledgedChip') }
                    : { tone: 'danger', label: t('liveOps.sos.status.open') }
                }
              />
            )),
          )
        : null}
    </Section>
  );
}

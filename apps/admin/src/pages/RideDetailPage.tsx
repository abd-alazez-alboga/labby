import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import type { AdminSosEvent } from '../api/comms';
import { listRegions } from '../api/regions';
import {
  getAdminRide,
  type AdminRideDetail,
  type AdminSharedMember,
  type OfferTrailEntry,
} from '../api/rides';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { bdiMark, Section, StatusChip, withBdi, type ChipTone } from '../ui';
import { formatMoment, formatMoney, formatNumber } from './money/money-format';
import { SosTicketControl } from './liveops/SosTicketControl';
import { ChatLogCard } from './rides/ChatLogCard';
import { RelatedCard } from './rides/RelatedCard';
import {
  buildTimeline,
  fareLines,
  fetchRideSosEvents,
  type TimelineMoment,
} from './rides/ride-detail-utils';
import { liveOpsLink, rideRef, rideStateTone } from './rides/ride-format';
import { RideTraceMap } from './rides/RideTraceMap';
import { formatClock, formatMultiplier, isolateLtr } from './surge';

/**
 * UC-A-18 full truth of one ride (rides:view): state timeline — including
 * the permanent SOS moments (SAFE-02) — offers trail, fare components, the
 * GPS trace on runtime tiles, and the CHAT-03 read-only chat log
 * (support:view only). Party phones follow the artboard note: they need
 * support:handle. The live map's pins and the rides search both land here.
 * A shared ride (M12, artboard A12ChatLogMembers) adds the "Shared · N seats"
 * chip, the creator / parties meta and the Members card (status and per-member
 * payment or fee). User names sit in <bdi> so Arabic names never reorder the
 * separators around them (V1 audit I107), and link to the user's profile
 * with users:view. "Refund rider" (wallets:manage + wallets:view, V1 audit
 * W28, board V1FAdminRideRefund) opens the rider's wallet with Refund and
 * this ride pre-selected; on a shared ride it first asks which member (any
 * member, by MemberView.riderUserId). The Related card (V1 audit W15, board
 * V1FAdminRideRelated) lists the ride's reports, tickets, lost items and SOS.
 */
export default function RideDetailPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { rideId } = useParams<{ rideId: string }>();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canSupportView = can('support:view');
  const canHandle = can('support:handle');
  const canRegionsView = can('regions:view');
  const canUsersView = can('users:view');
  // W28: the refund lands on the wallet page, which itself needs wallets:view.
  const canRefund = can('wallets:manage') && can('wallets:view');

  const [detail, setDetail] = useState<AdminRideDetail | null>(null);
  const [pickingMember, setPickingMember] = useState(false);
  const [error, setError] = useState<'notFound' | 'failed' | null>(null);
  const [sosEvents, setSosEvents] = useState<AdminSosEvent[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [regionName, setRegionName] = useState<string | null>(null);

  useEffect(() => {
    if (!rideId) {
      return;
    }
    let cancelled = false;
    setDetail(null);
    setPickingMember(false);
    setError(null);
    setSosEvents([]);
    getAdminRide(apiClient, rideId)
      .then(async (loaded) => {
        if (cancelled) {
          return;
        }
        setDetail(loaded);
        if (canSupportView) {
          // The SOS facts live on the alert list (support:view); best effort.
          try {
            const events = await fetchRideSosEvents(
              apiClient,
              loaded.ride.id,
              loaded.ride.regionId,
              loaded.ride.timeline.requestedAt,
            );
            if (!cancelled) {
              setSosEvents(events);
            }
          } catch {
            // The detail stands on its own without the SOS rail.
          }
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setError(failure instanceof ApiError && failure.status === 404 ? 'notFound' : 'failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, rideId, canSupportView, attempt]);

  const regionId = detail?.ride.regionId ?? null;
  useEffect(() => {
    setRegionName(null);
    if (!regionId || !canRegionsView) {
      return;
    }
    // The detail carries only the region id; its name is a best-effort lookup (regions:view).
    let cancelled = false;
    listRegions(apiClient)
      .then((regions) => {
        if (!cancelled) {
          setRegionName(regions.find((region) => region.id === regionId)?.name ?? null);
        }
      })
      .catch(() => {
        // The meta line simply goes without the region.
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, regionId, canRegionsView]);

  const moments = useMemo(
    () => (detail ? buildTimeline(detail.ride.timeline, sosEvents) : []),
    [detail, sosEvents],
  );

  const breadcrumb = (
    <nav className="breadcrumb" aria-label={t('surgeLive.breadcrumbLabel')}>
      <Link to="/rides">{t('nav.rides')}</Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page" dir="ltr">
        {rideId ? rideRef(rideId) : ''}
      </span>
    </nav>
  );

  if (detail === null) {
    return (
      <section className="page">
        {breadcrumb}
        {error === 'notFound' ? (
          <p className="banner banner--error" role="alert">
            {t('rideDetail.errors.notFound')}
          </p>
        ) : error === 'failed' ? (
          <p className="banner banner--error" role="alert">
            {t('rideDetail.errors.loadFailed')}{' '}
            <button
              className="btn btn--small"
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {t('surgeLive.retry')}
            </button>
          </p>
        ) : (
          <div className="loading">{t('common.loading')}</div>
        )}
      </section>
    );
  }

  const { ride } = detail;
  const openSos = sosEvents.find((event) => event.acknowledged === null);
  const acceptedOffer = detail.offers.find((offer) => offer.response === 'accepted');
  const serviceTypeName = language.startsWith('ar')
    ? ride.serviceTypeNameAr
    : ride.serviceTypeNameEn;
  const currencyLabel = (code: string) => t(`money.currency.${code}`, code);
  const money = (amount: number, currency: string) =>
    isolateLtr(formatMoney(amount, currencyLabel(currency), language));
  const fare = ride.fare ?? null;
  const components = fare ? fare.components : ride.estimate.components;

  /** The user's wallet with Refund selected and this ride linked (V1 audit W28). */
  const refundLink = (userId: string) =>
    `/users/${userId}/wallet?${new URLSearchParams({ refundRide: ride.id })}`;
  /** A party's name links to their profile when the admin may open it (V1FAdminRideRefund). */
  const profileLink = (userId: string | null | undefined, name: string) =>
    canUsersView && userId
      ? (isolated: ReactNode) => (
          <Link className="ride-detail__party" to={`/users/${userId}/trust`} state={{ name }}>
            {isolated}
          </Link>
        )
      : undefined;

  const shared = ride.kind === 'shared' ? (ride.shared ?? null) : null;
  // Pre-dispatch leavers never rode: not a party, no chat thread.
  const parties = (shared?.members ?? []).filter((member) => member.status !== 'left');

  function momentTitle(moment: TimelineMoment): ReactNode {
    switch (moment.kind) {
      case 'accepted':
        return detail!.driverName
          ? withBdi(t('rideDetail.timeline.acceptedBy', { name: bdiMark(detail!.driverName) }))
          : t('rideDetail.timeline.accepted');
      case 'cancelled':
        return t(
          ride.state === 'cancelled_by_driver'
            ? 'rideDetail.timeline.cancelledByDriver'
            : 'rideDetail.timeline.cancelledByRider',
        );
      case 'sos':
        return t(
          moment.sos?.triggeredByRole === 'driver'
            ? 'rideDetail.timeline.sosByDriver'
            : 'rideDetail.timeline.sosByRider',
        );
      default:
        return t(`rideDetail.timeline.${moment.kind}`);
    }
  }

  function momentDetail(moment: TimelineMoment): ReactNode {
    switch (moment.kind) {
      case 'requested':
        return t('rideDetail.timeline.requestedDetail', {
          estimate: money(ride.estimate.components.total, ride.estimate.components.currency),
          surge: isolateLtr(formatMultiplier(ride.surgeMultiplier, language)),
        });
      case 'accepted':
        return acceptedOffer
          ? t('rideDetail.timeline.acceptedDetail', {
              sequence: acceptedOffer.sequence,
              distance: formatNumber(acceptedOffer.pickupDistanceMeters / 1000, language),
            })
          : null;
      case 'cancelled':
        return [
          ride.cancellationReason
            ? t(`rideDetail.cancellationReason.${ride.cancellationReason}`, ride.cancellationReason)
            : null,
          detail!.cancellationNote ? `“${detail!.cancellationNote}”` : null,
          ride.cancellationFee
            ? t('rideDetail.timeline.cancellationFee', {
                amount: money(ride.cancellationFee, components.currency),
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ');
      case 'sos':
        return moment.sos?.acknowledged
          ? withBdi(
              t('rideDetail.timeline.sosAcknowledged', {
                name: bdiMark(moment.sos.acknowledged.byName),
                time: formatClock(moment.sos.acknowledged.at, language),
              }),
            )
          : t('rideDetail.timeline.sosPermanent');
      default:
        return null;
    }
  }

  function offerResponse(offer: OfferTrailEntry): { label: string; className: string } {
    const at = offer.respondedAt ?? offer.expiresAt;
    const time = formatClock(at, language);
    switch (offer.response) {
      case 'accepted':
        return { label: t('rideDetail.offers.accepted', { time }), className: 'offer--accepted' };
      case 'declined':
        return { label: t('rideDetail.offers.declined', { time }), className: 'offer--declined' };
      case 'timeout':
        return { label: t('rideDetail.offers.timeout', { time }), className: 'offer--declined' };
      case 'withdrawn':
        return { label: t('rideDetail.offers.withdrawn', { time }), className: 'offer--muted' };
      default:
        return { label: t('rideDetail.offers.open'), className: 'offer--muted' };
    }
  }

  function memberRow(member: AdminSharedMember, index: number) {
    const name = member.firstName?.trim() || t('rideDetail.chat.memberFallback', { n: index + 1 });
    const status = t(`rideDetail.members.status.${member.status}`);
    let outcome = status;
    let tone: ChipTone = 'neutral';
    if (member.status === 'completed') {
      tone = 'success';
      if (member.paymentStatus) {
        outcome = `${status} · ${t(`rideDetail.members.payment.${member.paymentStatus}`)}`;
      }
    } else if (member.status === 'no_show' || member.status === 'cancelled') {
      tone = member.status === 'no_show' || member.cancellationFee ? 'danger' : 'neutral';
      if (member.cancellationFee) {
        outcome = `${status} · ${t('rideDetail.members.feeCharged')}`;
      }
    }
    return (
      <li key={member.memberId} className="member-list__row">
        <span className="member-list__name">
          <bdi>{name}</bdi>
          {member.isCreator ? ` · ${t('rideDetail.members.creator')}` : null}
          {` · ${t('rideDetail.members.partyOf', { count: member.partySize })}`}
        </span>
        <StatusChip tone={tone}>{outcome}</StatusChip>
      </li>
    );
  }

  const phones =
    canHandle && detail.riderPhone ? (
      <>
        {' '}
        (
        <a href={`tel:${detail.riderPhone}`} dir="ltr">
          {detail.riderPhone}
        </a>
        )
      </>
    ) : null;
  const driverPhone =
    canHandle && detail.driverPhone ? (
      <>
        {' '}
        (
        <a href={`tel:${detail.driverPhone}`} dir="ltr">
          {detail.driverPhone}
        </a>
        )
      </>
    ) : null;

  return (
    <section className="page">
      {breadcrumb}
      <header className="page-header">
        <div className="page-header__main">
          <div className="page-header__text">
            <h1 className="page-header__title">
              {withBdi(t('rideDetail.title', { ref: bdiMark(rideRef(ride.id)) }))}
            </h1>
          </div>
          <div className="page-header__meta ride-detail__chips">
            {shared?.totalSeats ? (
              <StatusChip tone="accent">
                {t('rideDetail.sharedChip', { count: shared.totalSeats })}
              </StatusChip>
            ) : null}
            <StatusChip tone={rideStateTone(ride.state)}>
              {t(`money.rideState.${ride.state}`)}
            </StatusChip>
            {openSos ? (
              <span className="sos-chip">
                {t('rideDetail.sosOpenChip', {
                  time: formatClock(openSos.triggeredAt, language),
                })}
              </span>
            ) : null}
          </div>
        </div>
        {canRefund ? (
          <div className="page-header__actions">
            {shared ? (
              <button
                className="btn btn--primary"
                type="button"
                aria-expanded={pickingMember}
                onClick={() => setPickingMember((open) => !open)}
              >
                {t('rideDetail.refund.action')}
              </button>
            ) : (
              <Link
                className="btn btn--primary"
                to={refundLink(detail.riderUserId)}
                state={{ name: detail.riderName }}
              >
                {t('rideDetail.refund.action')}
              </Link>
            )}
          </div>
        ) : null}
      </header>
      {canRefund && shared && pickingMember ? (
        <section
          className="card section refund-picker"
          aria-label={t('rideDetail.refund.pickTitle')}
        >
          <h2 className="section__heading">{t('rideDetail.refund.pickTitle')}</h2>
          <ul className="refund-picker__list">
            {parties.map((member, index) => {
              // MemberView.riderUserId (admin view) names every member's account.
              const userId = member.riderUserId ?? (member.isCreator ? detail.riderUserId : null);
              const name =
                member.firstName?.trim() || t('rideDetail.chat.memberFallback', { n: index + 1 });
              const label = (
                <>
                  <bdi>{name}</bdi>
                  {member.isCreator ? ` · ${t('rideDetail.members.creator')}` : null}
                  {` · ${t('rideDetail.members.partyOf', { count: member.partySize })}`}
                </>
              );
              return (
                <li key={member.memberId}>
                  {userId ? (
                    <Link
                      className="btn refund-picker__member"
                      to={refundLink(userId)}
                      state={member.isCreator ? { name: detail.riderName } : undefined}
                    >
                      {label}
                    </Link>
                  ) : (
                    <span className="btn refund-picker__member" aria-disabled="true">
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {parties.some((member) => !member.isCreator && !member.riderUserId) ? (
            <p className="panel__hint">{t('rideDetail.refund.memberUnavailable')}</p>
          ) : null}
        </section>
      ) : null}
      <p className="ride-detail__meta">
        {formatMoment(ride.timeline.requestedAt, language)}
        {regionName ? (
          <>
            {' · '}
            <bdi>{regionName}</bdi>
          </>
        ) : null}
        {' · '}
        {serviceTypeName}
        {shared ? null : (
          <>
            {' · '}
            {t(`rideDetail.payment.${ride.paymentMethod}`)}
          </>
        )}
        {' · '}
        {withBdi(
          t(shared ? 'rideDetail.parties.creator' : 'rideDetail.parties.rider', {
            name: bdiMark(detail.riderName),
          }),
          profileLink(detail.riderUserId, detail.riderName),
        )}
        {phones}
        {detail.driverName ? (
          <>
            {' · '}
            {withBdi(
              t('rideDetail.parties.driver', { name: bdiMark(detail.driverName) }),
              profileLink(detail.driverUserId, detail.driverName),
            )}
            {driverPhone}
          </>
        ) : null}
        {shared ? (
          <>
            {' · '}
            {t('rideDetail.parties.count', { count: parties.length })}
          </>
        ) : null}
        {canHandle ? null : <> — {t('rideDetail.parties.phonesNeedHandle')}</>}
      </p>

      {openSos ? (
        <div className="sos-banner" role="alert">
          <span className="sos-banner__text">
            <strong>
              {withBdi(
                t('rideDetail.sosBanner', {
                  name: bdiMark(openSos.triggeredBy.name),
                  time: formatClock(openSos.triggeredAt, language),
                }),
              )}
            </strong>
            <span>{t('rideDetail.sosBannerHint')}</span>
          </span>
          <Link className="btn sos-banner__focus" to={liveOpsLink(openSos)}>
            {t('rideDetail.openLiveMap')}
          </Link>
        </div>
      ) : null}

      <div className="ride-detail">
        <div className="ride-detail__column">
          {shared ? (
            <Section title={t('rideDetail.members.title')}>
              <ul className="member-list">{shared.members.map(memberRow)}</ul>
            </Section>
          ) : null}

          <Section title={t('rideDetail.timelineTitle')}>
            <ol className="timeline">
              {moments.map((moment, index) => (
                <li
                  key={`${moment.kind}-${moment.at}-${index}`}
                  className={
                    moment.kind === 'sos' ? 'timeline__item timeline__item--sos' : 'timeline__item'
                  }
                >
                  <span className="timeline__title">
                    {momentTitle(moment)} · {formatClock(moment.at, language)}
                  </span>
                  {momentDetail(moment) ? (
                    <span className="timeline__detail">{momentDetail(moment)}</span>
                  ) : null}
                  {/* The SOS block's linked support ticket (UC-A-20 step 3, V1 audit W16). */}
                  {moment.sos ? <SosTicketControl event={moment.sos} emphasis="primary" /> : null}
                </li>
              ))}
            </ol>
          </Section>

          <Section title={t('rideDetail.offersTitle')}>
            {detail.offers.length === 0 ? (
              <p className="panel__hint">{t('rideDetail.offers.empty')}</p>
            ) : (
              <ul className="offer-trail">
                {detail.offers.map((offer) => {
                  const response = offerResponse(offer);
                  return (
                    <li key={offer.offerId} className="offer-trail__row">
                      <span>
                        {withBdi(
                          t('rideDetail.offers.entry', {
                            name: bdiMark(offer.driverName),
                            distance: formatNumber(offer.pickupDistanceMeters / 1000, language),
                          }),
                        )}
                      </span>
                      <span className={response.className}>{response.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title={t('rideDetail.fareTitle')}>
            <dl className="fare-lines">
              {fareLines(components).map((line) => (
                <div key={line.key} className="fare-lines__row">
                  <dt>{t(`rideDetail.fare.${line.key}`)}</dt>
                  <dd>{money(line.amount, components.currency)}</dd>
                </div>
              ))}
              <div className="fare-lines__row fare-lines__row--total">
                <dt>{fare ? t('rideDetail.fare.total') : t('rideDetail.fare.estimateTotal')}</dt>
                <dd>{money(components.total, components.currency)}</dd>
              </div>
              {ride.tip ? (
                <div className="fare-lines__row">
                  <dt>{t('rideDetail.fare.tip')}</dt>
                  <dd>{money(ride.tip, components.currency)}</dd>
                </div>
              ) : null}
            </dl>
            {ride.paymentStatus ? (
              <p className="panel__hint">{t(`rideDetail.paymentStatus.${ride.paymentStatus}`)}</p>
            ) : null}
          </Section>
        </div>

        <div className="ride-detail__column">
          <section className="card section">
            {detail.trace.length > 0 ? (
              <>
                <RideTraceMap
                  label={t('rideDetail.traceLabel')}
                  trace={detail.trace}
                  pickup={ride.pickup}
                  destination={ride.destination}
                  stops={ride.stops ?? []}
                  sosEvents={sosEvents}
                />
                <p className="panel__hint">
                  {sosEvents.length > 0
                    ? t('rideDetail.traceCaptionSos', {
                        time: formatClock(sosEvents[0].triggeredAt, language),
                      })
                    : t('rideDetail.traceCaption')}
                </p>
              </>
            ) : (
              <p className="panel__hint">{t('rideDetail.noTrace')}</p>
            )}
          </section>

          <RelatedCard rideId={ride.id} />

          {canSupportView ? (
            <ChatLogCard
              rideId={ride.id}
              riderName={detail.riderName}
              driverName={detail.driverName ?? null}
              members={shared ? parties : null}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

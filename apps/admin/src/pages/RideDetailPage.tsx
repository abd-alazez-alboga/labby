import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import type { AdminSosEvent } from '../api/comms';
import { getAdminRide, type AdminRideDetail, type OfferTrailEntry } from '../api/rides';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { Section, StatusChip } from '../ui';
import { formatMoment, formatMoney, formatNumber } from './money/money-format';
import { ChatLogCard } from './rides/ChatLogCard';
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
 */
export default function RideDetailPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { rideId } = useParams<{ rideId: string }>();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canSupportView = can('support:view');
  const canHandle = can('support:handle');

  const [detail, setDetail] = useState<AdminRideDetail | null>(null);
  const [error, setError] = useState<'notFound' | 'failed' | null>(null);
  const [sosEvents, setSosEvents] = useState<AdminSosEvent[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!rideId) {
      return;
    }
    let cancelled = false;
    setDetail(null);
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

  function momentTitle(moment: TimelineMoment): string {
    switch (moment.kind) {
      case 'accepted':
        return detail!.driverName
          ? t('rideDetail.timeline.acceptedBy', { name: detail!.driverName })
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

  function momentDetail(moment: TimelineMoment): string | null {
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
          ? t('rideDetail.timeline.sosAcknowledged', {
              name: moment.sos.acknowledged.byName,
              time: formatClock(moment.sos.acknowledged.at, language),
            })
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
            <h1 className="page-header__title" dir="ltr">
              {t('rideDetail.title', { ref: rideRef(ride.id) })}
            </h1>
          </div>
          <div className="page-header__meta ride-detail__chips">
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
      </header>
      <p className="ride-detail__meta">
        {formatMoment(ride.timeline.requestedAt, language)}
        {' · '}
        {serviceTypeName}
        {' · '}
        {t(`rideDetail.payment.${ride.paymentMethod}`)}
        {' · '}
        {t('rideDetail.parties.rider', { name: detail.riderName })}
        {phones}
        {detail.driverName ? (
          <>
            {' · '}
            {t('rideDetail.parties.driver', { name: detail.driverName })}
            {driverPhone}
          </>
        ) : null}
        {canHandle ? null : <> — {t('rideDetail.parties.phonesNeedHandle')}</>}
      </p>

      {openSos ? (
        <div className="sos-banner" role="alert">
          <span className="sos-banner__text">
            <strong>
              {t('rideDetail.sosBanner', {
                name: openSos.triggeredBy.name,
                time: formatClock(openSos.triggeredAt, language),
              })}
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
                        {t('rideDetail.offers.entry', {
                          name: offer.driverName,
                          distance: formatNumber(offer.pickupDistanceMeters / 1000, language),
                        })}
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

          {canSupportView ? (
            <ChatLogCard
              rideId={ride.id}
              riderName={detail.riderName}
              driverName={detail.driverName ?? null}
              members={
                ride.kind === 'shared'
                  ? (ride.shared?.members ?? []).filter((member) => member.status !== 'left')
                  : null
              }
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

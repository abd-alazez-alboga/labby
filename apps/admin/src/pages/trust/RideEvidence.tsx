import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ApiError } from '../../api/client';
import type { AdminSosEvent } from '../../api/comms';
import { getAdminRide, type AdminRideDetail } from '../../api/rides';
import { useAuth } from '../../auth/AuthContext';
import { usePermissions } from '../../auth/usePermissions';
import { Section } from '../../ui';
import { formatMoment, formatMoney, formatNumber } from '../money/money-format';
import { ChatLogCard } from '../rides/ChatLogCard';
import { fetchRideSosEvents } from '../rides/ride-detail-utils';
import { rideRef } from '../rides/ride-format';
import { RideTraceMap } from '../rides/RideTraceMap';
import { formatClock, isolateLtr } from '../surge';

/**
 * UC-A-17 step 2 evidence panel: the reported ride's facts + GPS trace
 * (reused from the M10 ride detail; `rides:view`) and its read-only chat log
 * (`support:view`, CHAT-03). Without a permission the matching section says
 * what it needs instead of loading — the report itself only carries the id.
 */
export function RideEvidence({
  rideId,
  riderName,
  driverName,
}: {
  rideId: string;
  /** The parties' names, from the report (the chat bubbles' labels). */
  riderName: string;
  driverName: string;
}) {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const canRides = can('rides:view');
  const canSupport = can('support:view');

  return (
    <>
      {canRides ? (
        <RideFacts rideId={rideId} withSos={canSupport} />
      ) : (
        <Section title={t('reportDetail.ride.titleBare', { ref: rideRef(rideId) })}>
          <p className="panel__hint">{t('reportDetail.ride.needsRides')}</p>
        </Section>
      )}
      {canSupport ? (
        <ChatLogCard rideId={rideId} riderName={riderName} driverName={driverName} />
      ) : (
        <Section title={t('rideDetail.chat.title')}>
          <p className="panel__hint">{t('reportDetail.chat.needsSupport')}</p>
        </Section>
      )}
    </>
  );
}

function RideFacts({ rideId, withSos }: { rideId: string; withSos: boolean }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const [detail, setDetail] = useState<AdminRideDetail | null>(null);
  const [error, setError] = useState<'notFound' | 'failed' | null>(null);
  const [sosEvents, setSosEvents] = useState<AdminSosEvent[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setSosEvents(null);
    getAdminRide(apiClient, rideId)
      .then(async (loaded) => {
        if (cancelled) {
          return;
        }
        setDetail(loaded);
        if (withSos) {
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
            // The evidence stands without the SOS fact.
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
  }, [apiClient, rideId, withSos, attempt]);

  const openLink = (
    <Link className="section__link" to={`/rides/${rideId}`}>
      {t('reportDetail.ride.open')}
    </Link>
  );

  if (detail === null) {
    return (
      <Section
        title={t('reportDetail.ride.titleBare', { ref: rideRef(rideId) })}
        actions={openLink}
      >
        {error === 'notFound' ? (
          <p className="panel__hint">{t('rideDetail.errors.notFound')}</p>
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
      </Section>
    );
  }

  const { ride } = detail;
  const components = ride.fare ? ride.fare.components : ride.estimate.components;
  const currencyLabel = t(`money.currency.${components.currency}`, components.currency);
  const serviceType = language.startsWith('ar') ? ride.serviceTypeNameAr : ride.serviceTypeNameEn;
  const distance = ride.fare?.distanceMeters ?? null;
  const title = [
    t('money.rideRef', { when: formatMoment(ride.timeline.requestedAt, language) }),
    serviceType,
    t(`rideDetail.payment.${ride.paymentMethod}`),
    isolateLtr(formatMoney(components.total, currencyLabel, language)),
  ].join(' · ');
  const clock = (at: string | null | undefined) => (at ? formatClock(at, language) : '—');

  return (
    <Section title={title} actions={openLink} className="evidence-ride">
      {detail.trace.length > 0 ? (
        <RideTraceMap
          label={t('rideDetail.traceLabel')}
          trace={detail.trace}
          pickup={ride.pickup}
          destination={ride.destination}
          stops={ride.stops ?? []}
          sosEvents={sosEvents ?? []}
        />
      ) : (
        <p className="panel__hint">{t('rideDetail.noTrace')}</p>
      )}
      <dl className="evidence-facts">
        <div>
          <dt>{t('reportDetail.ride.accepted')}</dt>
          <dd>{clock(ride.timeline.acceptedAt)}</dd>
        </div>
        <div>
          <dt>{t('reportDetail.ride.arrived')}</dt>
          <dd>{clock(ride.timeline.driverArrivedAt)}</dd>
        </div>
        <div>
          <dt>
            {ride.timeline.cancelledAt
              ? t('reportDetail.ride.cancelled')
              : t('reportDetail.ride.completed')}
          </dt>
          <dd>
            {clock(ride.timeline.completedAt ?? ride.timeline.cancelledAt)}
            {distance !== null
              ? ` · ${t('reportDetail.ride.km', { km: formatNumber(distance / 1000, language) })}`
              : null}
          </dd>
        </div>
        {sosEvents !== null ? (
          <div>
            <dt>{t('reportDetail.ride.sos')}</dt>
            <dd>
              {sosEvents.length === 0
                ? t('reportDetail.ride.sosNone')
                : sosEvents.map((event) => formatClock(event.triggeredAt, language)).join(', ')}
            </dd>
          </div>
        ) : null}
      </dl>
    </Section>
  );
}

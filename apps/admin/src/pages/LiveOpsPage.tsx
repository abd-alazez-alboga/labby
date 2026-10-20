import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import type { AdminSosEvent, LatLng } from '../api/comms';
import { listRegions, type RegionSummary } from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { MAP_COLORS } from '../theme/map-colors';
import { PageHeader, StatusChip } from '../ui';
import { LiveOpsMap } from './liveops/LiveOpsMap';
import { toLiveOpsOverlay } from './liveops/live-ops-overlay';
import { SosAlertPanel } from './liveops/SosAlertPanel';
import { useLiveOps, DEFAULT_REFRESH_SECONDS } from './liveops/use-live-ops';
import { rideRef } from './rides/ride-format';
import { formatClock, formatMultiplier, isolateLtr } from './surge';

/**
 * UC-A-19 / ADM-03 live operations map: one polled snapshot per region —
 * idle vs on-ride driver dots, active-ride route lines, the surge overlay
 * (the M9 facade's zone shape) and red SOS pins — plus the UC-A-20 SOS
 * alert rail. The route needs rides:view; the region selector also needs
 * regions:view (granted to Support), the alert list support:view and
 * acknowledging support:handle (SosAlertPanel).
 *
 * `?region=` picks the region (SOS click-throughs carry the alert's) and
 * `?ride=` centres the map on that ride's open SOS pin once it is drawn.
 * Without regions:view the selector is replaced by a clear notice, and a
 * `?region=` link still opens that region's map.
 */
export default function LiveOpsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();

  const [regions, setRegions] = useState<RegionSummary[] | null>(null);
  const [regionsFailed, setRegionsFailed] = useState<'forbidden' | 'failed' | null>(null);
  const requestedRegion = params.get('region');
  const requestedRide = params.get('ride');
  const regionId =
    regions === null
      ? // No list to check against (forbidden / failed): trust an explicit link.
        regionsFailed
        ? (requestedRegion ?? undefined)
        : undefined
      : ((requestedRegion && regions.some((r) => r.id === requestedRegion)
          ? requestedRegion
          : undefined) ?? regions[0]?.id);

  const { snapshot, error, refresh } = useLiveOps(regionId);
  const [surgeOn, setSurgeOn] = useState(true);
  const [focus, setFocus] = useState<LatLng | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRegions(apiClient)
      .then((loaded) => {
        if (!cancelled) {
          setRegions(loaded);
        }
      })
      .catch((failure) => {
        if (!cancelled) {
          setRegionsFailed(
            failure instanceof ApiError && failure.status === 403 ? 'forbidden' : 'failed',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const overlay = useMemo(
    () => (snapshot && surgeOn ? toLiveOpsOverlay(snapshot.surgeZones) : null),
    [snapshot, surgeOn],
  );
  const openSos = useMemo(() => snapshot?.sosEvents ?? [], [snapshot]);
  const openSosKey = openSos.map((event) => event.sosEventId).join(',');

  // `?ride=`: centre on that ride's open SOS pin once per link.
  const focusedRide = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedRide || focusedRide.current === `${regionId}|${requestedRide}`) {
      return;
    }
    const pin = openSos.find((event) => event.rideId === requestedRide);
    if (pin) {
      focusedRide.current = `${regionId}|${requestedRide}`;
      setFocus({ lat: pin.lat, lng: pin.lng });
    }
  }, [openSos, regionId, requestedRide]);
  const banner: AdminSosEvent | undefined = openSos[0];
  const onRides = snapshot?.drivers.filter((d) => d.status === 'on_ride').length ?? 0;
  const surging = snapshot?.surgeZones.filter((z) => z.level > 0 && z.multiplier > 1) ?? [];
  const refreshSeconds = snapshot?.refreshSeconds ?? DEFAULT_REFRESH_SECONDS;

  return (
    <section className="page">
      <PageHeader
        title={t('liveOps.title')}
        meta={
          snapshot === null ? null : error ? (
            <StatusChip tone="neutral">{t('surgeLive.notUpdatingChip')}</StatusChip>
          ) : (
            <StatusChip tone="success">
              {t('liveOps.liveChip', { seconds: refreshSeconds })}
            </StatusChip>
          )
        }
        actions={
          <div className="liveops-controls">
            {regions !== null && regions.length > 0 ? (
              <label className="liveops-controls__region">
                {t('liveOps.regionLabel')}
                <select
                  value={regionId ?? ''}
                  onChange={(event) => {
                    const next = new URLSearchParams(params);
                    next.set('region', event.target.value);
                    next.delete('ride');
                    setParams(next);
                    setFocus(null);
                  }}
                >
                  {regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="liveops-controls__toggle">
              <input
                type="checkbox"
                checked={surgeOn}
                onChange={(event) => setSurgeOn(event.target.checked)}
              />
              {t('liveOps.surgeToggle')}
            </label>
          </div>
        }
      />

      {regionsFailed === 'forbidden' ? (
        <p className="banner banner--info" role="status">
          {t(
            regionId ? 'liveOps.errors.regionsForbiddenLinked' : 'liveOps.errors.regionsForbidden',
          )}
        </p>
      ) : null}
      {regionsFailed === 'failed' ? (
        <p className="banner banner--error" role="alert">
          {t('liveOps.errors.regionsFailed')}
        </p>
      ) : null}
      {regions !== null && regions.length === 0 ? (
        <p className="banner banner--info" role="status">
          {t('liveOps.errors.noRegions')}
        </p>
      ) : null}
      {error === 'failed' && snapshot !== null ? (
        <p className="banner banner--info" role="status">
          {t('liveOps.errors.refreshFailed')}
        </p>
      ) : null}
      {error !== null && snapshot === null ? (
        <p className="banner banner--error" role="alert">
          {t('liveOps.errors.loadFailed')}{' '}
          <button className="btn btn--small" type="button" onClick={() => void refresh()}>
            {t('surgeLive.retry')}
          </button>
        </p>
      ) : null}

      {banner ? (
        <div className="sos-banner" role="alert">
          <span className="sos-banner__badge" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke={MAP_COLORS.surface}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
            </svg>
          </span>
          <span className="sos-banner__text">
            <strong>
              {t('liveOps.banner.title', {
                ride: isolateLtr(rideRef(banner.rideId)),
                name: banner.triggeredBy.name,
                time: formatClock(banner.triggeredAt, language),
              })}
            </strong>
            <span>
              {t(
                banner.triggeredByRole === 'driver'
                  ? 'liveOps.banner.byDriver'
                  : 'liveOps.banner.byRider',
              )}
              {banner.rideState
                ? ` · ${t(`money.rideState.${banner.rideState}`, banner.rideState)}`
                : null}
            </span>
          </span>
          <button
            className="btn sos-banner__focus"
            type="button"
            onClick={() => setFocus({ lat: banner.lat, lng: banner.lng })}
          >
            {t('liveOps.banner.focus')}
          </button>
        </div>
      ) : null}

      <div className="liveops-layout">
        <div className="liveops-layout__map">
          {regionId && snapshot === null && !error ? (
            <div className="loading">{t('common.loading')}</div>
          ) : snapshot ? (
            <>
              <LiveOpsMap
                label={t('liveOps.mapLabel')}
                language={language}
                drivers={snapshot.drivers}
                rides={snapshot.rides}
                sosEvents={snapshot.sosEvents}
                surgeZones={overlay}
                focus={focus}
                onDriverClick={(driverUserId) => navigate(`/driver-ledgers/${driverUserId}`)}
                onRideClick={(rideId) => navigate(`/rides/${rideId}`)}
              />
              <ul className="liveops-legend" aria-label={t('liveOps.legend.label')}>
                <li>
                  <span
                    className="liveops-legend__dot liveops-legend__dot--idle"
                    aria-hidden="true"
                  />
                  {t('liveOps.legend.idle')}
                </li>
                <li>
                  <span
                    className="liveops-legend__dot liveops-legend__dot--onride"
                    aria-hidden="true"
                  />
                  {t('liveOps.legend.onRide')}
                </li>
                <li>
                  <span
                    className="liveops-legend__dot liveops-legend__dot--surge"
                    aria-hidden="true"
                  />
                  {t('liveOps.legend.surge')}
                </li>
                <li>
                  <span
                    className="liveops-legend__dot liveops-legend__dot--sos"
                    aria-hidden="true"
                  />
                  {t('liveOps.legend.sos')}
                </li>
              </ul>
            </>
          ) : null}
        </div>

        <aside className="liveops-layout__aside">
          {can('support:view') ? (
            <SosAlertPanel
              regionId={regionId}
              openSosKey={openSosKey}
              onChanged={() => void refresh()}
            />
          ) : null}
          {snapshot ? (
            <section className="card section">
              <h2 className="section__heading">{t('liveOps.counts.title')}</h2>
              <dl className="liveops-counts">
                <div>
                  <dt>{t('liveOps.counts.onlineDrivers')}</dt>
                  <dd>
                    {t('liveOps.counts.driversValue', {
                      total: snapshot.drivers.length,
                      onRides: onRides,
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t('liveOps.counts.activeRides')}</dt>
                  <dd>{snapshot.rides.length}</dd>
                </div>
                <div>
                  <dt>{t('liveOps.counts.zonesSurging')}</dt>
                  <dd>
                    {t('liveOps.counts.zonesValue', {
                      surging: surging.length,
                      total: snapshot.surgeZones.length,
                    })}
                    {surging.length > 0
                      ? ` (${surging
                          .map(
                            (zone) =>
                              `${zone.name} ${isolateLtr(formatMultiplier(zone.multiplier, language))}`,
                          )
                          .join(t('surgeLive.stepSeparator'))})`
                      : null}
                  </dd>
                </div>
              </dl>
              <p className="panel__hint">{t('liveOps.counts.hint')}</p>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

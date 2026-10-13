import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import {
  getRegion,
  listSurgeZones,
  type SurgeZone,
  type SurgeZoneState,
  type ThresholdStep,
} from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, KpiRow, KpiTile, PageHeader, ReviewLayout, StatusChip } from '../ui';
import { formatNumber } from './money/money-format';
import {
  effectiveCap,
  formatClock,
  formatMultiplier,
  formatSince,
  isolateLtr,
  surgeLevel,
  useSurgeState,
} from './surge';
import { SurgeOverridePanel } from './surge/SurgeOverridePanel';
import { Multiplier, PendingChip, SurgeNowChip } from './surge/SurgeUi';

/** The shared threshold steps when every zone uses the same ones, else null. */
function sharedSteps(zones: SurgeZone[] | null): ThresholdStep[] | null {
  if (!zones || zones.length === 0) {
    return null;
  }
  const key = (steps: ThresholdStep[]) =>
    JSON.stringify([...steps].sort((a, b) => a.ratio - b.ratio));
  const first = key(zones[0].thresholdSteps);
  if (zones[0].thresholdSteps.length === 0 || zones.some((z) => key(z.thresholdSteps) !== first)) {
    return null;
  }
  return [...zones[0].thresholdSteps].sort((a, b) => a.ratio - b.ratio);
}

/** The latest cycle any zone reports (zones of one region run in the same cycle). */
function lastRun(zones: SurgeZoneState[]): string | null {
  const times = zones
    .map((zone) => zone.computedAt)
    .filter((value): value is string => value !== null);
  if (times.length === 0) {
    return null;
  }
  return times.reduce((latest, value) =>
    new Date(value).getTime() > new Date(latest).getTime() ? value : latest,
  );
}

/**
 * UC-A-09 under Regions › {region} › Surge: every zone's live multiplier
 * (as of the last surge cycle), the demand/supply that drove it, and the
 * manual override with its pending state. The state refreshes itself right
 * after each cycle (useSurgeState). Viewing needs pricing:view (plus
 * regions:view for the Regions section); overriding needs pricing:edit —
 * the codes the backend enforces on the same endpoints.
 */
export default function RegionSurgePage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { regionId } = useParams<{ regionId: string }>();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canEdit = can('pricing:edit');

  const { state, error, refresh } = useSurgeState(regionId);
  const [regionName, setRegionName] = useState<string | null>(null);
  const [zoneConfig, setZoneConfig] = useState<SurgeZone[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Context only (breadcrumb name, per-zone caps, threshold steps): a failure
  // here never blocks the live state.
  useEffect(() => {
    if (!regionId) {
      return;
    }
    let cancelled = false;
    getRegion(apiClient, regionId)
      .then((region) => !cancelled && setRegionName(region.name))
      .catch(() => undefined);
    listSurgeZones(apiClient, regionId)
      .then((zones) => !cancelled && setZoneConfig(zones))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient, regionId]);

  const zones = useMemo(() => state?.zones ?? [], [state]);
  const capOf = (zoneId: string): number | null =>
    effectiveCap(zoneConfig?.find((zone) => zone.id === zoneId)?.multiplierCap, state?.surgeCap);
  const selected = zones.find((zone) => zone.id === selectedId) ?? zones[0] ?? null;
  const steps = sharedSteps(zoneConfig);
  const x = (value: number) => isolateLtr(formatMultiplier(value, language));

  const breadcrumb = (
    <nav className="breadcrumb" aria-label={t('surgeLive.breadcrumbLabel')}>
      <Link to="/regions">{t('nav.regions')}</Link>
      <span aria-hidden="true">/</span>
      <Link to={`/regions/${regionId ?? ''}`}>{regionName ?? t('surgeLive.regionFallback')}</Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{t('surgeLive.breadcrumbSurge')}</span>
    </nav>
  );

  if (state === null) {
    return (
      <section className="page">
        {breadcrumb}
        {error === 'notFound' ? (
          <p className="banner banner--error" role="alert">
            {t('surgeLive.errors.regionNotFound')}
          </p>
        ) : error === 'failed' ? (
          <p className="banner banner--error" role="alert">
            {t('surgeLive.errors.loadFailed')}{' '}
            <button className="btn btn--small" type="button" onClick={() => void refresh()}>
              {t('surgeLive.retry')}
            </button>
          </p>
        ) : (
          <div className="loading">{t('common.loading')}</div>
        )}
      </section>
    );
  }

  const surging = zones.filter((zone) => zone.currentMultiplier > 1).length;
  const lastRunAt = lastRun(zones);

  const footnote = steps
    ? t('surgeLive.footnoteSteps', {
        steps: steps
          .map((step, index) =>
            t(index === 0 ? 'surgeLive.stepFirst' : 'surgeLive.stepNext', {
              ratio: formatNumber(step.ratio, language),
              multiplier: x(step.multiplier),
            }),
          )
          .join(t('surgeLive.stepSeparator')),
      })
    : t('surgeLive.footnoteGeneric');

  return (
    <section className="page">
      {breadcrumb}
      <PageHeader
        title={t('surgeLive.title')}
        meta={
          state.nextCycleAt ? (
            <StatusChip tone="success">{t('surgeLive.liveChip')}</StatusChip>
          ) : (
            <StatusChip tone="neutral">{t('surgeLive.cycleOffChip')}</StatusChip>
          )
        }
      />

      {error ? (
        <p className="banner banner--info" role="status">
          {t('surgeLive.errors.refreshFailed')}
        </p>
      ) : null}

      <ReviewLayout
        aside={
          selected ? (
            <SurgeOverridePanel
              key={selected.id}
              zone={selected}
              cap={capOf(selected.id)}
              nextCycleAt={state.nextCycleAt}
              canEdit={canEdit}
              onChanged={refresh}
            />
          ) : undefined
        }
      >
        <KpiRow>
          <KpiTile
            label={t('surgeLive.tiles.surging')}
            value={
              <>
                {surging}{' '}
                <span className="kpi__suffix">
                  {t('surgeLive.tiles.ofTotal', { total: zones.length })}
                </span>
              </>
            }
          />
          <KpiTile
            label={t('surgeLive.tiles.nextCycle')}
            value={
              state.nextCycleAt
                ? formatClock(state.nextCycleAt, language)
                : t('surgeLive.tiles.off')
            }
            hint={
              lastRunAt
                ? t('surgeLive.tiles.lastRun', { time: formatSince(lastRunAt, language) })
                : t('surgeLive.tiles.neverRun')
            }
          />
          <KpiTile
            label={t('surgeLive.tiles.regionCap')}
            value={
              state.surgeCap === null ? (
                t('surgeLive.tiles.noCap')
              ) : (
                <Multiplier value={state.surgeCap} />
              )
            }
          />
        </KpiRow>

        <DataTable
          title={t('surgeLive.zonesTitle')}
          isEmpty={zones.length === 0}
          empty={<p className="banner banner--info">{t('surgeLive.empty')}</p>}
          footer={<p className="panel__hint">{footnote}</p>}
        >
          <thead>
            <tr>
              <th>{t('surgeLive.columns.zone')}</th>
              <th>{t('surgeLive.columns.now')}</th>
              <th>{t('surgeLive.columns.automatic')}</th>
              <th>{t('surgeLive.columns.demandSupply')}</th>
              <th>{t('surgeLive.columns.override')}</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => {
              const isSelected = zone.id === selected?.id;
              return (
                <tr key={zone.id} className={isSelected ? 'table__row--selected' : undefined}>
                  <td>
                    <button
                      className="table__link table__select"
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(zone.id)}
                    >
                      {zone.name}
                    </button>
                  </td>
                  <td>
                    <SurgeNowChip
                      value={zone.currentMultiplier}
                      level={surgeLevel(zone.currentMultiplier, capOf(zone.id))}
                    />
                  </td>
                  <td className="table__muted">
                    <Multiplier value={zone.computedMultiplier} />
                  </td>
                  <td className="table__muted">
                    {t('surgeLive.demandSupply', {
                      demand: zone.demandCount,
                      supply: zone.supplyCount,
                    })}
                  </td>
                  <td>
                    <span className="surge-override">
                      {zone.overrideMultiplier === null ? (
                        <span className="table__muted">{t('surgeLive.overrideAutomatic')}</span>
                      ) : (
                        <strong>
                          <Multiplier value={zone.overrideMultiplier} />
                        </strong>
                      )}
                      {zone.overridePending ? (
                        <PendingChip nextCycleAt={state.nextCycleAt} />
                      ) : zone.overrideMultiplier !== null && zone.overrideSetAt ? (
                        <span className="surge-override__since">
                          {t('surgeLive.overrideSetAt', {
                            time: formatSince(zone.overrideSetAt, language),
                          })}
                        </span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </ReviewLayout>
    </section>
  );
}

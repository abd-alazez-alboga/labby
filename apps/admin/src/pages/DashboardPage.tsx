import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { getDashboard, type AnalyticsDashboard, type RevenueRow } from '../api/analytics';
import { getRegion, listRegions, type RegionSummary } from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useConfig } from '../config/ConfigContext';
import { DataTable, PageHeader } from '../ui';
import {
  dashboardZone,
  fillDays,
  formatRate,
  minutesSeconds,
  RANGE_PRESETS,
  rangeLabel,
  resolveRange,
  type RangePreset,
} from './dashboard/dashboard-utils';
import { RidesPerDayChart } from './dashboard/RidesPerDayChart';
import { formatMoney, formatNumber } from './money/money-format';

function Stat({
  label,
  value,
  hint,
  badge,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="kpi dashboard-stat">
      <span className="kpi__label dashboard-stat__label">
        {label}
        {badge}
      </span>
      <span className="kpi__value">{value}</span>
      {hint ? <span className="kpi__hint">{hint}</span> : null}
    </div>
  );
}

function NowBadge({ children }: { children: ReactNode }) {
  return (
    <span className="dashboard-badge dashboard-badge--now">
      <span className="dashboard-badge__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

function DashboardSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="dashboard-section" aria-label={title}>
      <div className="dashboard-section__head">
        <h2 className="dashboard-section__title">{title}</h2>
        {note ? <span className="dashboard-section__note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The analytics dashboard (UC-A-30, ADM-02; approved boards "Admin ·
 * Dashboard" EN + AR): date presets or a custom range plus a region filter
 * over GET /admin/analytics (analytics:view). Point-in-time figures carry a
 * "Now" badge, signups an "All regions" badge (rulings Q3/Q6). Admins
 * without analytics:view keep the plain welcome page.
 */
export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const config = useConfig();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canView = can('analytics:view');
  const [params, setParams] = useSearchParams();

  const presetParam = params.get('range') as RangePreset | null;
  const preset: RangePreset =
    presetParam && RANGE_PRESETS.includes(presetParam) ? presetParam : '7d';
  const customFrom = params.get('from') ?? '';
  const customTo = params.get('to') ?? '';
  const regionId = params.get('region') ?? '';

  const [regions, setRegions] = useState<RegionSummary[]>([]);
  // Region id → IANA zone: the day bounds follow the region's calendar (W5).
  const [zones, setZones] = useState<ReadonlyMap<string, string>>(new Map());
  const [zonesReady, setZonesReady] = useState(false);
  const timeZone = dashboardZone(regionId, zones);
  const current = useMemo(
    () => resolveRange(preset, customFrom, customTo, { timeZone }),
    [preset, customFrom, customTo, timeZone],
  );
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!canView) {
      return;
    }
    let cancelled = false;
    listRegions(apiClient)
      .then(async (loaded) => {
        if (cancelled) {
          return;
        }
        setRegions(loaded);
        // The region list carries no zone; each region's bundle does.
        const entries = await Promise.all(
          loaded.map(async (region) => {
            const detail = await getRegion(apiClient, region.id);
            return [region.id, detail.timeZone] as const;
          }),
        );
        if (!cancelled) {
          setZones(new Map(entries));
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setZonesReady(true));
    return () => {
      cancelled = true;
    };
  }, [apiClient, canView]);

  useEffect(() => {
    // Wait for the zones so the first request already has the right day bounds.
    if (!canView || !zonesReady || current === null) {
      return;
    }
    let cancelled = false;
    setData(null);
    setFailed(false);
    getDashboard(apiClient, {
      from: current.from,
      to: current.to,
      regionId: regionId || undefined,
    })
      .then((loaded) => !cancelled && setData(loaded))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [apiClient, canView, zonesReady, current, regionId, attempt]);

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    setParams(next);
  }

  if (!canView) {
    return (
      <section className="page">
        <PageHeader title={t('dashboard.title')} description={t('dashboard.noAnalytics')} />
        {config.environment ? (
          <div>
            <span className="chip chip--neutral">{config.environment}</span>
          </div>
        ) : null}
      </section>
    );
  }

  const number = (value: number) => formatNumber(value, language);
  const currencyLabel = (code: string) => t(`money.currency.${code}`, code);
  const money = (value: number, currency: string) => (
    <span dir="ltr">{formatMoney(value, currencyLabel(currency), language)}</span>
  );
  const moneyLines = (rows: RevenueRow[], pick: (row: RevenueRow) => number) =>
    rows.length === 0 ? (
      '—'
    ) : (
      <span className="dashboard-money">
        {rows.map((row) => (
          <span key={row.currency}>{money(pick(row), row.currency)}</span>
        ))}
      </span>
    );

  const filters = (
    <div className="dashboard-filters">
      <div className="segmented" role="group" aria-label={t('dashboard.rangeLabel')}>
        {RANGE_PRESETS.map((value) => (
          <button
            key={value}
            type="button"
            className={
              value === preset ? 'segmented__item segmented__item--active' : 'segmented__item'
            }
            aria-pressed={value === preset}
            onClick={() =>
              update(
                value === 'custom' && current
                  ? { range: value, from: current.firstDay, to: current.lastDay }
                  : { range: value === '7d' ? '' : value, from: '', to: '' },
              )
            }
          >
            {t(`dashboard.presets.${value}`)}
          </button>
        ))}
      </div>
      <select
        aria-label={t('dashboard.regionLabel')}
        value={regionId}
        onChange={(event) => update({ region: event.target.value })}
      >
        <option value="">{t('rides.allRegions')}</option>
        {regions.map((region) => (
          <option key={region.id} value={region.id}>
            {region.name}
          </option>
        ))}
      </select>
    </div>
  );

  const rides = data?.rides;
  const days = data && current ? fillDays(data.rides.daily, current, language) : [];
  const regionNames = new Map(rides?.byRegion.map((row) => [row.regionId, row.regionName]) ?? []);
  const multiRegion = regionNames.size > 1;
  const peakService = Math.max(1, ...(rides?.byServiceType.map((row) => row.total) ?? [0]));
  const pickup =
    data?.ops.avgPickupSeconds !== null && data?.ops.avgPickupSeconds !== undefined
      ? minutesSeconds(data.ops.avgPickupSeconds)
      : null;

  return (
    <section className="page dashboard">
      <PageHeader
        title={t('dashboard.title')}
        description={
          current
            ? t('dashboard.subtitle', { range: rangeLabel(current, language) })
            : t('dashboard.customHint')
        }
        actions={filters}
      />

      {preset === 'custom' ? (
        <div className="dashboard-custom">
          <label className="form-field">
            <span>{t('dashboard.customFrom')}</span>
            <input
              type="date"
              value={customFrom}
              onChange={(event) => update({ from: event.target.value })}
            />
          </label>
          <label className="form-field">
            <span>{t('dashboard.customTo')}</span>
            <input
              type="date"
              value={customTo}
              onChange={(event) => update({ to: event.target.value })}
            />
          </label>
          {current === null ? (
            <p className="panel__hint" role="status">
              {t('dashboard.customInvalid')}
            </p>
          ) : null}
        </div>
      ) : null}

      {current === null ? null : failed ? (
        <p className="banner banner--error" role="alert">
          {t('dashboard.loadFailed')}{' '}
          <button className="btn btn--small" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t('surgeLive.retry')}
          </button>
        </p>
      ) : data === null || rides === undefined ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <>
          <DashboardSection title={t('dashboard.rides.title')}>
            <div className="dashboard-grid dashboard-grid--4">
              <Stat label={t('dashboard.rides.requested')} value={number(rides.total)} />
              <Stat
                label={t('dashboard.rides.completed')}
                value={number(rides.completed)}
                hint={
                  rides.completionRate !== null
                    ? t('dashboard.rides.completionRate', {
                        rate: formatRate(rides.completionRate, language),
                      })
                    : undefined
                }
              />
              <Stat
                label={t('dashboard.rides.cancelled')}
                value={number(rides.cancelledByRider + rides.cancelledByDriver)}
                hint={t('dashboard.rides.cancelledSplit', {
                  rider: number(rides.cancelledByRider),
                  driver: number(rides.cancelledByDriver),
                })}
              />
              <Stat label={t('dashboard.rides.noDriver')} value={number(rides.noDriverFound)} />
            </div>
            <div className="dashboard-split">
              <div className="card dashboard-card">
                <h3 className="dashboard-card__title">{t('dashboard.rides.perDay')}</h3>
                <RidesPerDayChart days={days} />
              </div>
              <div className="card dashboard-card">
                <h3 className="dashboard-card__title">{t('dashboard.rides.byService')}</h3>
                <span className="dashboard-card__caption">
                  {t('dashboard.rides.byServiceCaption')}
                </span>
                {rides.byServiceType.length === 0 ? (
                  <p className="table__muted">{t('dashboard.empty')}</p>
                ) : (
                  <ul className="service-bars">
                    {rides.byServiceType.map((row) => {
                      const name = language.startsWith('ar') ? row.nameAr : row.nameEn;
                      return (
                        <li key={row.serviceTypeId} className="service-bars__item">
                          <span className="service-bars__row">
                            <span className="service-bars__name">
                              {multiRegion
                                ? `${name} · ${regionNames.get(row.regionId) ?? ''}`
                                : name}
                            </span>
                            <span className="service-bars__value" dir="ltr">
                              {number(row.total)} · {number(row.completed)}
                            </span>
                          </span>
                          <span className="service-bars__track">
                            <span
                              className="service-bars__fill"
                              style={{ width: `${(row.total / peakService) * 100}%` }}
                            />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            {rides.byRegion.length > 0 ? (
              <DataTable>
                <thead>
                  <tr>
                    <th>{t('dashboard.columns.region')}</th>
                    <th>{t('dashboard.columns.rides')}</th>
                    <th>{t('dashboard.columns.completed')}</th>
                    <th>{t('dashboard.columns.cancelled')}</th>
                    <th>{t('dashboard.columns.completion')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rides.byRegion.map((row) => (
                    // The region row carries no no-driver count, so its share is
                    // completed ÷ requested (the column header says so).
                    <tr key={row.regionId}>
                      <td className="table__strong">{row.regionName}</td>
                      <td>{number(row.total)}</td>
                      <td>{number(row.completed)}</td>
                      <td>{number(row.cancelled)}</td>
                      <td>
                        {row.total > 0 ? formatRate(row.completed / row.total, language) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : null}
          </DashboardSection>

          <DashboardSection title={t('dashboard.revenue.title')} note={t('dashboard.revenue.note')}>
            <div className="dashboard-grid dashboard-grid--2">
              <Stat
                label={t('dashboard.revenue.gross')}
                value={moneyLines(data.revenue.totals, (row) => row.grossFares)}
                hint={t('dashboard.revenue.grossHint')}
              />
              <Stat
                label={t('dashboard.revenue.commission')}
                value={moneyLines(data.revenue.totals, (row) => row.commission)}
                hint={t('dashboard.revenue.commissionHint')}
              />
            </div>
            {data.revenue.byRegion.length > 0 ? (
              <DataTable>
                <thead>
                  <tr>
                    <th>{t('dashboard.columns.region')}</th>
                    <th>{t('dashboard.revenue.gross')}</th>
                    <th>{t('dashboard.revenue.commission')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revenue.byRegion.map((row) => (
                    <tr key={`${row.regionId}-${row.currency}`}>
                      <td className="table__strong">{row.regionName}</td>
                      <td>{money(row.grossFares, row.currency)}</td>
                      <td>{money(row.commission, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : null}
          </DashboardSection>

          <DashboardSection title={t('dashboard.users.title')}>
            <div className="dashboard-grid dashboard-grid--4">
              <Stat
                label={t('dashboard.users.signups')}
                value={number(data.users.signups.riders + data.users.signups.drivers)}
                hint={t('dashboard.users.signupsSplit', {
                  riders: number(data.users.signups.riders),
                  drivers: number(data.users.signups.drivers),
                })}
                badge={<span className="dashboard-badge">{t('dashboard.allRegionsBadge')}</span>}
              />
              <Stat
                label={t('dashboard.users.activeRiders')}
                value={number(data.users.activeRiders)}
                hint={t('dashboard.users.activeHint')}
              />
              <Stat
                label={t('dashboard.users.activeDrivers')}
                value={number(data.users.activeDrivers)}
                hint={t('dashboard.users.activeHint')}
              />
              <Stat
                label={t('dashboard.users.online')}
                value={number(data.users.driversOnlineNow)}
                hint={t('dashboard.rightNow')}
                badge={<NowBadge>{t('dashboard.nowBadge')}</NowBadge>}
              />
            </div>
          </DashboardSection>

          <DashboardSection title={t('dashboard.ops.title')}>
            <div className="dashboard-grid dashboard-grid--3">
              <Stat
                label={t('dashboard.ops.pickup')}
                value={
                  pickup
                    ? t('dashboard.ops.pickupValue', {
                        minutes: number(pickup.minutes),
                        seconds: number(pickup.seconds),
                      })
                    : '—'
                }
                hint={t('dashboard.ops.pickupHint')}
              />
              <Stat
                label={t('dashboard.ops.acceptance')}
                value={formatRate(data.ops.acceptanceRate, language) ?? '—'}
                hint={t('dashboard.ops.acceptanceHint', {
                  accepted: number(data.ops.offersAccepted),
                  answered: number(data.ops.offersAnswered),
                })}
              />
              <Stat
                label={t('dashboard.ops.surge')}
                value={number(data.ops.activeSurgeZones)}
                hint={t('dashboard.ops.surgeHint')}
                badge={<NowBadge>{t('dashboard.nowBadge')}</NowBadge>}
              />
            </div>
          </DashboardSection>
        </>
      )}
    </section>
  );
}

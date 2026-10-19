import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { listSosEvents } from '../api/comms';
import { listRegions, type RegionSummary } from '../api/regions';
import {
  getAdminRide,
  searchAdminRides,
  type AdminRideQuery,
  type AdminRideSummary,
  type AdminRideSummaryPage,
  type RideState,
} from '../api/rides';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, FilterChips, PageHeader, StatusChip, TablePager } from '../ui';
import { ExportCsvButton, ExportFailureBanner } from './exports/CsvExport';
import { exportNote, useCsvExport } from './exports/use-csv-export';
import { formatMoment, formatMoney } from './money/money-format';
import { rideRef, rideStateTone, routeLabel } from './rides/ride-format';
import {
  chipStates,
  classifyQuery,
  dayBounds,
  detailToSummary,
  memberWindow,
  mergePages,
  RIDE_FILTER_CHIPS,
  type RideFilterChip,
  type RideRow,
} from './rides/rides-search';

const PAGE_SIZE = 25;
const NO_FILTER = {};

interface SearchResult {
  rows: RideRow[];
  totalItems: number;
  totalPages: number;
}

/**
 * UC-A-18 rides search over GET /admin/rides (rides:view): free search
 * (pasted ride/user ID, or exact phone), region + day filters and the state
 * chips. Chips that group several contract states (Active, Cancelled) merge
 * one search per member state; the SOS chip (support:view, since it reads
 * the alert list) shows the rides with an OPEN SOS event. Filters live in
 * the URL so returning from a detail keeps them.
 */
export default function RidesPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canSeeSos = can('support:view');
  const [params, setParams] = useSearchParams();

  const query = params.get('q') ?? '';
  const regionId = params.get('region') ?? '';
  const day = params.get('day') ?? '';
  const chipParam = params.get('state') as RideFilterChip | null;
  const chip: RideFilterChip =
    chipParam && RIDE_FILTER_CHIPS.includes(chipParam) && (chipParam !== 'sos' || canSeeSos)
      ? chipParam
      : 'all';
  const page = Math.max(0, Number(params.get('page')) || 0);

  // The export takes the list's exact filter. The contract's state filter is
  // ONE state, so a grouped chip (Active, Cancelled) or the SOS view cannot be
  // exported as one file — the button is disabled with a hint there.
  const exportFilter = useMemo<AdminRideQuery | null>(() => {
    const states = chip === 'sos' ? null : chipStates(chip);
    if (states === null || states.length > 1) {
      return null;
    }
    const classified = classifyQuery(query);
    const bounds = day ? dayBounds(day) : null;
    return {
      regionId: regionId || undefined,
      state: states[0],
      userId: classified.kind === 'id' ? classified.value : undefined,
      phone: classified.kind === 'phone' ? classified.value : undefined,
      from: bounds?.from,
      to: bounds?.to,
    };
  }, [chip, query, regionId, day]);
  const exportable = exportFilter !== null;
  const exporter = useCsvExport('rides', exportFilter ?? NO_FILTER);

  const [input, setInput] = useState(query);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [openSosRideIds, setOpenSosRideIds] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setInput(query);
  }, [query]);

  // The region filter options (regions:view); a failure just hides the names.
  useEffect(() => {
    let cancelled = false;
    listRegions(apiClient)
      .then((loaded) => !cancelled && setRegions(loaded))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  // The open-SOS ride set behind the red row flag (support:view only).
  useEffect(() => {
    if (!canSeeSos) {
      return;
    }
    let cancelled = false;
    listSosEvents(apiClient, { status: 'open', size: 50 })
      .then((page) => {
        if (!cancelled) {
          setOpenSosRideIds(new Set(page.items.map((event) => event.rideId)));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient, canSeeSos, attempt]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);

    async function load(): Promise<void> {
      if (chip === 'sos') {
        // The rides with an OPEN alert, straight from the SOS list (UC-A-20).
        const events = await listSosEvents(apiClient, {
          status: 'open',
          regionId: regionId || undefined,
          size: 50,
        });
        const rideIds = [...new Set(events.items.map((event) => event.rideId))];
        const details = await Promise.all(rideIds.map((id) => getAdminRide(apiClient, id)));
        const rows = details
          .map(detailToSummary)
          .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
        if (!cancelled) {
          setResult({ rows, totalItems: rows.length, totalPages: 1 });
        }
        return;
      }

      const classified = classifyQuery(query);
      if (classified.kind === 'id') {
        // A pasted UUID is first tried as a ride id; otherwise it filters as a user.
        try {
          const detail = await getAdminRide(apiClient, classified.value);
          if (!cancelled) {
            navigate(`/rides/${detail.ride.id}`, { replace: true });
          }
          return;
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) {
            throw error;
          }
        }
      }

      const bounds = day ? dayBounds(day) : null;
      const base: AdminRideQuery = {
        regionId: regionId || undefined,
        userId: classified.kind === 'id' ? classified.value : undefined,
        phone: classified.kind === 'phone' ? classified.value : undefined,
        from: bounds?.from,
        to: bounds?.to,
        page,
        size: PAGE_SIZE,
      };
      const states = chipStates(chip);
      let merged;
      if (states.length <= 1) {
        const single = states[0];
        merged = mergePages([
          await searchAdminRides(apiClient, single ? { ...base, state: single } : base),
        ]);
      } else {
        // A grouped chip: each member's leading rows, merged and sliced to this page.
        const { chunk, rows } = memberWindow(page, PAGE_SIZE);
        const memberRows = async (state: RideState): Promise<AdminRideSummaryPage> => {
          const items: AdminRideSummary[] = [];
          let totalItems = 0;
          for (let index = 0; index * chunk < rows; index++) {
            const read = await searchAdminRides(apiClient, {
              ...base,
              state,
              page: index,
              size: chunk,
            });
            items.push(...read.items);
            totalItems = read.totalItems;
            if ((index + 1) * chunk >= read.totalItems) {
              break;
            }
          }
          return { items, page: 0, size: rows, totalItems };
        };
        merged = mergePages(await Promise.all(states.map(memberRows)), {
          page,
          size: PAGE_SIZE,
        });
      }
      if (!cancelled) {
        setResult({
          rows: merged.items,
          totalItems: merged.totalItems,
          totalPages: merged.totalPages,
        });
      }
    }

    load().catch(() => {
      if (!cancelled) {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [apiClient, chip, query, regionId, day, page, navigate, attempt]);

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

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    update({ q: input.trim(), page: '' });
  }

  const chips = useMemo(
    () => RIDE_FILTER_CHIPS.filter((value) => value !== 'sos' || canSeeSos),
    [canSeeSos],
  );
  const currencyLabel = (code: string | undefined) =>
    code ? t(`money.currency.${code}`, code) : '';

  function fareCell(row: RideRow) {
    if (row.total !== null && row.total !== undefined) {
      return <span dir="ltr">{formatMoney(row.total, currencyLabel(row.currency), language)}</span>;
    }
    if (row.estimateTotal !== null && row.estimateTotal !== undefined) {
      return (
        <span dir="ltr">
          {t('rides.fareEstimate', {
            amount: formatMoney(row.estimateTotal, currencyLabel(row.currency), language),
          })}
        </span>
      );
    }
    if (row.cancellationFee !== null && row.cancellationFee !== undefined) {
      return (
        <span dir="ltr">
          {t('rides.fareFee', {
            amount: formatMoney(row.cancellationFee, currencyLabel(row.currency), language),
          })}
        </span>
      );
    }
    return <span className="table__muted">—</span>;
  }

  const lastPage = result ? Math.max(0, result.totalPages - 1) : 0;

  return (
    <section className="page">
      <PageHeader
        title={t('rides.title')}
        description={t('rides.subtitle')}
        actions={
          <ExportCsvButton
            state={exporter}
            disabledHint={exportable ? undefined : t('exports.ridesGroupedHint')}
          />
        }
      />
      <ExportFailureBanner state={exporter} />

      <form className="rides-filters" onSubmit={submitSearch}>
        <label className="rides-filters__search">
          <span className="visually-hidden">{t('rides.searchLabel')}</span>
          <input
            value={input}
            placeholder={t('rides.searchPlaceholder')}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <select
          aria-label={t('rides.regionLabel')}
          value={regionId}
          onChange={(event) => update({ region: event.target.value, page: '' })}
        >
          <option value="">{t('rides.allRegions')}</option>
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label={t('rides.dayLabel')}
          value={day}
          onChange={(event) => update({ day: event.target.value, page: '' })}
        />
        <button className="btn" type="submit">
          {t('rides.search')}
        </button>
      </form>
      <p className="panel__hint">{t('rides.searchHint')}</p>

      <FilterChips
        label={t('rides.filterLabel')}
        options={chips.map((value) => ({ value, label: t(`rides.chips.${value}`) }))}
        isSelected={(value) => value === chip}
        onSelect={(value) => update({ state: value === 'all' ? '' : value, page: '' })}
      />

      {failed ? (
        <p className="banner banner--error" role="alert">
          {t('rides.errors.loadFailed')}{' '}
          <button className="btn btn--small" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t('surgeLive.retry')}
          </button>
        </p>
      ) : result === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <>
          <p className="queue-count" role="status">
            {[
              t('rides.count', { total: result.totalItems }),
              exportable ? exportNote(exporter, t, 'rides', result.totalItems, language) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <DataTable
            isEmpty={result.rows.length === 0}
            empty={t(chip === 'sos' ? 'rides.emptySos' : 'rides.empty')}
            footer={
              result.totalPages > 1 ? (
                <TablePager
                  status={t('money.pageOf', { page: page + 1, total: result.totalPages })}
                  previousLabel={t('audit.previous')}
                  nextLabel={t('audit.next')}
                  canPrevious={page > 0}
                  canNext={page < lastPage}
                  onPrevious={() => update({ page: String(page - 1) })}
                  onNext={() => update({ page: String(page + 1) })}
                />
              ) : null
            }
          >
            <thead>
              <tr>
                <th>{t('rides.columns.ride')}</th>
                <th>{t('rides.columns.when')}</th>
                <th>{t('rides.columns.rider')}</th>
                <th>{t('rides.columns.driver')}</th>
                <th>{t('rides.columns.route')}</th>
                <th>{t('rides.columns.state')}</th>
                <th>{t('rides.columns.fare')}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => {
                const sosOpen = chip === 'sos' || openSosRideIds.has(row.id);
                return (
                  <tr key={row.id} className={sosOpen ? 'table__row--sos' : undefined}>
                    <td>
                      <Link className="rides-ref" to={`/rides/${row.id}`} dir="ltr">
                        {rideRef(row.id)}
                        {sosOpen ? (
                          <span className="sos-dot" role="img" aria-label={t('rides.sosFlag')} />
                        ) : null}
                      </Link>
                    </td>
                    <td className="table__muted">{formatMoment(row.requestedAt, language)}</td>
                    <td>{row.riderName}</td>
                    <td>{row.driverName ?? <span className="table__muted">—</span>}</td>
                    <td className="table__muted">
                      {routeLabel(
                        row.pickup,
                        row.destination,
                        t('rides.routeFallback'),
                        i18n.dir(),
                      )}
                    </td>
                    <td>
                      <StatusChip tone={rideStateTone(row.state)}>
                        {t(`money.rideState.${row.state}`)}
                      </StatusChip>
                    </td>
                    <td>{fareCell(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { listAdminDrivers, type AdminDriver, type DriverFilter, type Page } from '../api/analytics';
import { listRegions, type RegionSummary } from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { DataTable, FilterChips, PageHeader, Plate, StatusChip, TablePager } from '../ui';
import {
  APPLICATION_STATUSES,
  APPLICATION_TONES,
  DIRECTORY_PAGE_SIZE,
  oneOf,
  useUrlFilters,
} from './directory/directory-utils';
import { useRegionsViewTitle } from './regions/use-regions-view-title';
import { ExportCsvButton, ExportFailureBanner } from './exports/CsvExport';
import { exportNote, useCsvExport } from './exports/use-csv-export';
import { formatDay, formatNumber } from './money/money-format';

const ONLINE_FILTERS = ['online', 'offline'] as const;

/**
 * The drivers list (approved board "Admin · Drivers list"): everyone who
 * applied to drive, newest account first, over GET /admin/drivers
 * (users:view) with region / application status / online filters and Export
 * CSV of exactly that filter. Region and plate come from the active vehicle.
 */
export default function DriversPage() {
  const { t, i18n } = useTranslation();
  const regionsTitle = useRegionsViewTitle();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { params, update, page } = useUrlFilters();

  const regionId = params.get('region') ?? '';
  const status = oneOf(params.get('status'), APPLICATION_STATUSES);
  const online = oneOf(params.get('online'), ONLINE_FILTERS);
  const filter = useMemo<DriverFilter>(
    () => ({
      regionId: regionId || undefined,
      status,
      online: online === undefined ? undefined : online === 'online',
    }),
    [regionId, status, online],
  );
  const exporter = useCsvExport('drivers', filter);

  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [result, setResult] = useState<Page<AdminDriver> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listRegions(apiClient)
      .then((loaded) => !cancelled && setRegions(loaded))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    listAdminDrivers(apiClient, filter, page, DIRECTORY_PAGE_SIZE)
      .then((loaded) => !cancelled && setResult(loaded))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [apiClient, filter, page, attempt]);

  const totalPages = result ? Math.max(1, Math.ceil(result.totalItems / DIRECTORY_PAGE_SIZE)) : 1;
  const note = result ? exportNote(exporter, t, 'drivers', result.totalItems, language) : null;
  const dash = <span className="table__muted">—</span>;

  return (
    <section className="page">
      <PageHeader
        title={t('directory.drivers.title')}
        description={t('directory.drivers.subtitle')}
        actions={<ExportCsvButton state={exporter} />}
      />
      <ExportFailureBanner state={exporter} />

      <div className="directory-filters">
        <select
          aria-label={t('directory.drivers.regionLabel')}
          title={regionsTitle}
          disabled={regionsTitle !== undefined}
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
        <select
          aria-label={t('directory.drivers.statusLabel')}
          value={status ?? ''}
          onChange={(event) => update({ status: event.target.value })}
        >
          <option value="">{t('directory.drivers.anyStatus')}</option>
          {APPLICATION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`review.applicationStatus.${value}`)}
            </option>
          ))}
        </select>
        <span className="directory-filters__spacer" />
        <FilterChips
          label={t('directory.drivers.onlineLabel')}
          options={[
            { value: '', label: t('directory.drivers.anyOnline') },
            ...ONLINE_FILTERS.map((value) => ({ value, label: t(`directory.drivers.${value}`) })),
          ]}
          isSelected={(value) => value === (online ?? '')}
          onSelect={(value) => update({ online: value })}
        />
      </div>

      {failed ? (
        <p className="banner banner--error" role="alert">
          {t('directory.loadFailed')}{' '}
          <button className="btn btn--small" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t('surgeLive.retry')}
          </button>
        </p>
      ) : result === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <DataTable
          isEmpty={result.items.length === 0}
          empty={t('directory.drivers.empty')}
          footer={
            <TablePager
              status={[
                t('directory.showing', {
                  total: formatNumber(result.totalItems, language),
                  page: page + 1,
                  pages: totalPages,
                }),
                note,
              ]
                .filter(Boolean)
                .join(' · ')}
              previousLabel={t('audit.previous')}
              nextLabel={t('audit.next')}
              canPrevious={page > 0}
              canNext={page < totalPages - 1}
              onPrevious={() => update({ page: String(page - 1) })}
              onNext={() => update({ page: String(page + 1) })}
            />
          }
        >
          <thead>
            <tr>
              <th>{t('directory.drivers.columns.driver')}</th>
              <th>{t('directory.drivers.columns.application')}</th>
              <th>{t('directory.drivers.columns.status')}</th>
              <th>{t('directory.drivers.columns.region')}</th>
              <th>{t('directory.drivers.columns.vehicle')}</th>
              <th>{t('directory.drivers.columns.joined')}</th>
              <th className="table__cell--action">
                <span className="visually-hidden">{t('directory.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((driver, index) => (
              <tr key={driver.userId}>
                <td>
                  <span className="directory-person">
                    <span className="table__strong" dir="auto">
                      {driver.name}
                    </span>
                    {driver.phone ? (
                      <span className="table__muted" dir="ltr">
                        {driver.phone}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td>
                  <StatusChip tone={APPLICATION_TONES[driver.applicationStatus]}>
                    {t(`review.applicationStatus.${driver.applicationStatus}`)}
                  </StatusChip>
                </td>
                <td>
                  <span
                    className={driver.online ? 'online-state online-state--on' : 'online-state'}
                  >
                    <span className="online-state__dot" aria-hidden="true" />
                    {t(driver.online ? 'directory.drivers.online' : 'directory.drivers.offline')}
                  </span>
                </td>
                <td>{driver.regionName ?? dash}</td>
                <td>{driver.vehiclePlate ? <Plate value={driver.vehiclePlate} /> : dash}</td>
                <td className="table__muted">{formatDay(driver.createdAt, language)}</td>
                <td className="table__cell--action">
                  <Link
                    className={index === 0 ? 'btn btn--small btn--primary' : 'btn btn--small'}
                    to={`/users/${driver.userId}/trust`}
                    state={{ name: driver.name }}
                  >
                    {t('directory.open')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

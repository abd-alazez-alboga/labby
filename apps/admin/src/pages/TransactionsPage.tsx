import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  listAdminTransactions,
  type AdminTransaction,
  type Page,
  type TransactionFilter,
  type TransactionSource,
} from '../api/analytics';
import { listRegions } from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, FilterChips, PageHeader, TablePager } from '../ui';
import { dayRange, DIRECTORY_PAGE_SIZE, oneOf, useUrlFilters } from './directory/directory-utils';
import { ExportCsvButton, ExportFailureBanner } from './exports/CsvExport';
import { exportNote, useCsvExport } from './exports/use-csv-export';
import { formatMoment, formatMoney, formatNumber, formatSigned } from './money/money-format';
import { rideRef } from './rides/ride-format';

const SOURCES: readonly TransactionSource[] = ['wallet', 'driver_ledger'];

/** The type options: wallet types, then driver ledger types (money-v1). */
const WALLET_TYPES = [
  'fare_payment',
  'tip',
  'cancellation_fee',
  'refund',
  'admin_grant',
  'referral',
  'promo',
  'loyalty_redemption',
] as const;
const LEDGER_TYPES = [
  'ride_earning',
  'commission_due',
  'tip',
  'cancellation_fee',
  'settlement_pay_in',
  'settlement_pay_out',
  'bonus',
  'due_collection',
  'promo_compensation',
] as const;
const ALL_TYPES: readonly string[] = [...new Set<string>([...WALLET_TYPES, ...LEDGER_TYPES])];

/** The label of a row's type: its own ledger's catalog. */
function typeKey(source: TransactionSource, type: string): string {
  return source === 'wallet' ? `money.txType.${type}` : `money.ledger.entryType.${type}`;
}

/**
 * The transactions list (approved board "Admin · Transactions list"): rider
 * wallet transactions and driver ledger entries in one list, newest first,
 * over GET /admin/transactions (wallets:view + settlements:view, ruling Q5)
 * with source / type / currency / date filters and Export CSV of exactly
 * that filter.
 */
export default function TransactionsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const { params, update, page } = useUrlFilters();

  const source = oneOf(params.get('source'), SOURCES);
  const type = oneOf(params.get('type'), ALL_TYPES);
  const currency = params.get('currency') ?? '';
  const fromDay = params.get('from') ?? '';
  const toDay = params.get('to') ?? '';
  const userId = params.get('userId') ?? '';
  const filter = useMemo<TransactionFilter>(
    () => ({
      source,
      type,
      currency: currency || undefined,
      userId: userId || undefined,
      ...dayRange(fromDay, toDay),
    }),
    [source, type, currency, userId, fromDay, toDay],
  );
  const exporter = useCsvExport('transactions', filter);

  const [currencies, setCurrencies] = useState<string[]>([]);
  const [result, setResult] = useState<Page<AdminTransaction> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The currency options are the regions' currencies (regions:view); none → no filter.
  useEffect(() => {
    let cancelled = false;
    listRegions(apiClient)
      .then((regions) => {
        if (!cancelled) {
          const codes = regions
            .map((region) => region.currency)
            .filter((code): code is string => !!code);
          setCurrencies([...new Set(codes)].sort());
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    listAdminTransactions(apiClient, filter, page, DIRECTORY_PAGE_SIZE)
      .then((loaded) => !cancelled && setResult(loaded))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [apiClient, filter, page, attempt]);

  const totalPages = result ? Math.max(1, Math.ceil(result.totalItems / DIRECTORY_PAGE_SIZE)) : 1;
  const note = result ? exportNote(exporter, t, 'rows', result.totalItems, language) : null;
  const currencyLabel = (code: string) => t(`money.currency.${code}`, code);
  const typeOptions =
    source === 'wallet' ? WALLET_TYPES : source === 'driver_ledger' ? LEDGER_TYPES : ALL_TYPES;

  return (
    <section className="page">
      <PageHeader
        title={t('directory.transactions.title')}
        description={t('directory.transactions.subtitle')}
        actions={<ExportCsvButton state={exporter} />}
      />
      <ExportFailureBanner state={exporter} />

      <div className="directory-filters">
        <FilterChips
          label={t('directory.transactions.sourceLabel')}
          options={[
            { value: '', label: t('directory.all') },
            ...SOURCES.map((value) => ({
              value,
              label: t(`directory.transactions.sources.${value}`),
            })),
          ]}
          isSelected={(value) => value === (source ?? '')}
          onSelect={(value) => update({ source: value, type: '' })}
        />
        <span className="directory-filters__spacer" />
        <select
          aria-label={t('directory.transactions.typeLabel')}
          value={type ?? ''}
          onChange={(event) => update({ type: event.target.value })}
        >
          <option value="">{t('directory.transactions.allTypes')}</option>
          {typeOptions.map((value) => (
            <option key={value} value={value}>
              {t(
                (WALLET_TYPES as readonly string[]).includes(value) && source !== 'driver_ledger'
                  ? `money.txType.${value}`
                  : `money.ledger.entryType.${value}`,
              )}
            </option>
          ))}
        </select>
        {currencies.length > 0 ? (
          <select
            aria-label={t('directory.transactions.currencyLabel')}
            value={currency}
            onChange={(event) => update({ currency: event.target.value })}
          >
            <option value="">{t('directory.transactions.allCurrencies')}</option>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </select>
        ) : null}
        <input
          type="date"
          aria-label={t('directory.transactions.from')}
          value={fromDay}
          onChange={(event) => update({ from: event.target.value })}
        />
        <span className="table__muted">–</span>
        <input
          type="date"
          aria-label={t('directory.transactions.to')}
          value={toDay}
          onChange={(event) => update({ to: event.target.value })}
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
          empty={t('directory.transactions.empty')}
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
              <th>{t('directory.transactions.columns.when')}</th>
              <th>{t('directory.transactions.columns.user')}</th>
              <th>{t('directory.transactions.columns.type')}</th>
              <th>{t('directory.transactions.columns.ride')}</th>
              <th>{t('directory.transactions.columns.amount')}</th>
              <th>{t('directory.transactions.columns.balanceAfter')}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((row) => (
              <tr key={`${row.source}-${row.transactionId}`}>
                <td className="table__muted">{formatMoment(row.createdAt, language)}</td>
                <td>
                  <span className="directory-person">
                    <span className="table__strong" dir="auto">
                      {row.userName}
                    </span>
                    <span className="table__muted">
                      {t(`directory.transactions.sourceRow.${row.source}`)}
                    </span>
                  </span>
                </td>
                <td>
                  <span className="directory-person">
                    <span>{t(typeKey(row.source, row.type), row.type)}</span>
                    {row.reason ? (
                      <span className="table__muted" dir="auto">
                        {row.reason}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td>
                  {row.rideId === null ? (
                    <span className="table__muted">—</span>
                  ) : can('rides:view') ? (
                    <Link className="rides-ref" to={`/rides/${row.rideId}`} dir="ltr">
                      {rideRef(row.rideId)}
                    </Link>
                  ) : (
                    <span dir="ltr">{rideRef(row.rideId)}</span>
                  )}
                </td>
                <td>
                  <span
                    dir="ltr"
                    className={row.amount > 0 ? 'amount amount--credit' : 'amount amount--debit'}
                  >
                    {`${currencyLabel(row.currency)} ${formatSigned(row.amount, language)}`}
                  </span>
                </td>
                <td>
                  <span dir="ltr">
                    {formatMoney(row.balanceAfter, currencyLabel(row.currency), language)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

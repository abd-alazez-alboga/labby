import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router-dom';

import {
  getDriverLedger,
  type DriverBalanceEntry,
  type DriverLedgerEntry,
  type DriverLedgerView,
  type SettlementResponse,
} from '../api/money';
import { searchAdminRides, type AdminRideSummary } from '../api/rides';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { BackLink, DataTable, KpiRow, KpiTile, PageHeader, ReviewLayout, TablePager } from '../ui';
import { formatDay, formatNumber, formatSigned } from './money/money-format';
import { FloorStatusChip, Money, RideRef } from './money/MoneyUi';
import { useCurrencyLabel } from './money/use-currency-label';
import { useUserIdentity } from './money/use-user-identity';
import { SettlementPanel } from './money/SettlementPanel';
import { UserProfileTabs } from './trust/TrustUi';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';

const PAGE_SIZE = 20;

/**
 * UC-A-27: a driver's money ledger — per-currency balance against the
 * region floor (COM-03 status chip), the typed append-only entries, and
 * (with `settlements:record`) the settlement side panel with instant
 * floor-status feedback. Viewing needs `settlements:view` (route guard).
 */
export default function DriverLedgerPage() {
  const { t, i18n } = useTranslation();
  const { driverUserId = '' } = useParams<{ driverUserId: string }>();
  const location = useLocation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canRecord = can('settlements:record');
  const canRides = can('rides:view');
  const currencyLabel = useCurrencyLabel();

  const passedName = (location.state as { name?: string } | null)?.name;
  const { identity, summary } = useUserIdentity(driverUserId);

  const [view, setView] = useState<DriverLedgerView | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [rides, setRides] = useState<AdminRideSummary[] | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  // The settlement response is the freshest truth — it overrides the loaded
  // balance of its currency until the next refetch completes.
  const [settled, setSettled] = useState<SettlementResponse | null>(null);

  // A different driver (same route, new param) starts from scratch: no stale
  // view, currency filter, page or settlement. Reset during render so no
  // request goes out with the previous driver's filter.
  const [shownDriver, setShownDriver] = useState(driverUserId);
  if (shownDriver !== driverUserId) {
    setShownDriver(driverUserId);
    setView(null);
    setLoadError(null);
    setCurrency(null);
    setPage(0);
    setSettled(null);
  }

  // Once the balances are known, pin the shown currency explicitly so the
  // entries always match the selected tab (never the server's mixed list).
  const knownCurrencies = view?.balances.map((entry) => entry.currency) ?? [];
  const requestCurrency = currency ?? knownCurrencies[0];

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getDriverLedger(apiClient, driverUserId, {
      currency: requestCurrency,
      page,
      size: PAGE_SIZE,
    })
      .then((loaded) => {
        if (!cancelled) {
          setView(loaded);
          setSettled(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(classifyError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, driverUserId, requestCurrency, page, refresh]);

  useEffect(() => {
    if (!canRides) {
      return;
    }
    let cancelled = false;
    searchAdminRides(apiClient, { userId: driverUserId })
      .then((loaded) => {
        if (!cancelled) {
          setRides(loaded.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRides(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, driverUserId, canRides]);

  const ridesById = useMemo(() => new Map((rides ?? []).map((ride) => [ride.id, ride])), [rides]);

  const backLink = <BackLink to="/driver-ledgers">{t('money.ledger.back')}</BackLink>;

  if (loadError) {
    return (
      <section className="page">
        {backLink}
        <LoadFailure
          kind={loadError}
          notFoundKey="money.ledger.notFound"
          onRetry={() => setRefresh((n) => n + 1)}
        />
      </section>
    );
  }
  if (view === null) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  // Balances, with a just-recorded settlement reflected immediately.
  const balances: DriverBalanceEntry[] = view.balances.map((entry) =>
    settled && entry.currency === settled.currency
      ? { ...entry, balance: settled.balance, status: settled.floorStatus }
      : entry,
  );
  const currencies = balances.map((entry) => entry.currency);
  const selectedCurrency = currency ?? currencies[0] ?? 'SYP';
  const selected = balances.find((entry) => entry.currency === selectedCurrency) ?? null;
  const lastPage = Math.max(0, view.totalPages - 1);

  function entrySub(entry: DriverLedgerEntry): string | null {
    if (
      (entry.type === 'commission_due' || entry.type === 'ride_earning') &&
      entry.fareAmount != null &&
      entry.commissionRate != null
    ) {
      return t('money.ledger.sub.commission', {
        fare: formatNumber(entry.fareAmount, i18n.language),
        rate: formatNumber(entry.commissionRate, i18n.language),
      });
    }
    if (entry.type === 'tip') {
      return t('money.ledger.sub.tip');
    }
    if (entry.type === 'cancellation_fee') {
      return t('money.ledger.sub.cancellationFee');
    }
    if (entry.type === 'due_collection') {
      return t('money.ledger.sub.dueCollection');
    }
    if (entry.type === 'promo_compensation') {
      return t('money.ledger.sub.promoCompensation');
    }
    return null;
  }

  function onRecorded(response: SettlementResponse) {
    // Instant feedback from the response, then the ledger list catches up.
    setSettled(response);
    setPage(0);
    setRefresh((n) => n + 1);
  }

  return (
    <section className="page">
      {backLink}
      <PageHeader
        title={<bdi>{identity?.name ?? passedName ?? t('money.ledger.title')}</bdi>}
        description={
          summary ?? (identity || passedName ? null : <span dir="ltr">{driverUserId}</span>)
        }
        meta={selected ? <FloorStatusChip status={selected.status} /> : null}
      />
      {/* The profile's "Driver ledger" tab lands here (V1 audit W4): keep the profile tabs. */}
      <UserProfileTabs userId={driverUserId} name={identity?.name ?? passedName} isDriver />

      {currencies.length > 1 ? (
        <div className="segmented" role="group" aria-label={t('money.ledger.currencyFilterLabel')}>
          {currencies.map((code) => (
            <button
              key={code}
              className="segmented__option"
              type="button"
              aria-pressed={code === selectedCurrency}
              onClick={() => {
                setCurrency(code);
                setPage(0);
              }}
            >
              {currencyLabel(code)}
            </button>
          ))}
        </div>
      ) : null}

      <ReviewLayout
        aside={
          canRecord ? (
            <SettlementPanel
              driverUserId={driverUserId}
              balance={selected}
              currency={selectedCurrency}
              onRecorded={onRecorded}
            />
          ) : null
        }
      >
        <KpiRow>
          <KpiTile
            label={t('money.ledger.balanceTile', { currency: currencyLabel(selectedCurrency) })}
            value={<Money amount={selected?.balance ?? 0} />}
            tone={(selected?.balance ?? 0) < 0 ? 'danger' : 'default'}
          />
          <KpiTile
            label={t('money.ledger.floorTile', { currency: currencyLabel(selectedCurrency) })}
            value={selected ? <Money amount={selected.floor} /> : '—'}
            hint={selected?.status === 'blocked' ? t('money.ledger.blockedHint') : null}
          />
        </KpiRow>

        <DataTable
          title={t('money.ledger.ledgerTitle')}
          isEmpty={view.entries.length === 0}
          empty={t('money.ledger.empty')}
          footer={
            view.totalItems > view.size ? (
              <TablePager
                status={t('money.pageOf', { page: page + 1, total: lastPage + 1 })}
                previousLabel={t('audit.previous')}
                nextLabel={t('audit.next')}
                canPrevious={page > 0}
                canNext={page < lastPage}
                onPrevious={() => setPage(page - 1)}
                onNext={() => setPage(page + 1)}
              />
            ) : null
          }
        >
          <thead>
            <tr>
              <th>{t('money.columns.entry')}</th>
              <th>{t('money.columns.linkedTo')}</th>
              <th>{t('money.columns.when')}</th>
              <th className="table__num">{t('money.columns.amount')}</th>
              <th className="table__num">{t('money.columns.balanceAfter')}</th>
            </tr>
          </thead>
          <tbody>
            {view.entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <span className="entry">
                    <span className="entry__type">{t(`money.ledger.entryType.${entry.type}`)}</span>
                    {entrySub(entry) ? <span className="entry__sub">{entrySub(entry)}</span> : null}
                  </span>
                </td>
                <td>
                  <RideRef rideId={entry.rideId} rides={ridesById} />
                </td>
                <td className="table__muted">{formatDay(entry.createdAt, i18n.language)}</td>
                <td
                  className={`table__num ${entry.amount < 0 ? 'amount--debit' : 'amount--credit'}`}
                >
                  <span dir="ltr">{formatSigned(entry.amount, i18n.language)}</span>
                </td>
                <td className="table__num table__muted">
                  <Money amount={entry.balanceAfter} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </ReviewLayout>
    </section>
  );
}

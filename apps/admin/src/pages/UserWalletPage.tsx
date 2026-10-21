import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';

import {
  getUserWallet,
  getUserWalletTransactions,
  type RiderDue,
  type WalletTransaction,
  type WalletTransactionPage,
  type WalletView,
} from '../api/money';
import {
  getAdminRide,
  searchAdminRides,
  type AdminRideDetail,
  type AdminRideSummary,
} from '../api/rides';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { BackLink, DataTable, KpiRow, KpiTile, PageHeader, ReviewLayout, TablePager } from '../ui';
import { GrantRefundPanel, type RefundFromRide } from './money/GrantRefundPanel';
import { formatDay, formatSigned } from './money/money-format';
import { Money, RideRef } from './money/MoneyUi';
import { UserProfileTabs } from './trust/TrustUi';
import { useCurrencyLabel } from './money/use-currency-label';
import { useUserIdentity } from './money/use-user-identity';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { rideRef } from './rides/ride-format';

const PAGE_SIZE = 20;

interface PendingDueSummary {
  amount: number;
  count: number;
  /** The most recent due of the currency (createdAt), for the tile hint. */
  latest: RiderDue;
}

/** Pending dues summed per currency, for the "Pending due" tiles. */
function pendingDueByCurrency(wallet: WalletView): Map<string, PendingDueSummary> {
  const sums = new Map<string, PendingDueSummary>();
  for (const due of wallet.dues) {
    const current = sums.get(due.currency);
    sums.set(
      due.currency,
      current
        ? {
            amount: current.amount + due.amount,
            count: current.count + 1,
            latest: due.createdAt > current.latest.createdAt ? due : current.latest,
          }
        : { amount: due.amount, count: 1, latest: due },
    );
  }
  return sums;
}

/** The ride as a refund-link option (the ride detail's own read; V1 audit W28). */
function rideOption(detail: AdminRideDetail): AdminRideSummary {
  const { ride } = detail;
  return {
    id: ride.id,
    state: ride.state,
    requestedAt: ride.timeline.requestedAt,
    pickup: ride.pickup,
    destination: ride.destination,
    serviceTypeNameEn: ride.serviceTypeNameEn,
    serviceTypeNameAr: ride.serviceTypeNameAr,
    total: ride.fare?.components.total ?? null,
    cancellationFee: ride.cancellationFee ?? null,
    currency: ride.estimate.components.currency,
    kind: ride.kind,
    regionId: ride.regionId,
    regionName: '',
    riderUserId: detail.riderUserId,
    riderName: detail.riderName,
    driverUserId: detail.driverUserId ?? null,
    driverName: detail.driverName ?? null,
  };
}

/**
 * UC-A-15 (extends UC-A-13): a user's wallet — per-currency balances,
 * pending dues, the typed transaction history, and (with `wallets:manage`)
 * the grant/refund side panel. Viewing needs `wallets:view` (route guard).
 * The ride detail's "Refund rider" opens it with `?refundRide=<rideId>`
 * (V1 audit W28, board V1FAdminRideRefundWallet): Refund and that ride are
 * pre-selected, the ride total is the amount hint, and the back link
 * returns to the ride.
 */
export default function UserWalletPage() {
  const { t, i18n } = useTranslation();
  const { userId = '' } = useParams<{ userId: string }>();
  const location = useLocation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canManage = can('wallets:manage');
  const canRides = can('rides:view');
  const currencyLabel = useCurrencyLabel();
  const { identity, summary } = useUserIdentity(userId);

  // The lookup page passes the display name along; a cold URL has none. The
  // M14 ticket remedy deep link also pre-fills the grant reason (UC-A-21 A2).
  const passedState = location.state as { name?: string; grantReason?: string } | null;
  const passedName = passedState?.name;
  const grantReason = passedState?.grantReason ?? '';
  const [searchParams] = useSearchParams();
  const refundRideId = searchParams.get('refundRide');

  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [walletError, setWalletError] = useState<FailureKind | null>(null);
  const [transactions, setTransactions] = useState<WalletTransactionPage | null>(null);
  const [transactionsError, setTransactionsError] = useState<FailureKind | null>(null);
  const [rides, setRides] = useState<AdminRideSummary[] | null>(null);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  /** The ride the refund comes from: undefined while loading, null when not readable. */
  const [fromRideDetail, setFromRideDetail] = useState<AdminRideDetail | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    setWallet(null);
    setWalletError(null);
    getUserWallet(apiClient, userId)
      .then((view) => {
        if (!cancelled) {
          setWallet(view);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWalletError(classifyError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, userId, refresh]);

  useEffect(() => {
    let cancelled = false;
    setTransactions(null);
    setTransactionsError(null);
    getUserWalletTransactions(apiClient, userId, { page, size: PAGE_SIZE })
      .then((loaded) => {
        if (!cancelled) {
          setTransactions(loaded);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTransactionsError(classifyError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, userId, page, refresh]);

  // Ride references (table labels + the refund link select) need rides:view.
  useEffect(() => {
    if (!canRides) {
      setRides(null);
      return;
    }
    let cancelled = false;
    searchAdminRides(apiClient, { userId })
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
  }, [apiClient, userId, canRides]);

  // The ride the ride detail sent us from (rides:view) — its total and currency.
  useEffect(() => {
    if (!refundRideId || !canRides) {
      setFromRideDetail(null);
      return;
    }
    let cancelled = false;
    setFromRideDetail(undefined);
    getAdminRide(apiClient, refundRideId)
      .then((loaded) => {
        if (!cancelled) {
          setFromRideDetail(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFromRideDetail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, refundRideId, canRides]);

  const ridesById = useMemo(() => new Map((rides ?? []).map((ride) => [ride.id, ride])), [rides]);
  // The search matches rider OR driver; only rides the user TOOK can be
  // linked to a grant/refund (the server rejects the rest).
  const riddenRides = useMemo(
    () => (rides ?? []).filter((ride) => ride.riderUserId === userId),
    [rides, userId],
  );
  // A shared-ride member's ride (or one beyond the newest page) joins the options.
  const linkableRides = useMemo(() => {
    if (!fromRideDetail || riddenRides.some((ride) => ride.id === fromRideDetail.ride.id)) {
      return riddenRides;
    }
    return [rideOption(fromRideDetail), ...riddenRides];
  }, [riddenRides, fromRideDetail]);
  const fromRide: RefundFromRide | undefined = refundRideId
    ? { rideId: refundRideId, detail: fromRideDetail ?? null }
    : undefined;

  function onCredited() {
    // UC-A-15: balances and history update instantly — refetch both.
    setPage(0);
    setRefresh((n) => n + 1);
  }

  const backLink = refundRideId ? (
    <BackLink to={`/rides/${refundRideId}`}>
      {t('money.wallet.backToRide')} <bdi dir="ltr">{rideRef(refundRideId)}</bdi>
    </BackLink>
  ) : (
    <BackLink to="/users">{t('money.wallet.back')}</BackLink>
  );

  if (walletError) {
    return (
      <section className="page">
        {backLink}
        <LoadFailure
          kind={walletError}
          notFoundKey="money.wallet.notFound"
          onRetry={() => setRefresh((n) => n + 1)}
        />
      </section>
    );
  }
  if (wallet === null) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  const balances = wallet.balances.length > 0 ? wallet.balances : [{ currency: 'SYP', balance: 0 }];
  const dues = pendingDueByCurrency(wallet);
  const currencies = [...new Set([...wallet.balances.map((b) => b.currency), 'SYP'])];
  const lastPage = transactions ? Math.max(0, transactions.totalPages - 1) : 0;

  function entrySub(transaction: WalletTransaction): string | null {
    return transaction.reason ?? null;
  }

  return (
    <section className="page">
      {backLink}
      <PageHeader
        title={<bdi>{identity?.name ?? passedName ?? t('money.wallet.title')}</bdi>}
        description={summary ?? (identity || passedName ? null : <span dir="ltr">{userId}</span>)}
      />
      <UserProfileTabs
        userId={userId}
        name={identity?.name ?? passedName}
        isDriver={identity?.roles.some((role) => role.role === 'driver') ?? false}
      />

      <ReviewLayout
        aside={
          !canManage ? null : refundRideId && fromRideDetail === undefined ? (
            <div className="loading">{t('common.loading')}</div>
          ) : (
            <GrantRefundPanel
              key={refundRideId ?? 'panel'}
              userId={userId}
              currencies={currencies}
              rides={canRides ? linkableRides : null}
              onCredited={onCredited}
              initialReason={grantReason}
              fromRide={fromRide}
            />
          )
        }
      >
        <KpiRow>
          {balances.map((balance) => (
            <KpiTile
              key={balance.currency}
              label={t('money.wallet.balanceTile', {
                currency: currencyLabel(balance.currency),
              })}
              value={<Money amount={balance.balance} />}
            />
          ))}
          {[...dues.entries()].map(([currency, due]) => (
            <KpiTile
              key={`due-${currency}`}
              tone="warning"
              label={t('money.wallet.pendingDueTile', { currency: currencyLabel(currency) })}
              value={<Money amount={due.amount} />}
              hint={t(due.count > 1 ? 'money.wallet.dueLineMany' : 'money.wallet.dueLine', {
                count: due.count,
                date: formatDay(due.latest.createdAt, i18n.language),
              })}
            />
          ))}
        </KpiRow>

        {transactionsError ? (
          <LoadFailure
            kind={transactionsError}
            notFoundKey="money.wallet.notFound"
            onRetry={() => setRefresh((n) => n + 1)}
          />
        ) : transactions === null ? (
          <div className="loading">{t('common.loading')}</div>
        ) : (
          <DataTable
            title={t('money.wallet.activityTitle')}
            isEmpty={transactions.items.length === 0}
            empty={t('money.wallet.empty')}
            footer={
              transactions.totalItems > transactions.size ? (
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
              {transactions.items.map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <span className="entry">
                      <span className="entry__type">{t(`money.txType.${transaction.type}`)}</span>
                      {entrySub(transaction) ? (
                        <span className="entry__sub" dir="auto">
                          {entrySub(transaction)}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td>
                    <RideRef rideId={transaction.rideId} rides={ridesById} />
                  </td>
                  <td className="table__muted">
                    {formatDay(transaction.createdAt, i18n.language)}
                  </td>
                  <td
                    className={`table__num ${transaction.amount < 0 ? 'amount--debit' : 'amount--credit'}`}
                  >
                    <span dir="ltr">{formatSigned(transaction.amount, i18n.language)}</span>
                  </td>
                  <td className="table__num table__muted">
                    <Money amount={transaction.balanceAfter} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </ReviewLayout>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { listPromos, patchPromo, type Promo, type PromoPage } from '../api/growth';
import {
  listRegions,
  listServiceTypes,
  type RegionSummary,
  type ServiceType,
} from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useRegionsViewTitle } from './regions/use-regions-view-title';
import { useCurrencyLabel } from './money/use-currency-label';
import { useToast } from '../toast/ToastProvider';
import { DataTable, KpiRow, KpiTile, PageHeader, StatusChip, TablePager } from '../ui';
import { formatMoney, formatNumber } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import {
  formatDecimal,
  PROMO_STATUS_TONES,
  promoStatus,
  windowLabel,
} from './growth/growth-format';

const PAGE_SIZE = 20;

/**
 * UC-A-26 (GRW-01/02) — the promotions queue (artboard "A13Promos",
 * owner-approved 2026-10-18): every promo with its redemption counters, the
 * live Active count, a region filter, and Deactivate (stops NEW redemptions;
 * rides that already reserved the promo keep their discount). Route-guarded
 * by `promos:view`; deactivating needs `promos:manage` and is audit-logged
 * server-side. The 7-day redemption KPIs of the artboard await a backend
 * aggregate (owner ruling 2026-10-18: ship without them).
 */
export default function PromosPage() {
  const { t, i18n } = useTranslation();
  const regionsTitle = useRegionsViewTitle();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const currencyLabel = useCurrencyLabel();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const regionId = params.get('regionId') ?? '';
  const page = Math.max(0, Number(params.get('page')) || 0);

  const [result, setResult] = useState<PromoPage | null>(null);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  // W18: ride-type names for the Limits column, per region (pricing:view;
  // degrades to the generic label without it or while loading).
  const [serviceTypes, setServiceTypes] = useState<Record<string, ServiceType[]>>({});
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    listPromos(apiClient, { regionId: regionId || undefined, page, size: PAGE_SIZE })
      .then((loaded) => {
        if (!cancelled) {
          setResult(loaded);
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
  }, [apiClient, regionId, page, attempt]);

  // The Active KPI is a totalItems-only query; it never blocks the table.
  useEffect(() => {
    let cancelled = false;
    // W17: `running` = active AND window contains now — matches the KPI hint.
    listPromos(apiClient, { running: true, page: 0, size: 1 })
      .then((loaded) => {
        if (!cancelled) {
          setActiveCount(loaded.totalItems);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveCount(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, attempt]);

  // W18: one service-type fetch per region present among the page's
  // restricted promos (board A13Promos shows the type's name).
  const canSeeTypes = can('pricing:view');
  useEffect(() => {
    if (!result || !canSeeTypes) {
      return;
    }
    const wanted = [
      ...new Set(
        result.items
          .filter((promo) => promo.serviceTypeId && promo.regionId)
          .map((promo) => promo.regionId!),
      ),
    ].filter((id) => !(id in serviceTypes));
    if (wanted.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      wanted.map(async (id) => {
        try {
          return [id, await listServiceTypes(apiClient, id)] as const;
        } catch {
          return [id, []] as const;
        }
      }),
    ).then((loaded) => {
      if (!cancelled) {
        setServiceTypes((current) => ({
          ...current,
          ...Object.fromEntries(loaded),
        }));
      }
    });
    return () => {
      cancelled = true;
    };
    // serviceTypes is appended, never a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, canSeeTypes, apiClient]);

  // Region names for the filter and the limits column; missing regions:view
  // degrades to ids staying hidden (same convention as RidesPage).
  useEffect(() => {
    let cancelled = false;
    listRegions(apiClient)
      .then((loaded) => {
        if (!cancelled) {
          setRegions(loaded);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  function navigate(nextRegionId: string, nextPage: number) {
    const next = new URLSearchParams();
    if (nextRegionId) {
      next.set('regionId', nextRegionId);
    }
    if (nextPage > 0) {
      next.set('page', String(nextPage));
    }
    setParams(next);
  }

  function regionName(id?: string | null): string | null {
    if (!id) {
      return null;
    }
    return regions.find((region) => region.id === id)?.name ?? null;
  }

  function currencyOf(promo: Promo): string | null {
    if (!promo.regionId) {
      return null;
    }
    return regions.find((region) => region.id === promo.regionId)?.currency ?? null;
  }

  function discountLabel(promo: Promo): string {
    const currency = currencyOf(promo);
    if (promo.type === 'percent') {
      const percent = t('promos.percentOff', { value: formatDecimal(promo.value, language) });
      if (!promo.maxDiscount) {
        return percent;
      }
      const max = currency
        ? formatMoney(Number(promo.maxDiscount), currencyLabel(currency), language)
        : formatDecimal(promo.maxDiscount, language);
      return `${percent} · ${t('promos.maxDiscountShort', { amount: max })}`;
    }
    const amount = currency
      ? formatMoney(Number(promo.value), currencyLabel(currency), language)
      : formatDecimal(promo.value, language);
    return t('promos.fixedOff', { amount });
  }

  function limitsLabel(promo: Promo): string {
    const parts = [t('promos.perUser', { count: promo.perUserLimit })];
    if (promo.firstRideOnly) {
      parts.push(t('promos.firstRideOnlyShort'));
    }
    const region = regionName(promo.regionId);
    if (region) {
      parts.push(region);
    }
    if (promo.serviceTypeId) {
      const named = promo.regionId
        ? serviceTypes[promo.regionId]?.find((type) => type.id === promo.serviceTypeId)
        : undefined;
      parts.push(
        named ? (language === 'ar' ? named.nameAr : named.nameEn) : t('promos.rideTypeLimited'),
      );
    }
    return parts.join(' · ');
  }

  function redeemedLabel(promo: Promo): string {
    const count = formatNumber(promo.redemptionCount, language);
    return promo.totalCap
      ? t('promos.redeemedOf', { redeemed: count, cap: formatNumber(promo.totalCap, language) })
      : count;
  }

  async function deactivate(promo: Promo) {
    setDeactivating(true);
    try {
      const updated = await patchPromo(apiClient, promo.promoId, { active: false });
      setResult((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.promoId === updated.promoId ? updated : item,
              ),
            }
          : current,
      );
      setConfirmingId(null);
      toast.show({ tone: 'success', message: t('promos.deactivated', { code: promo.code }) });
      setActiveCount((count) => (count === null ? null : Math.max(0, count - 1)));
    } catch {
      setConfirmingId(null);
      toast.show({ tone: 'error', message: t('promos.deactivateFailed') });
    } finally {
      setDeactivating(false);
    }
  }

  const canManage = can('promos:manage');
  const lastPage = result ? Math.max(0, Math.ceil(result.totalItems / result.size) - 1) : 0;

  return (
    <section className="page">
      <PageHeader
        title={t('promos.title')}
        description={t('promos.subtitle')}
        actions={
          canManage ? (
            <Link className="btn btn--primary" to="/promos/new">
              {t('promos.new')}
            </Link>
          ) : null
        }
      />

      <KpiRow>
        <KpiTile
          label={t('promos.kpiActive')}
          value={activeCount === null ? '—' : formatNumber(activeCount, language)}
          hint={t('promos.kpiActiveHint')}
        />
      </KpiRow>

      <div className="panel__row">
        <div className="form-field">
          <label htmlFor="promos-region">{t('promos.regionFilter')}</label>
          <select
            id="promos-region"
            title={regionsTitle}
            disabled={regionsTitle !== undefined}
            value={regionId}
            onChange={(event) => navigate(event.target.value, 0)}
          >
            <option value="">{t('promos.allRegions')}</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadError ? (
        <LoadFailure
          kind={loadError}
          notFoundKey="review.errors.server"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : result === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <>
          <DataTable
            isEmpty={result.items.length === 0}
            empty={t('promos.empty')}
            footer={
              result.totalItems > result.size ? (
                <TablePager
                  status={t('money.pageOf', { page: page + 1, total: lastPage + 1 })}
                  previousLabel={t('audit.previous')}
                  nextLabel={t('audit.next')}
                  canPrevious={page > 0}
                  canNext={page < lastPage}
                  onPrevious={() => navigate(regionId, page - 1)}
                  onNext={() => navigate(regionId, page + 1)}
                />
              ) : null
            }
          >
            <thead>
              <tr>
                <th>{t('promos.columns.code')}</th>
                <th>{t('promos.columns.discount')}</th>
                <th>{t('promos.columns.window')}</th>
                <th>{t('promos.columns.limits')}</th>
                <th>{t('promos.columns.redeemed')}</th>
                <th>{t('promos.columns.status')}</th>
                <th className="table__cell--action">
                  <span className="visually-hidden">{t('promos.columns.action')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((promo) => {
                const status = promoStatus(promo);
                const stoppable = canManage && (status === 'active' || status === 'scheduled');
                return (
                  <tr key={promo.promoId}>
                    <td className="promos__code" dir="ltr">
                      {promo.code}
                    </td>
                    <td className="table__muted">{discountLabel(promo)}</td>
                    <td className="table__muted">
                      {windowLabel(promo.startsAt, promo.endsAt, language)}
                    </td>
                    <td className="table__muted">{limitsLabel(promo)}</td>
                    <td className="table__muted">
                      {redeemedLabel(promo)}
                      {promo.redeemedAmount ? (
                        <span className="person__phone">
                          {' '}
                          ·{' '}
                          {currencyOf(promo)
                            ? formatMoney(
                                Number(promo.redeemedAmount),
                                currencyLabel(currencyOf(promo)!),
                                language,
                              )
                            : formatDecimal(promo.redeemedAmount, language)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <StatusChip tone={PROMO_STATUS_TONES[status]}>
                        {t(`promos.status.${status}`)}
                      </StatusChip>
                    </td>
                    <td className="table__cell--action">
                      {confirmingId === promo.promoId ? (
                        <span className="table__confirm">
                          {t('promos.confirmDeactivate')}
                          <button
                            type="button"
                            className="btn btn--danger btn--small"
                            disabled={deactivating}
                            onClick={() => void deactivate(promo)}
                          >
                            {t('common.confirm')}
                          </button>
                          <button
                            type="button"
                            className="btn btn--small"
                            disabled={deactivating}
                            onClick={() => setConfirmingId(null)}
                          >
                            {t('common.cancel')}
                          </button>
                        </span>
                      ) : stoppable ? (
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() => setConfirmingId(promo.promoId)}
                        >
                          {t('promos.deactivate')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
          <p className="table__muted promos__footnote">{t('promos.footnote')}</p>
        </>
      )}
    </section>
  );
}

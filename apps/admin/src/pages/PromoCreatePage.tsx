import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { createPromo, type PromoType } from '../api/growth';
import {
  listRegions,
  listServiceTypes,
  type RegionSummary,
  type ServiceType,
} from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../toast/ToastProvider';
import { BackLink, DecisionPanel, PageHeader, ReviewLayout, Section } from '../ui';
import { RegionsViewHint } from './regions/RegionsViewHint';
import { formatDecimal, windowLabel, toIso } from './growth/growth-format';

function mapCreateError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'promos.errors.codeTaken';
    }
    if (error.code === 'fixed_needs_region') {
      return 'promos.errors.fixedNeedsRegion';
    }
    if (error.code === 'window_invalid') {
      // Info 3: ONLY the named code — another 400/422 is not about the window.
      return 'promos.errors.window';
    }
  }
  return 'promos.errors.generic';
}

/**
 * UC-A-26 — the New promo form (artboard "A13PromoCreate", owner-approved
 * 2026-10-18): code, percent/fixed discount with an optional cap, the window,
 * total + per-rider limits, region / ride-type restriction and first-ride-only,
 * with the live summary and the platform-funded money note. A ride-type
 * restriction needs a region first (service types are per region — contract);
 * a FIXED amount needs a region for its currency (422 `fixed_needs_region`).
 * Requires `promos:manage` (route guard); creation is audit-logged server-side.
 */
export default function PromoCreatePage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [type, setType] = useState<PromoType>('percent');
  const [value, setValue] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [totalCap, setTotalCap] = useState('');
  const [perUserLimit, setPerUserLimit] = useState('1');
  const [regionId, setRegionId] = useState('');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [firstRideOnly, setFirstRideOnly] = useState(false);

  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  // Ride types are per region (pricing:view); without a region — or without
  // the permission — the restriction stays "all ride types".
  useEffect(() => {
    let cancelled = false;
    setServiceTypes([]);
    setServiceTypeId('');
    if (!regionId) {
      return undefined;
    }
    listServiceTypes(apiClient, regionId)
      .then((loaded) => {
        if (!cancelled) {
          setServiceTypes(loaded.filter((item) => item.enabled));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient, regionId]);

  const region = regions.find((item) => item.id === regionId) ?? null;
  const currency = region?.currency ?? null;

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (value) {
      parts.push(
        type === 'percent'
          ? maxDiscount
            ? t('promos.summary.percentCapped', {
                value,
                max: currency
                  ? `${currency} ${formatDecimal(maxDiscount, language)}`
                  : formatDecimal(maxDiscount, language),
              })
            : t('promos.summary.percent', { value })
          : t('promos.summary.fixed', {
              amount: currency
                ? `${currency} ${formatDecimal(value, language)}`
                : formatDecimal(value, language),
            }),
      );
    }
    if (startsAt && endsAt) {
      parts.push(
        windowLabel(new Date(startsAt).toISOString(), new Date(endsAt).toISOString(), language),
      );
    }
    parts.push(
      totalCap
        ? t('promos.summary.limits', {
            total: formatDecimal(totalCap, language),
            perUser: perUserLimit || '1',
          })
        : t('promos.summary.perUserOnly', { perUser: perUserLimit || '1' }),
    );
    parts.push(region ? region.name : t('promos.allRegions'));
    const serviceType = serviceTypes.find((item) => item.id === serviceTypeId);
    parts.push(
      serviceType
        ? language === 'ar'
          ? serviceType.nameAr
          : serviceType.nameEn
        : t('promos.allRideTypes'),
    );
    if (firstRideOnly) {
      parts.push(t('promos.firstRideOnlyShort'));
    }
    return parts.join(' · ');
  }, [
    t,
    language,
    value,
    type,
    maxDiscount,
    currency,
    startsAt,
    endsAt,
    totalCap,
    perUserLimit,
    region,
    serviceTypes,
    serviceTypeId,
    firstRideOnly,
  ]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const starts = toIso(startsAt);
    const ends = toIso(endsAt);
    if (!starts || !ends || Date.parse(ends) <= Date.parse(starts)) {
      setFormError('promos.errors.window');
      return;
    }
    if (type === 'fixed' && !regionId) {
      setFormError('promos.errors.fixedNeedsRegion');
      return;
    }
    setSubmitting(true);
    try {
      await createPromo(apiClient, {
        code: code.trim().toUpperCase(),
        type,
        value: value.trim(),
        maxDiscount: type === 'percent' && maxDiscount.trim() !== '' ? maxDiscount.trim() : null,
        startsAt: starts,
        endsAt: ends,
        perUserLimit: Math.max(1, Number(perUserLimit) || 1),
        totalCap: totalCap.trim() !== '' ? Math.max(1, Number(totalCap)) : null,
        regionId: regionId || null,
        serviceTypeId: serviceTypeId || null,
        firstRideOnly,
      });
      toast.show({
        tone: 'success',
        message: t('promos.created', { code: code.trim().toUpperCase() }),
      });
      navigate('/promos');
    } catch (error) {
      setFormError(mapCreateError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page">
      <PageHeader
        title={t('promos.createTitle')}
        leading={<BackLink to="/promos">{t('promos.title')}</BackLink>}
      />

      <form onSubmit={(event) => void handleSubmit(event)}>
        <ReviewLayout
          aside={
            <DecisionPanel title={t('promos.summary.title')} label={t('promos.summary.title')}>
              <div className="banner banner--info">
                <strong dir="ltr">{code.trim().toUpperCase() || '—'}</strong>
                <p>{summary}</p>
              </div>
              <div className="banner banner--warning">
                <strong>{t('promos.money.title')}</strong>
                <p>{t('promos.money.body')}</p>
              </div>
              <div className="panel__row">
                <button className="btn btn--primary" type="submit" disabled={submitting}>
                  {submitting ? t('review.working') : t('promos.form.submit')}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={submitting}
                  onClick={() => navigate('/promos')}
                >
                  {t('common.cancel')}
                </button>
              </div>
              <p className="panel__hint">{t('promos.form.footnote')}</p>
            </DecisionPanel>
          }
        >
          <Section title={t('promos.form.section')}>
            {formError ? (
              <p className="banner banner--error" role="alert">
                {t(formError)}
              </p>
            ) : null}
            <div className="panel__row">
              <div className="form-field">
                <label htmlFor="promo-code">{t('promos.form.code')}</label>
                <input
                  id="promo-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                  pattern="[A-Za-z0-9]{3,20}"
                  maxLength={20}
                  dir="ltr"
                  autoCapitalize="characters"
                  disabled={submitting}
                />
                <p className="panel__hint">{t('promos.form.codeHint')}</p>
              </div>
              <div className="form-field">
                <label htmlFor="promo-type">{t('promos.form.type')}</label>
                <select
                  id="promo-type"
                  value={type}
                  onChange={(event) => setType(event.target.value as PromoType)}
                  disabled={submitting}
                >
                  <option value="percent">{t('promos.form.typePercent')}</option>
                  <option value="fixed">{t('promos.form.typeFixed')}</option>
                </select>
              </div>
            </div>
            <div className="panel__row">
              <div className="form-field">
                <label htmlFor="promo-value">
                  {type === 'percent'
                    ? t('promos.form.percent')
                    : currency
                      ? t('promos.form.amountIn', { currency })
                      : t('promos.form.amount')}
                </label>
                <input
                  id="promo-value"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  required
                  inputMode="numeric"
                  type="number"
                  min="0.01"
                  max={type === 'percent' ? '100' : undefined}
                  step="0.01"
                  disabled={submitting}
                />
              </div>
              {type === 'percent' ? (
                <div className="form-field">
                  <label htmlFor="promo-max">
                    {currency
                      ? t('promos.form.maxDiscountIn', { currency })
                      : t('promos.form.maxDiscount')}
                  </label>
                  <input
                    id="promo-max"
                    value={maxDiscount}
                    onChange={(event) => setMaxDiscount(event.target.value)}
                    inputMode="numeric"
                    type="number"
                    min="1"
                    disabled={submitting}
                  />
                </div>
              ) : null}
            </div>
            <div className="panel__row">
              <div className="form-field">
                <label htmlFor="promo-starts">{t('promos.form.starts')}</label>
                <input
                  id="promo-starts"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
              <div className="form-field">
                <label htmlFor="promo-ends">{t('promos.form.ends')}</label>
                <input
                  id="promo-ends"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
            </div>
            <div className="panel__row">
              <div className="form-field">
                <label htmlFor="promo-total">{t('promos.form.totalCap')}</label>
                <input
                  id="promo-total"
                  value={totalCap}
                  onChange={(event) => setTotalCap(event.target.value)}
                  inputMode="numeric"
                  type="number"
                  min="1"
                  disabled={submitting}
                />
              </div>
              <div className="form-field">
                <label htmlFor="promo-per-user">{t('promos.form.perUser')}</label>
                <input
                  id="promo-per-user"
                  value={perUserLimit}
                  onChange={(event) => setPerUserLimit(event.target.value)}
                  required
                  inputMode="numeric"
                  type="number"
                  min="1"
                  disabled={submitting}
                />
              </div>
            </div>
            <div className="panel__row">
              <div className="form-field">
                <label htmlFor="promo-region">{t('promos.form.region')}</label>
                <select
                  id="promo-region"
                  value={regionId}
                  onChange={(event) => setRegionId(event.target.value)}
                  disabled={submitting}
                >
                  <option value="">{t('promos.allRegions')}</option>
                  {regions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <RegionsViewHint />
                {type === 'fixed' ? (
                  <p className="panel__hint">{t('promos.form.fixedRegionHint')}</p>
                ) : null}
              </div>
              <div className="form-field">
                <label htmlFor="promo-service-type">{t('promos.form.rideType')}</label>
                <select
                  id="promo-service-type"
                  value={serviceTypeId}
                  onChange={(event) => setServiceTypeId(event.target.value)}
                  disabled={submitting || serviceTypes.length === 0}
                >
                  <option value="">{t('promos.allRideTypes')}</option>
                  {serviceTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {language === 'ar' ? item.nameAr : item.nameEn}
                    </option>
                  ))}
                </select>
                {!regionId ? <p className="panel__hint">{t('promos.form.rideTypeHint')}</p> : null}
              </div>
            </div>
            <fieldset className="checklist" disabled={submitting}>
              <label className="checklist__item">
                <input
                  type="checkbox"
                  checked={firstRideOnly}
                  onChange={(event) => setFirstRideOnly(event.target.checked)}
                />
                <span>
                  {t('promos.form.firstRideOnly')}{' '}
                  <span className="table__muted">{t('promos.form.firstRideOnlyHint')}</span>
                </span>
              </label>
            </fieldset>
          </Section>
        </ReviewLayout>
      </form>
    </section>
  );
}

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../api/client';
import {
  updateRegion,
  type GeoJsonPolygon,
  type Region,
  type RegionUpsertRequest,
} from '../../api/regions';
import { useAuth } from '../../auth/AuthContext';
import { PeakHourBonusSection, type PeakWindowRow } from './PeakHourBonusSection';
import { PolygonMapEditor } from './PolygonMapEditor';
import { withSrsDefaults } from './srs-defaults';
import { toContractTime, toTimeInput } from './timeWindows';

interface TierRow {
  weeklyTripsAbove: string;
  percent: string;
}

interface BonusRow {
  trips: string;
  amount: string;
}

/** '' <-> null for the draft-friendly nullable bundle numbers. */
function toInput(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

function toNumberOrNull(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

/** The backend's peak-window rule codes (M15-T3) — shown in the peak sub-section. */
const PEAK_WINDOW_CODES = new Set(['peak_windows_required', 'peak_window_invalid']);

function isPeakWindowError(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 400 && PEAK_WINDOW_CODES.has(error.code ?? '')
  );
}

function mapSaveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'regionDetail.errors.saveConflict';
    }
    if (error.status === 400) {
      return 'regionDetail.errors.validation';
    }
  }
  return 'regionDetail.errors.generic';
}

/**
 * UC-A-05 steps 1/3/4 + UC-A-06: the full ADM-01 bundle in one form, saved
 * with a single full-bundle PUT (absent optional fields clear, per the
 * contract) — edits apply to NEW rides only, the backend's rule. The
 * boundary is part of the bundle and is drawn on the map section. Editing
 * needs regions:edit; without it everything renders disabled and the Save
 * button is hidden. Right after the region is created (`prefillDefaults`),
 * every unset value starts at its SRS §9 default — editable, saved only with
 * the bundle; an existing region always shows what is stored.
 */
export function BundleForm({
  region,
  canEdit,
  onSaved,
  prefillDefaults = false,
}: {
  region: Region;
  canEdit: boolean;
  onSaved: (region: Region) => void;
  /** The region was just created: offer the SRS §9 defaults (I24, I26–I28). */
  prefillDefaults?: boolean;
}) {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const prefilled = prefillDefaults && canEdit;
  const initial = prefilled ? withSrsDefaults(region) : region;

  const [name, setName] = useState(region.name);
  const [currency, setCurrency] = useState(region.currency ?? '');
  const [emergencyNumber, setEmergencyNumber] = useState(region.emergencyNumber ?? '');
  const [boundary, setBoundary] = useState<GeoJsonPolygon | null>(region.boundary ?? null);

  const [cancellationGraceMin, setCancellationGraceMin] = useState(
    toInput(initial.cancellationGraceMin),
  );
  const [cancellationFee, setCancellationFee] = useState(toInput(initial.cancellationFee));
  const [waitGraceMin, setWaitGraceMin] = useState(toInput(initial.waitGraceMin));
  const [waitPerMinRate, setWaitPerMinRate] = useState(toInput(initial.waitPerMinRate));
  const [pickupFeeThresholdKm, setPickupFeeThresholdKm] = useState(
    toInput(initial.pickupFeeThresholdKm),
  );
  const [pickupFeePerKm, setPickupFeePerKm] = useState(toInput(initial.pickupFeePerKm));
  const [surgeCap, setSurgeCap] = useState(toInput(initial.surgeCap));

  const [tiers, setTiers] = useState<TierRow[]>(
    (initial.commissionTiers ?? []).map((tier) => ({
      weeklyTripsAbove: String(tier.weeklyTripsAbove),
      percent: String(tier.percent),
    })),
  );

  const [bonuses, setBonuses] = useState<BonusRow[]>(
    (initial.incentiveValues?.weeklyTripBonuses ?? []).map((bonus) => ({
      trips: String(bonus.trips),
      amount: String(bonus.amount),
    })),
  );
  const [peakHourBonus, setPeakHourBonus] = useState(
    toInput(initial.incentiveValues?.peakHourBonusPerTrip ?? null),
  );
  const [peakWindows, setPeakWindows] = useState<PeakWindowRow[]>(
    (initial.incentiveValues?.peakWindows ?? []).map((window) => ({
      days: [...window.daysOfWeek],
      startsAt: toTimeInput(window.startsAt),
      endsAt: toTimeInput(window.endsAt),
    })),
  );
  const [rewardAmount, setRewardAmount] = useState(
    toInput(initial.incentiveValues?.ratingReward.amount ?? null),
  );
  const [rewardMinAvgRating, setRewardMinAvgRating] = useState(
    toInput(initial.incentiveValues?.ratingReward.minAvgRating ?? null),
  );
  const [rewardMinWeeklyTrips, setRewardMinWeeklyTrips] = useState(
    toInput(initial.incentiveValues?.ratingReward.minWeeklyTrips ?? null),
  );

  const [driverMinAvgRating, setDriverMinAvgRating] = useState(
    toInput(initial.suspensionThresholds?.driver.minAvgRating ?? null),
  );
  const [driverMinRatedRides, setDriverMinRatedRides] = useState(
    toInput(initial.suspensionThresholds?.driver.minRatedRides ?? null),
  );
  const [riderMinAvgRating, setRiderMinAvgRating] = useState(
    toInput(initial.suspensionThresholds?.rider.minAvgRating ?? null),
  );
  const [riderMinRatedRides, setRiderMinRatedRides] = useState(
    toInput(initial.suspensionThresholds?.rider.minRatedRides ?? null),
  );
  // RATE-03 flag levels (M11) — optional inside the thresholds group.
  const [driverWarnAvgRating, setDriverWarnAvgRating] = useState(
    toInput(initial.suspensionThresholds?.driver.warnAvgRating ?? null),
  );
  const [riderWarnAvgRating, setRiderWarnAvgRating] = useState(
    toInput(initial.suspensionThresholds?.rider.warnAvgRating ?? null),
  );

  // DRV-07 metric warnings (M11) — all four or none.
  const [minAcceptancePercent, setMinAcceptancePercent] = useState(
    toInput(initial.metricWarnings?.minAcceptancePercent ?? null),
  );
  const [maxCancellationPercent, setMaxCancellationPercent] = useState(
    toInput(initial.metricWarnings?.maxCancellationPercent ?? null),
  );
  const [metricWindowDays, setMetricWindowDays] = useState(
    toInput(initial.metricWarnings?.windowDays ?? null),
  );
  const [metricMinSample, setMetricMinSample] = useState(
    toInput(initial.metricWarnings?.minSample ?? null),
  );

  const [saveError, setSaveError] = useState<string | null>(null);
  const [peakError, setPeakError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function updateTier(index: number, patch: Partial<TierRow>) {
    setTiers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function updateBonus(index: number, patch: Partial<BonusRow>) {
    setBonuses((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /**
   * Grouped values are all-or-nothing on the wire (the contract requires
   * every field of commissionTiers rows, incentiveValues and
   * suspensionThresholds). A half-filled group would silently vanish in
   * the full-bundle PUT, so it blocks the save instead.
   */
  function buildBody(): RegionUpsertRequest | null {
    if (tiers.some((row) => row.weeklyTripsAbove.trim() === '' || row.percent.trim() === '')) {
      setSaveError('regionDetail.errors.incompleteTiers');
      return null;
    }

    const incentiveFields = [peakHourBonus, rewardAmount, rewardMinAvgRating, rewardMinWeeklyTrips];
    const incentivesTouched =
      bonuses.length > 0 ||
      peakWindows.length > 0 ||
      incentiveFields.some((field) => field.trim() !== '');
    const incentivesComplete =
      incentiveFields.every((field) => field.trim() !== '') &&
      bonuses.every((row) => row.trips.trim() !== '' && row.amount.trim() !== '');
    if (incentivesTouched && !incentivesComplete) {
      setSaveError('regionDetail.errors.incompleteIncentives');
      return null;
    }
    // M15-T3: every window needs a day and both times; start and end differ;
    // a bonus above 0 needs at least one window (the backend's rules).
    if (
      peakWindows.some((row) => row.days.length === 0 || row.startsAt === '' || row.endsAt === '')
    ) {
      setPeakError('regionDetail.errors.peakWindowIncomplete');
      return null;
    }
    if (
      peakWindows.some((row) => row.startsAt === row.endsAt) ||
      (Number(peakHourBonus) > 0 && peakWindows.length === 0)
    ) {
      setPeakError('regionDetail.errors.peakWindows');
      return null;
    }

    const suspensionFields = [
      driverMinAvgRating,
      driverMinRatedRides,
      riderMinAvgRating,
      riderMinRatedRides,
    ];
    const suspensionTouched = suspensionFields.some((field) => field.trim() !== '');
    const suspensionComplete = suspensionFields.every((field) => field.trim() !== '');
    if (suspensionTouched && !suspensionComplete) {
      setSaveError('regionDetail.errors.incompleteSuspension');
      return null;
    }
    const warnLevels: [string, string][] = [
      [driverWarnAvgRating, driverMinAvgRating],
      [riderWarnAvgRating, riderMinAvgRating],
    ];
    if (warnLevels.some(([warn]) => warn.trim() !== '') && !suspensionComplete) {
      setSaveError('regionDetail.errors.incompleteSuspension');
      return null;
    }
    // The flag level must sit above the suspension level (contract).
    if (warnLevels.some(([warn, min]) => warn.trim() !== '' && Number(warn) <= Number(min))) {
      setSaveError('regionDetail.errors.warnNotAboveMin');
      return null;
    }

    const metricFields = [
      minAcceptancePercent,
      maxCancellationPercent,
      metricWindowDays,
      metricMinSample,
    ];
    const metricsTouched = metricFields.some((field) => field.trim() !== '');
    if (metricsTouched && !metricFields.every((field) => field.trim() !== '')) {
      setSaveError('regionDetail.errors.incompleteMetricWarnings');
      return null;
    }

    return {
      name: name.trim(),
      boundary,
      currency: currency.trim() === '' ? null : currency.trim().toUpperCase(),
      emergencyNumber: emergencyNumber.trim() === '' ? null : emergencyNumber.trim(),
      cancellationGraceMin: toNumberOrNull(cancellationGraceMin),
      cancellationFee: toNumberOrNull(cancellationFee),
      waitGraceMin: toNumberOrNull(waitGraceMin),
      waitPerMinRate: toNumberOrNull(waitPerMinRate),
      pickupFeeThresholdKm: toNumberOrNull(pickupFeeThresholdKm),
      pickupFeePerKm: toNumberOrNull(pickupFeePerKm),
      surgeCap: toNumberOrNull(surgeCap),
      commissionTiers:
        tiers.length === 0
          ? null
          : tiers.map((row) => ({
              weeklyTripsAbove: Number(row.weeklyTripsAbove),
              percent: Number(row.percent),
            })),
      incentiveValues: incentivesTouched
        ? {
            weeklyTripBonuses: bonuses.map((row) => ({
              trips: Number(row.trips),
              amount: Number(row.amount),
            })),
            peakHourBonusPerTrip: Number(peakHourBonus),
            peakWindows: peakWindows.map((row) => ({
              daysOfWeek: row.days,
              startsAt: toContractTime(row.startsAt),
              endsAt: toContractTime(row.endsAt),
            })),
            ratingReward: {
              amount: Number(rewardAmount),
              minAvgRating: Number(rewardMinAvgRating),
              minWeeklyTrips: Number(rewardMinWeeklyTrips),
            },
          }
        : null,
      suspensionThresholds: suspensionTouched
        ? {
            driver: {
              minAvgRating: Number(driverMinAvgRating),
              minRatedRides: Number(driverMinRatedRides),
              // Optional: omitted = minAvgRating + 0.5 on the server.
              ...(driverWarnAvgRating.trim() === ''
                ? {}
                : { warnAvgRating: Number(driverWarnAvgRating) }),
            },
            rider: {
              minAvgRating: Number(riderMinAvgRating),
              minRatedRides: Number(riderMinRatedRides),
              // Optional: omitted = minAvgRating + 0.5 on the server.
              ...(riderWarnAvgRating.trim() === ''
                ? {}
                : { warnAvgRating: Number(riderWarnAvgRating) }),
            },
          }
        : null,
      // Omitted keeps the stored value (contract) — only a full group is sent.
      metricWarnings: metricsTouched
        ? {
            minAcceptancePercent: Number(minAcceptancePercent),
            maxCancellationPercent: Number(maxCancellationPercent),
            windowDays: Number(metricWindowDays) === 7 ? 7 : 30,
            minSample: Number(metricMinSample),
          }
        : undefined,
    };
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setSaveError(null);
    setPeakError(null);
    const body = buildBody();
    if (!body) {
      return;
    }
    setSubmitting(true);
    try {
      const updated = await updateRegion(apiClient, region.id, body);
      onSaved(updated);
      setSaved(true);
    } catch (error) {
      if (isPeakWindowError(error)) {
        setPeakError('regionDetail.errors.peakWindows');
      } else {
        setSaveError(mapSaveError(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function numberField(
    id: string,
    labelKey: string,
    value: string,
    onChange: (next: string) => void,
    options: { min?: number; step?: string } = {},
  ) {
    return (
      <div className="form-field">
        <label htmlFor={id}>{t(labelKey)}</label>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={options.min ?? 0}
          step={options.step ?? 'any'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }

  return (
    <form className="card panel" onSubmit={(event) => void handleSave(event)}>
      <h2 className="panel__title">{t('regionDetail.bundleTitle')}</h2>
      <p className="panel__hint">{t('regionDetail.bundleHint')}</p>

      {saveError ? (
        <p className="banner banner--error" role="alert">
          {t(saveError)}
        </p>
      ) : null}
      {saved ? (
        <p className="banner banner--info" role="status">
          {t('regionDetail.savedNotice')}
        </p>
      ) : prefilled ? (
        <p className="banner banner--info">{t('regionDetail.defaultsNotice')}</p>
      ) : null}

      <fieldset className="bundle__fieldset" disabled={!canEdit || submitting}>
        <h3 className="bundle__section">{t('regionDetail.basicsTitle')}</h3>
        <div className="panel__row">
          <div className="form-field">
            <label htmlFor="bundle-name">{t('regionDetail.fields.name')}</label>
            <input
              id="bundle-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="bundle-currency">{t('regionDetail.fields.currency')}</label>
            <input
              id="bundle-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              dir="ltr"
            />
          </div>
          <div className="form-field">
            <label htmlFor="bundle-emergency">{t('regionDetail.fields.emergencyNumber')}</label>
            <input
              id="bundle-emergency"
              value={emergencyNumber}
              onChange={(event) => setEmergencyNumber(event.target.value)}
              maxLength={20}
              dir="ltr"
            />
          </div>
        </div>

        <h3 className="bundle__section">{t('regionDetail.feesTitle')}</h3>
        <div className="panel__row">
          {numberField(
            'bundle-cancellation-grace',
            'regionDetail.fields.cancellationGraceMin',
            cancellationGraceMin,
            setCancellationGraceMin,
            { step: '1' },
          )}
          {numberField(
            'bundle-cancellation-fee',
            'regionDetail.fields.cancellationFee',
            cancellationFee,
            setCancellationFee,
          )}
          {numberField(
            'bundle-wait-grace',
            'regionDetail.fields.waitGraceMin',
            waitGraceMin,
            setWaitGraceMin,
            { step: '1' },
          )}
          {numberField(
            'bundle-wait-rate',
            'regionDetail.fields.waitPerMinRate',
            waitPerMinRate,
            setWaitPerMinRate,
          )}
        </div>
        <div className="panel__row">
          {numberField(
            'bundle-pickup-threshold',
            'regionDetail.fields.pickupFeeThresholdKm',
            pickupFeeThresholdKm,
            setPickupFeeThresholdKm,
          )}
          {numberField(
            'bundle-pickup-rate',
            'regionDetail.fields.pickupFeePerKm',
            pickupFeePerKm,
            setPickupFeePerKm,
          )}
          {numberField('bundle-surge-cap', 'regionDetail.fields.surgeCap', surgeCap, setSurgeCap, {
            min: 1,
          })}
        </div>

        <h3 className="bundle__section">{t('regionDetail.commissionTitle')}</h3>
        <p className="panel__hint">{t('regionDetail.commissionHint')}</p>
        {tiers.map((tier, index) => (
          <div className="panel__row" key={index}>
            {numberField(
              `bundle-tier-trips-${index}`,
              'regionDetail.fields.weeklyTripsAbove',
              tier.weeklyTripsAbove,
              (next) => updateTier(index, { weeklyTripsAbove: next }),
              { step: '1' },
            )}
            {numberField(
              `bundle-tier-percent-${index}`,
              'regionDetail.fields.commissionPercent',
              tier.percent,
              (next) => updateTier(index, { percent: next }),
            )}
            <button
              className="btn"
              type="button"
              onClick={() => setTiers((rows) => rows.filter((_, i) => i !== index))}
            >
              {t('regionDetail.removeTier')}
            </button>
          </div>
        ))}
        <p>
          <button
            className="btn"
            type="button"
            onClick={() => setTiers((rows) => [...rows, { weeklyTripsAbove: '', percent: '' }])}
          >
            {t('regionDetail.addTier')}
          </button>
        </p>

        <h3 className="bundle__section">{t('regionDetail.incentivesTitle')}</h3>
        <h4 className="bundle__subsection">{t('regionDetail.weeklyBonusCaption')}</h4>
        {bonuses.map((bonus, index) => (
          <div className="panel__row" key={index}>
            {numberField(
              `bundle-bonus-trips-${index}`,
              'regionDetail.fields.bonusTrips',
              bonus.trips,
              (next) => updateBonus(index, { trips: next }),
              { min: 1, step: '1' },
            )}
            {numberField(
              `bundle-bonus-amount-${index}`,
              'regionDetail.fields.bonusAmount',
              bonus.amount,
              (next) => updateBonus(index, { amount: next }),
            )}
            <button
              className="btn"
              type="button"
              onClick={() => setBonuses((rows) => rows.filter((_, i) => i !== index))}
            >
              {t('regionDetail.removeBonus')}
            </button>
          </div>
        ))}
        <p>
          <button
            className="btn"
            type="button"
            onClick={() => setBonuses((rows) => [...rows, { trips: '', amount: '' }])}
          >
            {t('regionDetail.addBonus')}
          </button>
        </p>
        <PeakHourBonusSection
          bonus={peakHourBonus}
          onBonusChange={setPeakHourBonus}
          windows={peakWindows}
          onWindowsChange={setPeakWindows}
          currency={/^[A-Za-z]{3}$/.test(currency.trim()) ? currency.trim().toUpperCase() : null}
          timeZone={region.timeZone}
          error={peakError}
        />
        <h4 className="bundle__subsection">{t('regionDetail.ratingRewardCaption')}</h4>
        <div className="panel__row">
          {numberField(
            'bundle-reward-amount',
            'regionDetail.fields.ratingRewardAmount',
            rewardAmount,
            setRewardAmount,
          )}
          {numberField(
            'bundle-reward-min-avg',
            'regionDetail.fields.ratingRewardMinAvgRating',
            rewardMinAvgRating,
            setRewardMinAvgRating,
            { min: 1, step: '0.1' },
          )}
          {numberField(
            'bundle-reward-min-trips',
            'regionDetail.fields.ratingRewardMinWeeklyTrips',
            rewardMinWeeklyTrips,
            setRewardMinWeeklyTrips,
            { step: '1' },
          )}
        </div>
        <p className="panel__hint">{t('regionDetail.incentivesNote')}</p>

        <h3 className="bundle__section">{t('regionDetail.suspensionTitle')}</h3>
        <div className="panel__row">
          {numberField(
            'bundle-driver-min-avg',
            'regionDetail.fields.driverMinAvgRating',
            driverMinAvgRating,
            setDriverMinAvgRating,
            { min: 1, step: '0.1' },
          )}
          {numberField(
            'bundle-driver-min-rated',
            'regionDetail.fields.driverMinRatedRides',
            driverMinRatedRides,
            setDriverMinRatedRides,
            { min: 1, step: '1' },
          )}
          {numberField(
            'bundle-rider-min-avg',
            'regionDetail.fields.riderMinAvgRating',
            riderMinAvgRating,
            setRiderMinAvgRating,
            { min: 1, step: '0.1' },
          )}
          {numberField(
            'bundle-rider-min-rated',
            'regionDetail.fields.riderMinRatedRides',
            riderMinRatedRides,
            setRiderMinRatedRides,
            { min: 1, step: '1' },
          )}
        </div>
        <p className="panel__hint">{t('regionDetail.warnHint')}</p>
        <div className="panel__row">
          {numberField(
            'bundle-driver-warn-avg',
            'regionDetail.fields.driverWarnAvgRating',
            driverWarnAvgRating,
            setDriverWarnAvgRating,
            { min: 1, step: '0.1' },
          )}
          {numberField(
            'bundle-rider-warn-avg',
            'regionDetail.fields.riderWarnAvgRating',
            riderWarnAvgRating,
            setRiderWarnAvgRating,
            { min: 1, step: '0.1' },
          )}
        </div>

        <h3 className="bundle__section">{t('regionDetail.metricWarningsTitle')}</h3>
        <p className="panel__hint">{t('regionDetail.metricWarningsHint')}</p>
        <div className="panel__row">
          {numberField(
            'bundle-min-acceptance',
            'regionDetail.fields.minAcceptancePercent',
            minAcceptancePercent,
            setMinAcceptancePercent,
          )}
          {numberField(
            'bundle-max-cancellation',
            'regionDetail.fields.maxCancellationPercent',
            maxCancellationPercent,
            setMaxCancellationPercent,
          )}
          <div className="form-field">
            <label htmlFor="bundle-metric-window">
              {t('regionDetail.fields.metricWindowDays')}
            </label>
            <select
              id="bundle-metric-window"
              value={metricWindowDays}
              onChange={(event) => setMetricWindowDays(event.target.value)}
            >
              <option value="">{t('regionDetail.fields.metricWindowUnset')}</option>
              <option value="7">{t('regionDetail.fields.metricWindowOption', { days: 7 })}</option>
              <option value="30">
                {t('regionDetail.fields.metricWindowOption', { days: 30 })}
              </option>
            </select>
          </div>
          {numberField(
            'bundle-metric-min-sample',
            'regionDetail.fields.metricMinSample',
            metricMinSample,
            setMetricMinSample,
            { min: 1, step: '1' },
          )}
        </div>
      </fieldset>

      <h3 className="bundle__section">{t('regionDetail.boundaryTitle')}</h3>
      <p className="panel__hint">{t('regionDetail.boundaryHint')}</p>
      <PolygonMapEditor
        label={t('regionDetail.boundaryMapLabel')}
        polygon={boundary}
        editable={canEdit && !submitting}
        onPolygonChange={setBoundary}
      />

      {canEdit ? (
        <div className="panel__row">
          <button className="btn btn--primary" type="submit" disabled={submitting}>
            {submitting ? t('regionDetail.saving') : t('regionDetail.save')}
          </button>
        </div>
      ) : null}
    </form>
  );
}

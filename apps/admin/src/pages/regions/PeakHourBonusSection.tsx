import { useTranslation } from 'react-i18next';

import { ISO_DAYS } from './timeWindows';

/** One editable peak window: ISO days and "HH:mm" input values. */
export interface PeakWindowRow {
  days: number[];
  startsAt: string;
  endsAt: string;
}

/** End before start (both set) = the window runs past midnight. */
function isOvernight(row: PeakWindowRow): boolean {
  return row.startsAt !== '' && row.endsAt !== '' && row.endsAt < row.startsAt;
}

/**
 * DRV-08 peak-hour bonus inside the region bundle's Incentives section
 * (M15-T3, board A15RegionIncentives): the per-trip bonus plus the weekly
 * windows it pays in — ISO day chips and region-local start/end times. The
 * enclosing bundle fieldset owns the disabled state; validation runs in the
 * bundle form and its message is shown here.
 */
export function PeakHourBonusSection({
  bonus,
  onBonusChange,
  windows,
  onWindowsChange,
  currency,
  timeZone,
  error,
}: {
  bonus: string;
  onBonusChange: (next: string) => void;
  windows: PeakWindowRow[];
  onWindowsChange: (next: PeakWindowRow[]) => void;
  currency: string | null;
  timeZone: string;
  error: string | null;
}) {
  const { t } = useTranslation();

  function updateWindow(index: number, patch: Partial<PeakWindowRow>) {
    onWindowsChange(windows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function toggleDay(index: number, day: number) {
    const days = windows[index].days;
    updateWindow(index, {
      days: days.includes(day)
        ? days.filter((current) => current !== day)
        : ISO_DAYS.filter((candidate) => candidate === day || days.includes(candidate)),
    });
  }

  return (
    <div className="peak-bonus">
      <h4 className="peak-bonus__title">{t('regionDetail.peak.title')}</h4>
      <div className="panel__row">
        <div className="form-field">
          <label htmlFor="bundle-peak-bonus">
            {currency
              ? t('regionDetail.peak.bonusPerTripCurrency', {
                  currency: t(`money.currency.${currency}`, currency),
                })
              : t('regionDetail.peak.bonusPerTrip')}
          </label>
          <input
            id="bundle-peak-bonus"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={bonus}
            onChange={(event) => onBonusChange(event.target.value)}
          />
        </div>
        <p className="panel__hint peak-bonus__help">{t('regionDetail.peak.help', { timeZone })}</p>
      </div>

      {windows.map((row, index) => (
        <div className="peak-window" key={index}>
          <div className="form-field">
            <span className="form-field__label" id={`bundle-peak-days-${index}`}>
              {t('regionDetail.peak.days')}
            </span>
            <div
              className="filter-chips"
              role="group"
              aria-labelledby={`bundle-peak-days-${index}`}
            >
              {ISO_DAYS.map((day) => {
                const selected = row.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    className={selected ? 'filter-chip filter-chip--active' : 'filter-chip'}
                    aria-pressed={selected}
                    onClick={() => toggleDay(index, day)}
                  >
                    {t(`surcharges.days.d${day}`)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="form-field peak-window__time">
            <label htmlFor={`bundle-peak-start-${index}`}>{t('regionDetail.peak.startsAt')}</label>
            <input
              id={`bundle-peak-start-${index}`}
              type="time"
              value={row.startsAt}
              onChange={(event) => updateWindow(index, { startsAt: event.target.value })}
            />
          </div>
          <div className="form-field peak-window__time">
            <label htmlFor={`bundle-peak-end-${index}`}>{t('regionDetail.peak.endsAt')}</label>
            <input
              id={`bundle-peak-end-${index}`}
              type="time"
              value={row.endsAt}
              onChange={(event) => updateWindow(index, { endsAt: event.target.value })}
            />
          </div>
          <span className="peak-window__note">
            {isOvernight(row) ? t('regionDetail.peak.overnight') : null}
          </span>
          <button
            className="btn"
            type="button"
            onClick={() => onWindowsChange(windows.filter((_, i) => i !== index))}
          >
            {t('regionDetail.peak.remove')}
          </button>
        </div>
      ))}

      <p>
        <button
          className="btn"
          type="button"
          onClick={() => onWindowsChange([...windows, { days: [], startsAt: '', endsAt: '' }])}
        >
          {t('regionDetail.peak.add')}
        </button>
      </p>

      {error ? (
        <p className="banner banner--error" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

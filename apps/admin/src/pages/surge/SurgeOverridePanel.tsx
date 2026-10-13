import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../api/client';
import { resetSurgeOverride, setSurgeOverride, type SurgeZoneState } from '../../api/regions';
import { useAuth } from '../../auth/AuthContext';
import { DecisionPanel } from '../../ui';
import { classifyError } from '../onboarding/review-utils';
import {
  formatClock,
  formatMultiplier,
  formatSince,
  isolateLtr,
  parseMultiplier,
} from './surge-format';
import { Multiplier } from './SurgeUi';

interface PanelError {
  message: string;
  detail?: string;
}

/**
 * UC-A-09 side panel for the selected zone: its live numbers, the manual
 * multiplier (1.0 … the zone's effective cap, at most 2 decimals — checked
 * here and again by the backend), the pending note, and the override /
 * reset actions. Every change lands at the NEXT surge cycle; the page
 * refetches right after so the pending state shows at once. Without
 * pricing:edit the panel only shows the state (no controls).
 */
export function SurgeOverridePanel({
  zone,
  cap,
  nextCycleAt,
  canEdit,
  onChanged,
}: {
  zone: SurgeZoneState;
  /** The zone's effective cap (lower of zone and region cap); null = uncapped. */
  cap: number | null;
  nextCycleAt: string | null;
  canEdit: boolean;
  /** Refetch the surge state after a successful set/reset. */
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const language = i18n.language;
  const x = (value: number) => isolateLtr(formatMultiplier(value, language));

  const [raw, setRaw] = useState(
    zone.overrideMultiplier === null ? '' : String(zone.overrideMultiplier),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PanelError | null>(null);

  const hasOverride = zone.overrideMultiplier !== null;
  const nextTime = nextCycleAt ? formatClock(nextCycleAt, language) : null;

  function mapError(failure: unknown): PanelError {
    if (failure instanceof ApiError && failure.code === 'override_above_cap') {
      const reported = Number(failure.details?.cap);
      return Number.isFinite(reported) && failure.details?.cap != null
        ? { message: t('surgeLive.errors.aboveCap', { cap: x(reported) }) }
        : {
            message: t('surgeLive.errors.rejected'),
            detail: failure.serverMessage,
          };
    }
    switch (classifyError(failure)) {
      case 'validation':
        return {
          message: t('surgeLive.errors.rejected'),
          detail: failure instanceof ApiError ? failure.serverMessage : undefined,
        };
      case 'forbidden':
        return { message: t('surgeLive.errors.forbidden') };
      case 'notFound':
        return { message: t('surgeLive.errors.notFound') };
      case 'network':
        return { message: t('surgeLive.errors.network') };
      default:
        return { message: t('surgeLive.errors.server') };
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseMultiplier(raw, cap);
    if ('error' in parsed) {
      setError({
        message:
          parsed.error === 'format'
            ? t('surgeLive.errors.format')
            : cap === null
              ? t('surgeLive.errors.rangeUncapped')
              : t('surgeLive.errors.range', { cap: x(cap) }),
      });
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await setSurgeOverride(apiClient, zone.id, parsed.value);
      await onChanged();
    } catch (failure) {
      setError(mapError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setError(null);
    setBusy(true);
    try {
      await resetSurgeOverride(apiClient, zone.id);
      setRaw('');
      await onChanged();
    } catch (failure) {
      setError(mapError(failure));
    } finally {
      setBusy(false);
    }
  }

  const summary = t(cap === null ? 'surgeLive.panel.summaryUncapped' : 'surgeLive.panel.summary', {
    now: x(zone.currentMultiplier),
    automatic: x(zone.computedMultiplier),
    cap: cap === null ? '' : x(cap),
  });

  const pendingNote = zone.overridePending ? (
    <div className="banner banner--warning" role="status">
      <strong className="banner__title">{t('surgeLive.panel.pendingTitle')}</strong>
      <span className="banner__detail">
        {zone.overrideMultiplier !== null
          ? nextTime
            ? t('surgeLive.panel.pendingSet', {
                multiplier: x(zone.overrideMultiplier),
                time: nextTime,
              })
            : t('surgeLive.panel.pendingSetNoTime', { multiplier: x(zone.overrideMultiplier) })
          : nextTime
            ? t('surgeLive.panel.pendingReset', { time: nextTime })
            : t('surgeLive.panel.pendingResetNoTime')}
      </span>
    </div>
  ) : null;

  const overrideState =
    zone.overrideMultiplier === null ? (
      t('surgeLive.overrideAutomatic')
    ) : (
      <>
        <Multiplier value={zone.overrideMultiplier} />
        {zone.overrideSetAt
          ? ` ${t('surgeLive.overrideSetAt', { time: formatSince(zone.overrideSetAt, language) })}`
          : null}
      </>
    );

  return (
    <DecisionPanel title={zone.name} label={t('surgeLive.panel.label', { zone: zone.name })}>
      <p className="panel__hint surge-panel__summary">{summary}</p>

      {canEdit ? (
        <form className="decision-panel__actions" onSubmit={(event) => void submit(event)}>
          <div className="form-field">
            <label htmlFor="surge-override-multiplier">{t('surgeLive.panel.inputLabel')}</label>
            <input
              id="surge-override-multiplier"
              dir="ltr"
              inputMode="decimal"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              aria-describedby="surge-override-hint"
            />
            <span id="surge-override-hint" className="panel__hint">
              {cap === null
                ? t('surgeLive.panel.inputHintUncapped')
                : t('surgeLive.panel.inputHint', { cap: x(cap) })}
            </span>
          </div>

          {pendingNote}

          {error ? (
            <p className="banner banner--error" role="alert">
              {error.message}
              {error.detail ? (
                <span className="banner__detail" dir="auto">
                  {error.detail}
                </span>
              ) : null}
            </p>
          ) : null}

          <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
            {hasOverride ? t('surgeLive.panel.update') : t('surgeLive.panel.set')}
          </button>
          {hasOverride ? (
            <button
              className="btn btn--lg btn--block"
              type="button"
              disabled={busy}
              onClick={() => void reset()}
            >
              {t('surgeLive.panel.reset')}
            </button>
          ) : null}
          <p className="panel__hint">{t('surgeLive.panel.auditNote')}</p>
        </form>
      ) : (
        <>
          <p className="surge-panel__state">
            <span className="panel__hint">{t('surgeLive.panel.overrideLabel')}</span>{' '}
            <strong>{overrideState}</strong>
          </p>
          {pendingNote}
          <p className="panel__hint">{t('surgeLive.panel.readOnlyNote')}</p>
        </>
      )}
    </DecisionPanel>
  );
}

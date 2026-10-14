import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  acknowledgeSosEvent,
  listSosEvents,
  type AdminSosEvent,
  type SosStatusFilter,
} from '../../api/comms';
import { useAuth } from '../../auth/AuthContext';
import { usePermissions } from '../../auth/usePermissions';
import { useSosAlerts } from '../../sos/SosAlertsProvider';
import { FilterChips, Section, StatusChip } from '../../ui';
import { rideRef } from '../rides/ride-format';
import { formatSince } from '../surge';

const PANEL_PAGE_SIZE = 20;
const STATUS_FILTERS: readonly SosStatusFilter[] = ['open', 'acknowledged', 'all'];

/**
 * The live map's SOS alert panel (UC-A-20): the alert list from
 * GET /admin/sos-events with its status filter, and the stand-down
 * acknowledgement with an optional note. The whole panel needs
 * `support:view` (the page hides it otherwise); the acknowledge controls
 * additionally need `support:handle`. Acknowledging is audited and clears
 * the pin — the event itself stays immutable (SAFE-02).
 */
export function SosAlertPanel({
  regionId,
  onChanged,
}: {
  /** Narrows the list to the selected region; undefined = all regions. */
  regionId?: string;
  /** Fired after a successful acknowledgement (refresh pins/banner). */
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const { refresh: refreshBadge } = useSosAlerts();
  const canHandle = can('support:handle');

  const [status, setStatus] = useState<SosStatusFilter>('open');
  const [events, setEvents] = useState<AdminSosEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setFailed(false);
    listSosEvents(apiClient, { status, regionId, size: PANEL_PAGE_SIZE })
      .then((page) => {
        if (!cancelled) {
          setEvents(page.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, status, regionId, attempt]);

  function handleAcknowledged(updated: AdminSosEvent) {
    setEvents(
      (current) =>
        current?.map((event) => (event.sosEventId === updated.sosEventId ? updated : event)) ??
        null,
    );
    void refreshBadge();
    onChanged();
  }

  return (
    <Section title={t('liveOps.sos.title')} className="sos-panel">
      <FilterChips
        label={t('liveOps.sos.filterLabel')}
        options={STATUS_FILTERS.map((value) => ({
          value,
          label: t(`liveOps.sos.status.${value}`),
        }))}
        isSelected={(value) => value === status}
        onSelect={setStatus}
      />
      {failed ? (
        <p className="banner banner--error" role="alert">
          {t('liveOps.sos.loadFailed')}{' '}
          <button className="btn btn--small" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t('surgeLive.retry')}
          </button>
        </p>
      ) : events === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : events.length === 0 ? (
        <p className="panel__hint">{t(`liveOps.sos.empty.${status}`)}</p>
      ) : (
        <ul className="sos-list">
          {events.map((event) => (
            <SosAlertItem
              key={event.sosEventId}
              event={event}
              language={i18n.language}
              canHandle={canHandle}
              onAcknowledged={handleAcknowledged}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function SosAlertItem({
  event,
  language,
  canHandle,
  onAcknowledged,
}: {
  event: AdminSosEvent;
  language: string;
  canHandle: boolean;
  onAcknowledged: (updated: AdminSosEvent) => void;
}) {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = event.acknowledged === null;

  async function acknowledge() {
    setBusy(true);
    setFailed(false);
    try {
      const updated = await acknowledgeSosEvent(
        apiClient,
        event.sosEventId,
        note.trim() || undefined,
      );
      onAcknowledged(updated);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={open ? 'sos-item sos-item--open' : 'sos-item'}>
      <span className="sos-item__head">
        <span className="sos-item__ref" dir="ltr">
          {rideRef(event.rideId)} · {formatSince(event.triggeredAt, language)}
        </span>
        {open ? (
          <span className="sos-item__open-chip">{t('liveOps.sos.openChip')}</span>
        ) : (
          <StatusChip tone="success">{t('liveOps.sos.acknowledgedChip')}</StatusChip>
        )}
      </span>
      <span className="sos-item__body">
        {t(
          event.triggeredByRole === 'driver'
            ? 'liveOps.sos.triggeredByDriver'
            : 'liveOps.sos.triggeredByRider',
          { name: event.triggeredBy.name },
        )}{' '}
        <Link to={`/rides/${event.rideId}`}>{t('liveOps.sos.openRide')}</Link>
      </span>
      {open ? (
        canHandle ? (
          <>
            <label className="sos-item__note">
              {t('liveOps.sos.noteLabel')}
              <input
                value={note}
                maxLength={2000}
                placeholder={t('liveOps.sos.notePlaceholder')}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {failed ? (
              <p className="banner banner--error" role="alert">
                {t('liveOps.sos.acknowledgeFailed')}
              </p>
            ) : null}
            <button
              className="btn btn--dark"
              type="button"
              disabled={busy}
              onClick={() => void acknowledge()}
            >
              {busy ? t('liveOps.sos.acknowledging') : t('liveOps.sos.acknowledge')}
            </button>
          </>
        ) : (
          <span className="panel__hint">{t('liveOps.sos.needsHandle')}</span>
        )
      ) : (
        <span className="sos-item__stamp">
          {t('liveOps.sos.stoodDownBy', {
            name: event.acknowledged!.byName,
            time: formatSince(event.acknowledged!.at, language),
          })}
          {event.acknowledged!.note ? ` · “${event.acknowledged!.note}”` : null}
        </span>
      )}
    </li>
  );
}

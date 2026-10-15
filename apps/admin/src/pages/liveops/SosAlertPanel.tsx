import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ApiError } from '../../api/client';
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
 *
 * The list stays current without remounting: it re-reads in the background
 * whenever the live feed's open-SOS set changes (`openSosKey`) and on every
 * poll of the app-wide SosAlertsProvider (its 30 s cadence, paused in a
 * hidden tab), plus on the manual Refresh. A 409 `already_acknowledged`
 * (another admin was faster) shows the server's stamp instead of a dead end.
 */
export function SosAlertPanel({
  regionId,
  openSosKey,
  onChanged,
}: {
  /** Narrows the list to the selected region; undefined = all regions. */
  regionId?: string;
  /** The live feed's open SOS ids (any stable string); a change re-reads the list. */
  openSosKey?: string;
  /** Fired after an acknowledgement — ours or a conflicting one (refresh pins/banner). */
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const { openEvents: badgeEvents, refresh: refreshBadge } = useSosAlerts();
  const canHandle = can('support:handle');

  const [status, setStatus] = useState<SosStatusFilter>('open');
  const [events, setEvents] = useState<AdminSosEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** Background re-reads: they keep the current list on screen while loading. */
  const [tick, setTick] = useState(0);
  const [conflictNotice, setConflictNotice] = useState(false);
  /**
   * Alerts stood down from this panel (by us, or the 409 winner's stamp):
   * they stay visible with their stamp across background re-reads, until
   * the filter changes or Refresh is pressed.
   */
  const [stoodDown, setStoodDown] = useState<Record<string, AdminSosEvent>>({});
  const generation = useRef(0);
  const query = `${status}|${regionId ?? ''}`;
  const shownQuery = useRef<string | null>(null);

  useEffect(() => {
    const mine = ++generation.current;
    const background = shownQuery.current === query;
    if (!background) {
      setEvents(null);
      setFailed(false);
      setConflictNotice(false);
      setStoodDown({});
    }
    listSosEvents(apiClient, { status, regionId, size: PANEL_PAGE_SIZE })
      .then((page) => {
        if (mine === generation.current) {
          shownQuery.current = query;
          setFailed(false);
          setEvents(page.items);
        }
      })
      .catch(() => {
        // A failed background re-read keeps the list; a first read shows the error.
        if (mine === generation.current && !background) {
          setFailed(true);
        }
      });
  }, [apiClient, status, regionId, query, attempt, tick]);

  // Re-read when the feed's open set changes or the badge poll lands (not on mount).
  const reread = useRef(false);
  useEffect(() => {
    if (!reread.current) {
      reread.current = true;
      return;
    }
    setTick((n) => n + 1);
  }, [openSosKey, badgeEvents]);

  function replace(updated: AdminSosEvent) {
    setStoodDown((current) => ({ ...current, [updated.sosEventId]: updated }));
  }

  const shown = events === null ? null : withStoodDown(events, stoodDown);

  function handleAcknowledged(updated: AdminSosEvent) {
    replace(updated);
    setConflictNotice(false);
    void refreshBadge();
    onChanged();
  }

  async function handleConflict(event: AdminSosEvent) {
    setConflictNotice(true);
    void refreshBadge();
    onChanged();
    try {
      // Show who stood it down: the event's current state from the full list.
      const page = await listSosEvents(apiClient, {
        status: 'acknowledged',
        regionId: event.regionId,
        size: PANEL_PAGE_SIZE,
      });
      const current = page.items.find((item) => item.sosEventId === event.sosEventId);
      if (current) {
        replace(current);
        return;
      }
    } catch {
      // Fall through to a plain re-read.
    }
    setTick((n) => n + 1);
  }

  return (
    <Section
      title={t('liveOps.sos.title')}
      className="sos-panel"
      actions={
        <button
          className="btn btn--small"
          type="button"
          onClick={() => {
            setConflictNotice(false);
            setStoodDown({});
            setTick((n) => n + 1);
          }}
        >
          {t('liveOps.sos.refresh')}
        </button>
      }
    >
      <FilterChips
        label={t('liveOps.sos.filterLabel')}
        options={STATUS_FILTERS.map((value) => ({
          value,
          label: t(`liveOps.sos.status.${value}`),
        }))}
        isSelected={(value) => value === status}
        onSelect={setStatus}
      />
      {conflictNotice ? (
        <p className="banner banner--info" role="status">
          {t('liveOps.sos.alreadyAcknowledged')}
        </p>
      ) : null}
      {failed ? (
        <p className="banner banner--error" role="alert">
          {t('liveOps.sos.loadFailed')}{' '}
          <button className="btn btn--small" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t('surgeLive.retry')}
          </button>
        </p>
      ) : shown === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : shown.length === 0 ? (
        <p className="panel__hint">{t(`liveOps.sos.empty.${status}`)}</p>
      ) : (
        <ul className="sos-list">
          {shown.map((event) => (
            <SosAlertItem
              key={event.sosEventId}
              event={event}
              language={i18n.language}
              canHandle={canHandle}
              onAcknowledged={handleAcknowledged}
              onConflict={(conflicting) => void handleConflict(conflicting)}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The listed alerts with the locally stood-down ones laid over, newest first. */
function withStoodDown(
  events: readonly AdminSosEvent[],
  stoodDown: Readonly<Record<string, AdminSosEvent>>,
): AdminSosEvent[] {
  const listed = new Set(events.map((event) => event.sosEventId));
  const merged = events.map((event) => stoodDown[event.sosEventId] ?? event);
  const dropped = Object.values(stoodDown).filter((event) => !listed.has(event.sosEventId));
  if (dropped.length === 0) {
    return merged; // The server's order as is.
  }
  return [...merged, ...dropped].sort(
    (a, b) => Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt),
  );
}

function SosAlertItem({
  event,
  language,
  canHandle,
  onAcknowledged,
  onConflict,
}: {
  event: AdminSosEvent;
  language: string;
  canHandle: boolean;
  onAcknowledged: (updated: AdminSosEvent) => void;
  /** 409 `already_acknowledged`: another admin stood it down first. */
  onConflict: (event: AdminSosEvent) => void;
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
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        onConflict(event);
      } else {
        setFailed(true);
      }
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

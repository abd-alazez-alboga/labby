import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getNotificationPreferences,
  NOTIFICATION_CATEGORIES,
  updateNotificationPreferences,
  type NotificationPreference,
  type PreferenceChange,
} from '../api/notifications';
import { useAuth } from '../auth/AuthContext';
import { NOTIFICATION_CENTER_PATH } from '../notifications/deep-links';
import { usePush, type PushStatus } from '../push/PushProvider';
import { useToast } from '../toast/ToastProvider';
import { BackLink, PageHeader, StatusChip } from '../ui';
import { classifyError, type FailureKind } from './onboarding/review-utils';

/** Server order is not guaranteed — show the six categories in the canonical order. */
function sortPreferences(list: NotificationPreference[]): NotificationPreference[] {
  return [...list].sort(
    (a, b) =>
      NOTIFICATION_CATEGORIES.indexOf(a.category) - NOTIFICATION_CATEGORIES.indexOf(b.category),
  );
}

/**
 * UC-S-12 / NTF-02: per-category PUSH preferences. Muting stops the push
 * only — the center keeps recording (UC-S-25 A1). `ride` and `safety` come
 * back `locked` and render as always-on, never as a toggle (UC-S-12 E1).
 * Save sends only the categories that changed (the PUT is partial).
 * Preferences belong to the account, so they apply in every Labby app.
 */
export default function NotificationPreferencesPage() {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const { show } = useToast();

  const [saved, setSaved] = useState<NotificationPreference[] | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<FailureKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSaved(null);
    setLoadError(null);
    getNotificationPreferences(apiClient)
      .then((list) => {
        if (cancelled) return;
        const sorted = sortPreferences(list);
        setSaved(sorted);
        setDraft(Object.fromEntries(sorted.map((pref) => [pref.category, pref.enabled])));
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(classifyError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, attempt]);

  const changes = useMemo<PreferenceChange[]>(
    () =>
      (saved ?? [])
        .filter((pref) => !pref.locked && draft[pref.category] !== pref.enabled)
        .map((pref) => ({ category: pref.category, enabled: draft[pref.category] })),
    [saved, draft],
  );

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changes.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = sortPreferences(await updateNotificationPreferences(apiClient, changes));
      setSaved(updated);
      setDraft(Object.fromEntries(updated.map((pref) => [pref.category, pref.enabled])));
      show({ tone: 'success', message: t('notificationPrefs.saved') });
    } catch (error) {
      setSaveError(classifyError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page">
      <BackLink to={NOTIFICATION_CENTER_PATH}>{t('notificationPrefs.back')}</BackLink>
      <PageHeader
        title={t('notificationPrefs.title')}
        description={t('notificationPrefs.subtitle')}
      />

      <BrowserPushCard />

      {loadError ? (
        <div className="banner banner--error" role="alert">
          <span>
            {t(
              loadError === 'network'
                ? 'notifications.errors.network'
                : 'notifications.errors.server',
            )}
          </span>{' '}
          <button className="btn btn--small" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t('notifications.retry')}
          </button>
        </div>
      ) : saved === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <form className="card panel" onSubmit={(event) => void handleSave(event)}>
          <h2 className="panel__title">{t('notificationPrefs.categoriesTitle')}</h2>
          <p className="panel__hint">{t('notificationPrefs.centerHint')}</p>
          <ul className="pref-list">
            {saved.map((pref) => {
              const id = `pref-${pref.category}`;
              return (
                <li key={pref.category} className="pref-list__item">
                  <span className="pref-list__text">
                    <label htmlFor={id} className="pref-list__label">
                      {t(`notifications.category.${pref.category}`)}
                    </label>
                    <span className="pref-list__hint" id={`${id}-hint`}>
                      {pref.locked
                        ? t('notificationPrefs.lockedHint')
                        : t(`notificationPrefs.categoryHint.${pref.category}`)}
                    </span>
                  </span>
                  {pref.locked ? (
                    <span className="pref-list__control">
                      <input
                        id={id}
                        type="checkbox"
                        checked
                        disabled
                        aria-describedby={`${id}-hint`}
                      />
                      <StatusChip tone="accent">{t('notificationPrefs.alwaysOn')}</StatusChip>
                    </span>
                  ) : (
                    <span className="pref-list__control">
                      <input
                        id={id}
                        type="checkbox"
                        checked={draft[pref.category] ?? pref.enabled}
                        disabled={saving}
                        aria-describedby={`${id}-hint`}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [pref.category]: event.target.checked,
                          }))
                        }
                      />
                      <span className="pref-list__state" aria-hidden="true">
                        {(draft[pref.category] ?? pref.enabled)
                          ? t('notificationPrefs.on')
                          : t('notificationPrefs.off')}
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {saveError ? (
            <div className="banner banner--error" role="alert">
              {t(
                saveError === 'network'
                  ? 'notifications.errors.network'
                  : saveError === 'validation'
                    ? 'notificationPrefs.errors.validation'
                    : 'notifications.errors.server',
              )}
            </div>
          ) : null}
          <div className="panel__row">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={saving || changes.length === 0}
            >
              {saving ? t('notificationPrefs.saving') : t('notificationPrefs.save')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={saving || changes.length === 0}
              onClick={() =>
                setDraft(Object.fromEntries(saved.map((pref) => [pref.category, pref.enabled])))
              }
            >
              {t('notificationPrefs.discard')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const PUSH_STATUS_KEY: Record<Exclude<PushStatus, 'unconfigured'>, string> = {
  unsupported: 'push.status.unsupported',
  prompt: 'push.status.prompt',
  denied: 'push.status.denied',
  registering: 'push.status.registering',
  registered: 'push.status.registered',
  failed: 'push.status.failed',
};

/**
 * This browser's push state. Hidden entirely until the owner's Firebase
 * web config is deployed (M6-T5) — an unconfigured push is not an error.
 */
function BrowserPushCard() {
  const { t } = useTranslation();
  const { status, enable } = usePush();
  const [working, setWorking] = useState(false);

  if (status === 'unconfigured') {
    return null;
  }

  async function handleEnable() {
    setWorking(true);
    try {
      await enable();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card panel">
      <h2 className="panel__title">{t('push.title')}</h2>
      <p className="panel__hint" role="status">
        {t(PUSH_STATUS_KEY[status])}
      </p>
      {status === 'prompt' || status === 'failed' ? (
        <div className="panel__row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={working}
            onClick={() => void handleEnable()}
          >
            {status === 'failed' ? t('push.retry') : t('push.enable')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

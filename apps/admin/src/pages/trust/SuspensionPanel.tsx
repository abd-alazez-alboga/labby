import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { applySuspensionAction, type AdminUserTrust, type SuspensionAction } from '../../api/trust';
import { useAuth } from '../../auth/AuthContext';
import { ConfirmRow } from '../onboarding/ReviewUi';
import { availableActions, suspensionErrorKey } from './trust-format';

/** Stable id of an action, for selection + keys. */
function actionId(action: SuspensionAction): string {
  return 'role' in action ? `${action.kind}:${action.role}` : action.kind;
}

/**
 * UC-A-14 side panel (`users:suspend` — the page gates): the leading action
 * (a reactivation when one applies) as the form, every other action one
 * click away. Each takes a mandatory reason that is stored, audit-logged and
 * SHOWN TO THE USER; suspending the whole account asks for confirmation.
 */
export function SuspensionPanel({
  trust,
  onUpdated,
  onFailed,
}: {
  trust: AdminUserTrust;
  onUpdated: (trust: AdminUserTrust, action: SuspensionAction) => void;
  /** A refused action (409 etc.): the page shows the copy and reloads. */
  onFailed: (errorKey: string) => void;
}) {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const actions = availableActions(trust);
  const leading = actions.find(
    (action) => action.kind === 'reactivateAccount' || action.kind === 'reactivateRole',
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const selected = actions.find((action) => actionId(action) === selectedId) ?? leading ?? null;
  const others = actions.filter((action) => action !== selected);

  function label(action: SuspensionAction): string {
    return 'role' in action
      ? t(`trust.actions.${action.kind}`, { role: t(`trust.role.${action.role}`) })
      : t(`trust.actions.${action.kind}`);
  }

  function select(action: SuspensionAction) {
    setSelectedId(actionId(action));
    setConfirming(false);
    setErrorKey(null);
  }

  async function run(action: SuspensionAction) {
    setBusy(true);
    try {
      const updated = await applySuspensionAction(apiClient, trust.userId, action, note.trim());
      setNote('');
      setSelectedId(null);
      setConfirming(false);
      onUpdated(updated, action);
    } catch (error) {
      setConfirming(false);
      onFailed(suspensionErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    if (note.trim() === '') {
      setErrorKey('trust.panel.reasonRequired');
      return;
    }
    setErrorKey(null);
    if (selected.kind === 'suspendAccount') {
      setConfirming(true);
      return;
    }
    void run(selected);
  }

  if (actions.length === 0) {
    return null;
  }

  const destructive = selected?.kind === 'suspendRole' || selected?.kind === 'suspendAccount';

  return (
    <div className="review-layout__aside trust-aside">
      {selected ? (
        <section className="decision-panel" aria-label={label(selected)}>
          <h2 className="decision-panel__title">{label(selected)}</h2>
          <form className="decision-panel__actions" onSubmit={submit} noValidate>
            <div className="form-field">
              <label htmlFor="suspension-note">{t('trust.panel.reasonLabel')}</label>
              <textarea
                id="suspension-note"
                rows={3}
                maxLength={500}
                value={note}
                disabled={busy || confirming}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {errorKey ? (
              <p className="banner banner--error" role="alert">
                {t(errorKey)}
              </p>
            ) : null}
            {confirming ? (
              <ConfirmRow
                text={t('trust.panel.confirmAccount', { name: trust.name })}
                confirmLabel={t('trust.panel.confirmAccountButton')}
                busy={busy}
                destructive
                onConfirm={() => void run(selected)}
                onCancel={() => setConfirming(false)}
              />
            ) : (
              <button
                className={`btn btn--lg btn--block ${destructive ? 'btn--danger' : 'btn--primary'}`}
                type="submit"
                disabled={busy}
              >
                {busy ? t('review.working') : label(selected)}
              </button>
            )}
            <p className="panel__hint">{t('trust.panel.notified')}</p>
          </form>
        </section>
      ) : null}
      {others.length > 0 ? (
        <section className="decision-panel" aria-label={t('trust.panel.otherActions')}>
          <h2 className="decision-panel__subtitle">{t('trust.panel.otherActions')}</h2>
          <div className="decision-panel__actions">
            {others.map((action) => (
              <button
                key={actionId(action)}
                type="button"
                className={action.kind === 'suspendAccount' ? 'btn btn--danger-outline' : 'btn'}
                onClick={() => select(action)}
              >
                {t('trust.panel.more', { action: label(action) })}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

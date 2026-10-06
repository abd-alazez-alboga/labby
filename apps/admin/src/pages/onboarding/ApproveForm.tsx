import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { listAssignableServiceTypes, type ServiceTypeRef } from '../../api/onboarding';
import { useAuth } from '../../auth/AuthContext';
import { ConfirmRow, LoadFailure } from './ReviewUi';
import { classifyError, serviceTypeName, type FailureKind } from './review-utils';

/**
 * Approval with service-type assignment (DRV-03): the reviewer picks at
 * least one type from `/admin/assignable-service-types` (enabled types of
 * active regions — no `pricing:view` needed), then confirms the
 * irreversible decision. Nothing is preselected.
 */
export function ApproveForm({
  idPrefix,
  hint,
  confirmText,
  warning,
  busy,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  hint: string;
  confirmText: string;
  /** Non-blocking caution shown above the picker (e.g. an expired document). */
  warning?: string | null;
  busy: boolean;
  onSubmit: (serviceTypeIds: string[]) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const [types, setTypes] = useState<ServiceTypeRef[] | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    listAssignableServiceTypes(apiClient)
      .then((list) => {
        if (!cancelled) {
          setTypes(list);
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
  }, [apiClient, attempt]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  // Keep the request in list order (region-then-name), not click order.
  const orderedSelection = (types ?? [])
    .map((type) => type.id)
    .filter((id) => selected.includes(id));

  return (
    <div className="card panel">
      <h3 className="panel__title">{t('review.approve.title')}</h3>
      <p className="panel__hint">{hint}</p>
      {warning ? (
        <p className="banner banner--error" role="alert">
          {warning}
        </p>
      ) : null}

      {loadError ? (
        <LoadFailure
          kind={loadError}
          notFoundKey="review.errors.server"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : types === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : types.length === 0 ? (
        <p className="banner banner--info">{t('review.approve.noServiceTypes')}</p>
      ) : (
        <fieldset className="checklist" disabled={busy || confirming}>
          <legend>{t('review.approve.serviceTypesLegend')}</legend>
          {types.map((type) => (
            <label key={type.id} className="checklist__item" htmlFor={`${idPrefix}-st-${type.id}`}>
              <input
                id={`${idPrefix}-st-${type.id}`}
                type="checkbox"
                checked={selected.includes(type.id)}
                onChange={() => toggle(type.id)}
              />
              <span>
                {serviceTypeName(type, i18n.language)}{' '}
                <span className="checklist__region">({type.regionName})</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {confirming ? (
        <ConfirmRow
          text={confirmText}
          confirmLabel={t('review.approve.confirm')}
          busy={busy}
          onConfirm={() => onSubmit(orderedSelection)}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <div className="panel__row">
          <button
            className="btn btn--primary"
            type="button"
            disabled={orderedSelection.length === 0}
            onClick={() => setConfirming(true)}
          >
            {t('review.approve.submit')}
          </button>
          <button className="btn" type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          {types && types.length > 0 && orderedSelection.length === 0 ? (
            <span className="panel__hint">{t('review.approve.pickOne')}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

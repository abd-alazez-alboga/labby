import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../api/client';
import { activateRegion, type Region, type ServiceType } from '../../api/regions';
import { useAuth } from '../../auth/AuthContext';
import { isComplete, regionChecklist } from './completeness';
import { regionConflictMessage, type UiMessage } from './region-errors';

/**
 * UC-A-05 step 5: the activation flow. The checklist mirrors the
 * contract's mandatory list from the region as the server LAST SAVED it
 * (unsaved form edits do not count), and the Activate button only arms
 * when every item is done — but the server's completeness check is the
 * truth, so a 409 is surfaced honestly rather than second-guessed.
 */
export function ActivationCard({
  region,
  serviceTypes,
  canEdit,
  onActivated,
}: {
  region: Region;
  serviceTypes: ServiceType[] | null;
  canEdit: boolean;
  onActivated: (region: Region) => void;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();

  const [error, setError] = useState<UiMessage | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const items = regionChecklist(region, serviceTypes);
  const complete = isComplete(items);

  async function handleActivate() {
    setError(null);
    setSubmitting(true);
    try {
      const activated = await activateRegion(apiClient, region.id);
      onActivated(activated);
    } catch (caught) {
      // 409 `region_incomplete` lists the missing parts (W37); other 409s stay generic.
      setError(
        regionConflictMessage(caught, t, i18n.language) ??
          (caught instanceof ApiError && caught.status === 409
            ? { key: 'regionDetail.activation.errors.incomplete' }
            : { key: 'regionDetail.activation.errors.generic' }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card panel">
      <h2 className="panel__title">{t('regionDetail.activation.title')}</h2>

      {region.state === 'active' ? (
        <p className="banner banner--info" role="status">
          {t('regionDetail.activation.activeNotice')}
        </p>
      ) : (
        <>
          <p className="panel__hint">{t('regionDetail.activation.draftHint')}</p>
          {/* ADM-01 / UC-A-05 step 5 (ASM-04): the new-region map-extract ops step. */}
          <p className="banner banner--info">{t('regionDetail.activation.mapExtractHint')}</p>
        </>
      )}

      {error ? (
        <p className="banner banner--error" role="alert">
          {t(error.key, error.values)}
        </p>
      ) : null}

      <ul className="checklist-status">
        {items.map((item) => (
          <li
            key={item.key}
            className={
              item.done
                ? 'checklist-status__item'
                : 'checklist-status__item checklist-status__item--missing'
            }
          >
            <span aria-hidden="true">{item.done ? '✓' : '•'}</span>
            <span>{t(`regionDetail.activation.items.${item.key}`)}</span>
            <span className="checklist-status__state">
              {item.done ? t('regionDetail.activation.done') : t('regionDetail.activation.missing')}
            </span>
          </li>
        ))}
      </ul>

      {canEdit && region.state === 'draft' ? (
        <div className="panel__row">
          <button
            className="btn btn--primary"
            type="button"
            disabled={!complete || submitting}
            onClick={() => void handleActivate()}
          >
            {submitting
              ? t('regionDetail.activation.activating')
              : t('regionDetail.activation.activate')}
          </button>
          {!complete ? (
            <span className="panel__hint">{t('regionDetail.activation.incompleteHint')}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

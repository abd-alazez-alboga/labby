import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DOCUMENT_TYPES,
  type ChangeRequestItem,
  type DocumentType,
  type RequestChangesRequest,
  type ReviewItemKind,
} from '../../api/onboarding';

interface ItemSlot {
  key: string;
  item: ReviewItemKind;
  documentType?: DocumentType;
}

/** The reviewable items of an application, in display order (DRV-02 per-item review). */
const SLOTS: ItemSlot[] = [
  { key: 'personal', item: 'personal' },
  ...DOCUMENT_TYPES.map((type) => ({ key: type, item: 'document' as const, documentType: type })),
  { key: 'vehicle', item: 'vehicle' },
];

/**
 * UC-A-10 "request changes": flag any of the six items, each with its own
 * note (the applicant resubmits exactly the flagged ones), plus an optional
 * overall note for the stage history.
 */
export function RequestChangesForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (body: RequestChangesRequest) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState('');

  const chosen = SLOTS.filter((slot) => flagged[slot.key]);
  const missingNote = chosen.some((slot) => !(notes[slot.key] ?? '').trim());
  const ready = chosen.length > 0 && !missingNote;

  function label(slot: ItemSlot): string {
    return slot.item === 'document'
      ? t(`review.documentType.${slot.documentType}`)
      : t(`review.items.${slot.item}`);
  }

  function handleSubmit() {
    const items: ChangeRequestItem[] = chosen.map((slot) => ({
      item: slot.item,
      ...(slot.documentType ? { documentType: slot.documentType } : {}),
      note: (notes[slot.key] ?? '').trim(),
    }));
    const note = overall.trim();
    onSubmit(note ? { items, note } : { items });
  }

  return (
    <div className="card panel">
      <h3 className="panel__title">{t('review.changes.title')}</h3>
      <p className="panel__hint">{t('review.changes.hint')}</p>
      <fieldset className="change-items" disabled={busy}>
        <legend>{t('review.changes.itemsLegend')}</legend>
        {SLOTS.map((slot) => (
          <div key={slot.key} className="change-items__item">
            <label className="checklist__item" htmlFor={`changes-flag-${slot.key}`}>
              <input
                id={`changes-flag-${slot.key}`}
                type="checkbox"
                checked={Boolean(flagged[slot.key])}
                onChange={(event) =>
                  setFlagged((current) => ({ ...current, [slot.key]: event.target.checked }))
                }
              />
              <span>{t('review.changes.flag', { item: label(slot) })}</span>
            </label>
            {flagged[slot.key] ? (
              <div className="form-field">
                <label htmlFor={`changes-note-${slot.key}`}>
                  {t('review.changes.noteFor', { item: label(slot) })}
                </label>
                <textarea
                  id={`changes-note-${slot.key}`}
                  rows={2}
                  maxLength={1000}
                  value={notes[slot.key] ?? ''}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [slot.key]: event.target.value }))
                  }
                />
              </div>
            ) : null}
          </div>
        ))}
      </fieldset>
      <div className="form-field">
        <label htmlFor="changes-overall">{t('review.changes.overallLabel')}</label>
        <textarea
          id="changes-overall"
          rows={2}
          maxLength={1000}
          value={overall}
          disabled={busy}
          onChange={(event) => setOverall(event.target.value)}
        />
      </div>
      <div className="panel__row">
        <button
          className="btn btn--primary"
          type="button"
          disabled={!ready || busy}
          onClick={handleSubmit}
        >
          {busy ? t('review.working') : t('review.changes.submit')}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
        {!ready ? (
          <span className="panel__hint">
            {chosen.length === 0 ? t('review.changes.pickOne') : t('review.changes.noteRequired')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

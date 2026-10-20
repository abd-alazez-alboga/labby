import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../api/client';
import {
  createSurchargeWindow,
  deleteSurchargeWindow,
  updateSurchargeWindow,
  type SurchargeWindow,
  type SurchargeWindowUpsertRequest,
} from '../../api/regions';
import { useAuth } from '../../auth/AuthContext';
import { ISO_DAYS, toContractTime, toTimeInput } from './timeWindows';

type EditorState =
  { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; item: SurchargeWindow };

function mapWindowError(error: unknown): string {
  if (error instanceof ApiError && error.status === 400) {
    return 'surcharges.errors.validation';
  }
  return 'surcharges.errors.generic';
}

/**
 * PRC-01 time-window surcharges (UC-A-05 step 3): list, add, edit and
 * delete windows with label, region-local start/end time, ISO days of
 * week (1 = Monday … 7 = Sunday) and percent. Viewing needs pricing:view
 * (the section is hidden without it); mutations additionally need
 * pricing:edit.
 */
export function SurchargeWindowsSection({
  regionId,
  items,
  canEdit,
  onChange,
}: {
  regionId: string;
  items: SurchargeWindow[];
  canEdit: boolean;
  onChange: (items: SurchargeWindow[]) => void;
}) {
  const { t } = useTranslation();
  const { apiClient } = useAuth();

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [label, setLabel] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [days, setDays] = useState<ReadonlySet<number>>(new Set());
  const [percent, setPercent] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  function dayLabel(day: number): string {
    return t(`surcharges.days.d${day}`);
  }

  function openEditor(next: EditorState) {
    setEditor(next);
    setEditorError(null);
    if (next.mode === 'create') {
      setLabel('');
      setStartsAt('');
      setEndsAt('');
      setDays(new Set());
      setPercent('');
    } else if (next.mode === 'edit') {
      setLabel(next.item.label);
      setStartsAt(toTimeInput(next.item.startsAt));
      setEndsAt(toTimeInput(next.item.endsAt));
      setDays(new Set(next.item.daysOfWeek));
      setPercent(String(next.item.percent));
    }
  }

  function toggleDay(day: number) {
    setDays((current) => {
      const next = new Set(current);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor.mode === 'closed') {
      return;
    }
    if (days.size === 0) {
      setEditorError('surcharges.errors.noDays');
      return;
    }
    setSubmitting(true);
    setEditorError(null);
    const body: SurchargeWindowUpsertRequest = {
      label: label.trim(),
      startsAt: toContractTime(startsAt),
      endsAt: toContractTime(endsAt),
      daysOfWeek: ISO_DAYS.filter((day) => days.has(day)),
      percent: Number(percent),
    };
    try {
      if (editor.mode === 'create') {
        const created = await createSurchargeWindow(apiClient, regionId, body);
        onChange([...items, created]);
      } else {
        const updated = await updateSurchargeWindow(apiClient, editor.item.id, body);
        onChange(items.map((item) => (item.id === updated.id ? updated : item)));
      }
      setEditor({ mode: 'closed' });
    } catch (error) {
      setEditorError(mapWindowError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: SurchargeWindow) {
    setConfirmingDeleteId(null);
    setPageError(null);
    try {
      await deleteSurchargeWindow(apiClient, item.id);
      onChange(items.filter((current) => current.id !== item.id));
      if (editor.mode === 'edit' && editor.item.id === item.id) {
        setEditor({ mode: 'closed' });
      }
    } catch (error) {
      setPageError(mapWindowError(error));
    }
  }

  return (
    <section className="card panel">
      <h2 className="panel__title">{t('surcharges.title')}</h2>

      {pageError ? (
        <p className="banner banner--error" role="alert">
          {t(pageError)}
        </p>
      ) : null}

      {canEdit ? (
        <p>
          <button className="btn" type="button" onClick={() => openEditor({ mode: 'create' })}>
            {t('surcharges.add')}
          </button>
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="banner banner--info">{t('surcharges.empty')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('surcharges.columns.label')}</th>
              <th>{t('surcharges.columns.time')}</th>
              <th>{t('surcharges.columns.days')}</th>
              <th>{t('surcharges.columns.percent')}</th>
              {canEdit ? <th>{t('surcharges.columns.actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.label}</td>
                <td dir="ltr">
                  {toTimeInput(item.startsAt)}–{toTimeInput(item.endsAt)}
                </td>
                <td>
                  {ISO_DAYS.filter((day) => item.daysOfWeek.includes(day))
                    .map((day) => dayLabel(day))
                    .join(', ')}
                </td>
                <td dir="ltr">+{item.percent}%</td>
                {canEdit ? (
                  <td>
                    <span className="table__actions">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => openEditor({ mode: 'edit', item })}
                      >
                        {t('surcharges.edit')}
                      </button>
                      {confirmingDeleteId === item.id ? (
                        <span className="table__confirm">
                          {t('surcharges.deleteConfirm')}
                          <button
                            className="btn btn--danger"
                            type="button"
                            onClick={() => void handleDelete(item)}
                          >
                            {t('common.confirm')}
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                          >
                            {t('common.cancel')}
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setConfirmingDeleteId(item.id)}
                        >
                          {t('surcharges.delete')}
                        </button>
                      )}
                    </span>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editor.mode !== 'closed' ? (
        <form className="panel" onSubmit={(event) => void handleSave(event)}>
          <h3 className="panel__title">
            {editor.mode === 'create'
              ? t('surcharges.createTitle')
              : t('surcharges.editTitle', { label: editor.item.label })}
          </h3>
          {editorError ? (
            <p className="banner banner--error" role="alert">
              {t(editorError)}
            </p>
          ) : null}
          <div className="panel__row">
            <div className="form-field">
              <label htmlFor="surcharge-label">{t('surcharges.fields.label')}</label>
              <input
                id="surcharge-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={50}
                required
                disabled={submitting}
              />
            </div>
            <div className="form-field">
              <label htmlFor="surcharge-starts">{t('surcharges.fields.startsAt')}</label>
              <input
                id="surcharge-starts"
                type="time"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="form-field">
              <label htmlFor="surcharge-ends">{t('surcharges.fields.endsAt')}</label>
              <input
                id="surcharge-ends"
                type="time"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="form-field">
              <label htmlFor="surcharge-percent">{t('surcharges.fields.percent')}</label>
              <input
                id="surcharge-percent"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
                required
                disabled={submitting}
              />
            </div>
          </div>
          <fieldset className="checklist" disabled={submitting}>
            <legend>{t('surcharges.fields.daysOfWeek')}</legend>
            {ISO_DAYS.map((day) => (
              <label key={day} className="checklist__item">
                <input type="checkbox" checked={days.has(day)} onChange={() => toggleDay(day)} />
                <span>{dayLabel(day)}</span>
              </label>
            ))}
          </fieldset>
          <div className="panel__row">
            <button className="btn btn--primary" type="submit" disabled={submitting}>
              {submitting ? t('surcharges.saving') : t('surcharges.save')}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setEditor({ mode: 'closed' })}
              disabled={submitting}
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

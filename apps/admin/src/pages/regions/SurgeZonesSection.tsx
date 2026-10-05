import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../api/client';
import {
  createSurgeZone,
  deleteSurgeZone,
  updateSurgeZone,
  type GeoJsonPolygon,
  type SurgeZone,
  type SurgeZoneUpsertRequest,
} from '../../api/regions';
import { useAuth } from '../../auth/AuthContext';
import { PolygonMapEditor, type MapOverlay } from './PolygonMapEditor';

interface StepRow {
  ratio: string;
  multiplier: string;
}

type EditorState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; item: SurgeZone };

function mapZoneError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'surgeZones.errors.conflict';
    }
    if (error.status === 400) {
      return 'surgeZones.errors.validation';
    }
  }
  return 'surgeZones.errors.generic';
}

/**
 * UC-A-08: surge zones drawn on the region map, each with its demand/supply
 * threshold steps (PRC-02) and an optional per-zone multiplier cap. The
 * polygon must lie within the region boundary — the backend's 409 is
 * surfaced as the conflict message. Multipliers are computed in M9; the
 * override column only displays state set there (UC-A-09). Viewing needs
 * pricing:view; mutations additionally need pricing:edit.
 */
export function SurgeZonesSection({
  regionId,
  boundary,
  items,
  canEdit,
  onChange,
}: {
  regionId: string;
  boundary: GeoJsonPolygon | null;
  items: SurgeZone[];
  canEdit: boolean;
  onChange: (items: SurgeZone[]) => void;
}) {
  const { t } = useTranslation();
  const { apiClient } = useAuth();

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [name, setName] = useState('');
  const [polygon, setPolygon] = useState<GeoJsonPolygon | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [multiplierCap, setMultiplierCap] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  function openEditor(next: EditorState) {
    setEditor(next);
    setEditorError(null);
    if (next.mode === 'create') {
      setName('');
      setPolygon(null);
      setSteps([{ ratio: '', multiplier: '' }]);
      setMultiplierCap('');
    } else if (next.mode === 'edit') {
      setName(next.item.name);
      setPolygon(next.item.polygon);
      setSteps(
        next.item.thresholdSteps.map((step) => ({
          ratio: String(step.ratio),
          multiplier: String(step.multiplier),
        })),
      );
      setMultiplierCap(next.item.multiplierCap == null ? '' : String(next.item.multiplierCap));
    }
  }

  function updateStep(index: number, patch: Partial<StepRow>) {
    setSteps((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /** The boundary plus every OTHER zone, as dashed context under the editable polygon. */
  function editorOverlays(): MapOverlay[] {
    const overlays: MapOverlay[] = [];
    if (boundary) {
      overlays.push({ id: 'boundary', polygon: boundary });
    }
    for (const zone of items) {
      if (editor.mode === 'edit' && editor.item.id === zone.id) {
        continue;
      }
      overlays.push({ id: zone.id, polygon: zone.polygon });
    }
    return overlays;
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor.mode === 'closed') {
      return;
    }
    if (!polygon) {
      setEditorError('surgeZones.errors.noPolygon');
      return;
    }
    const parsedSteps = steps.filter(
      (row) => row.ratio.trim() !== '' && row.multiplier.trim() !== '',
    );
    if (parsedSteps.length === 0 || parsedSteps.length !== steps.length) {
      setEditorError('surgeZones.errors.incompleteSteps');
      return;
    }
    setSubmitting(true);
    setEditorError(null);
    const body: SurgeZoneUpsertRequest = {
      name: name.trim(),
      polygon,
      thresholdSteps: parsedSteps.map((row) => ({
        ratio: Number(row.ratio),
        multiplier: Number(row.multiplier),
      })),
      multiplierCap: multiplierCap.trim() === '' ? null : Number(multiplierCap),
    };
    try {
      if (editor.mode === 'create') {
        const created = await createSurgeZone(apiClient, regionId, body);
        onChange([...items, created]);
      } else {
        const updated = await updateSurgeZone(apiClient, editor.item.id, body);
        onChange(items.map((item) => (item.id === updated.id ? updated : item)));
      }
      setEditor({ mode: 'closed' });
    } catch (error) {
      setEditorError(mapZoneError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: SurgeZone) {
    setConfirmingDeleteId(null);
    setPageError(null);
    try {
      await deleteSurgeZone(apiClient, item.id);
      onChange(items.filter((current) => current.id !== item.id));
      if (editor.mode === 'edit' && editor.item.id === item.id) {
        setEditor({ mode: 'closed' });
      }
    } catch (error) {
      setPageError(mapZoneError(error));
    }
  }

  return (
    <section className="card panel">
      <h2 className="panel__title">{t('surgeZones.title')}</h2>
      <p className="panel__hint">{t('surgeZones.hint')}</p>

      {pageError ? (
        <p className="banner banner--error" role="alert">
          {t(pageError)}
        </p>
      ) : null}

      {canEdit ? (
        <p>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => openEditor({ mode: 'create' })}
          >
            {t('surgeZones.add')}
          </button>
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="banner banner--info">{t('surgeZones.empty')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('surgeZones.columns.name')}</th>
              <th>{t('surgeZones.columns.steps')}</th>
              <th>{t('surgeZones.columns.cap')}</th>
              <th>{t('surgeZones.columns.override')}</th>
              {canEdit ? <th>{t('surgeZones.columns.actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.thresholdSteps.length}</td>
                <td dir="ltr">{item.multiplierCap == null ? '—' : `${item.multiplierCap}×`}</td>
                <td dir="ltr">
                  {item.overrideMultiplier == null
                    ? t('surgeZones.overrideAuto')
                    : `${item.overrideMultiplier}×`}
                </td>
                {canEdit ? (
                  <td>
                    <span className="table__actions">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => openEditor({ mode: 'edit', item })}
                      >
                        {t('surgeZones.edit')}
                      </button>
                      {confirmingDeleteId === item.id ? (
                        <span className="table__confirm">
                          {t('surgeZones.deleteConfirm')}
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
                          {t('surgeZones.delete')}
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
              ? t('surgeZones.createTitle')
              : t('surgeZones.editTitle', { name: editor.item.name })}
          </h3>
          {editorError ? (
            <p className="banner banner--error" role="alert">
              {t(editorError)}
            </p>
          ) : null}

          <div className="panel__row">
            <div className="form-field">
              <label htmlFor="surge-zone-name">{t('surgeZones.fields.name')}</label>
              <input
                id="surge-zone-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
                disabled={submitting}
              />
            </div>
            <div className="form-field">
              <label htmlFor="surge-zone-cap">{t('surgeZones.fields.multiplierCap')}</label>
              <input
                id="surge-zone-cap"
                type="number"
                inputMode="decimal"
                min={1}
                step="any"
                value={multiplierCap}
                onChange={(event) => setMultiplierCap(event.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <p className="panel__hint">{t('surgeZones.mapHint')}</p>
          <PolygonMapEditor
            label={t('surgeZones.mapLabel')}
            polygon={polygon}
            overlays={editorOverlays()}
            editable={!submitting}
            onPolygonChange={setPolygon}
          />

          <h4 className="bundle__section">{t('surgeZones.stepsTitle')}</h4>
          {steps.map((step, index) => (
            <div className="panel__row" key={index}>
              <div className="form-field">
                <label htmlFor={`surge-step-ratio-${index}`}>{t('surgeZones.fields.ratio')}</label>
                <input
                  id={`surge-step-ratio-${index}`}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="any"
                  value={step.ratio}
                  onChange={(event) => updateStep(index, { ratio: event.target.value })}
                  disabled={submitting}
                />
              </div>
              <div className="form-field">
                <label htmlFor={`surge-step-multiplier-${index}`}>
                  {t('surgeZones.fields.multiplier')}
                </label>
                <input
                  id={`surge-step-multiplier-${index}`}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="any"
                  value={step.multiplier}
                  onChange={(event) => updateStep(index, { multiplier: event.target.value })}
                  disabled={submitting}
                />
              </div>
              <button
                className="btn"
                type="button"
                disabled={submitting}
                onClick={() => setSteps((rows) => rows.filter((_, i) => i !== index))}
              >
                {t('surgeZones.removeStep')}
              </button>
            </div>
          ))}
          <p>
            <button
              className="btn"
              type="button"
              disabled={submitting}
              onClick={() => setSteps((rows) => [...rows, { ratio: '', multiplier: '' }])}
            >
              {t('surgeZones.addStep')}
            </button>
          </p>

          <div className="panel__row">
            <button className="btn btn--primary" type="submit" disabled={submitting}>
              {submitting ? t('surgeZones.saving') : t('surgeZones.save')}
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

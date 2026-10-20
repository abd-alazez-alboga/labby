import { useState, type FormEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ApiError } from '../../api/client';
import {
  createServiceType,
  updateServiceType,
  type ServiceType,
  type ServiceTypeUpsertRequest,
} from '../../api/regions';
import { useAuth } from '../../auth/AuthContext';
import { usePermissions } from '../../auth/usePermissions';
import { formatMoment } from '../money/money-format';
import { rideRef } from '../rides/ride-format';
import { claimedRidesOf, regionConflictMessage, type ClaimedRide } from './region-errors';
import { SRS_MINIMUM_FARE } from './srs-defaults';

type EditorState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; item: ServiceType };

/** A disable the server held back: the claimed scheduled rides still on the type (W38). */
interface ClaimedWarning {
  item: ServiceType;
  body: ServiceTypeUpsertRequest;
  rides: ClaimedRide[];
}

function mapServiceTypeError(error: unknown, t: TFunction, language: string): string {
  const conflict = regionConflictMessage(error, t, language);
  if (conflict) {
    return conflict.key;
  }
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'serviceTypes.errors.nameConflict';
    }
    if (error.status === 400) {
      return 'serviceTypes.errors.validation';
    }
  }
  return 'serviceTypes.errors.generic';
}

/**
 * UC-A-07: a region's service types with their pricing. Service types are
 * NEVER deleted — disabling removes them from booking while existing rides
 * keep referencing them, so the only state control is the enable/disable
 * toggle. Viewing needs pricing:view (the section is hidden without it);
 * every mutating control additionally needs pricing:edit. Disabling a type
 * that claimed scheduled rides still use is held back by the server (409
 * `service_type_has_claimed_rides`, UC-A-07 E1, review V1 W38): the warning
 * lists those rides, and "Disable anyway" repeats the call acknowledged —
 * the claimed rides still run.
 */
export function ServiceTypesSection({
  regionId,
  items,
  canEdit,
  onChange,
}: {
  regionId: string;
  items: ServiceType[];
  canEdit: boolean;
  onChange: (items: ServiceType[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canRides = can('rides:view');

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [baseFare, setBaseFare] = useState('');
  const [perKmRate, setPerKmRate] = useState('');
  const [perMinRate, setPerMinRate] = useState('');
  const [minimumFare, setMinimumFare] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<ClaimedWarning | null>(null);

  function openEditor(next: EditorState) {
    setEditor(next);
    setEditorError(null);
    if (next.mode === 'create') {
      setNameEn('');
      setNameAr('');
      setBaseFare('');
      setPerKmRate('');
      setPerMinRate('');
      // SRS §9 default for a new service type (I24) — editable.
      setMinimumFare(String(SRS_MINIMUM_FARE));
    } else if (next.mode === 'edit') {
      setNameEn(next.item.nameEn);
      setNameAr(next.item.nameAr);
      setBaseFare(String(next.item.baseFare));
      setPerKmRate(String(next.item.perKmRate));
      setPerMinRate(String(next.item.perMinRate));
      setMinimumFare(String(next.item.minimumFare));
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor.mode === 'closed') {
      return;
    }
    setSubmitting(true);
    setEditorError(null);
    const body: ServiceTypeUpsertRequest = {
      nameEn: nameEn.trim(),
      nameAr: nameAr.trim(),
      baseFare: Number(baseFare),
      perKmRate: Number(perKmRate),
      perMinRate: Number(perMinRate),
      minimumFare: Number(minimumFare),
      enabled: editor.mode === 'edit' ? editor.item.enabled : true,
    };
    try {
      if (editor.mode === 'create') {
        const created = await createServiceType(apiClient, regionId, body);
        onChange([...items, created]);
      } else {
        const updated = await updateServiceType(apiClient, editor.item.id, body);
        onChange(items.map((item) => (item.id === updated.id ? updated : item)));
      }
      setEditor({ mode: 'closed' });
    } catch (error) {
      setEditorError(mapServiceTypeError(error, t, i18n.language));
    } finally {
      setSubmitting(false);
    }
  }

  /** Flips `enabled` through the same full-upsert PUT (UC-A-07). */
  async function handleToggle(item: ServiceType) {
    const body: ServiceTypeUpsertRequest = {
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      baseFare: item.baseFare,
      perKmRate: item.perKmRate,
      perMinRate: item.perMinRate,
      minimumFare: item.minimumFare,
      enabled: !item.enabled,
    };
    await sendToggle(item, body, false);
  }

  async function sendToggle(
    item: ServiceType,
    body: ServiceTypeUpsertRequest,
    acknowledgeClaimedRides: boolean,
  ) {
    setPageError(null);
    setClaimed(null);
    setTogglingId(item.id);
    try {
      const updated = await updateServiceType(apiClient, item.id, body, {
        acknowledgeClaimedRides,
      });
      onChange(items.map((current) => (current.id === updated.id ? updated : current)));
    } catch (error) {
      const rides = claimedRidesOf(error);
      if (rides !== null && !acknowledgeClaimedRides) {
        setClaimed({ item, body, rides });
      } else {
        setPageError(mapServiceTypeError(error, t, i18n.language));
      }
    } finally {
      setTogglingId(null);
    }
  }

  function numberField(
    id: string,
    labelKey: string,
    value: string,
    onValue: (next: string) => void,
  ) {
    return (
      <div className="form-field">
        <label htmlFor={id}>{t(labelKey)}</label>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value}
          onChange={(event) => onValue(event.target.value)}
          required
          disabled={submitting}
        />
      </div>
    );
  }

  return (
    <section className="card panel">
      <h2 className="panel__title">{t('serviceTypes.title')}</h2>
      <p className="panel__hint">{t('serviceTypes.noDeleteHint')}</p>

      {pageError ? (
        <p className="banner banner--error" role="alert">
          {t(pageError)}
        </p>
      ) : null}

      {claimed ? (
        <div
          className="banner banner--warning claimed-rides"
          role="alertdialog"
          aria-labelledby="claimed-rides-title"
          aria-describedby="claimed-rides-body"
        >
          <span id="claimed-rides-title" className="banner__title">
            {t('serviceTypes.claimed.title')}
          </span>
          <span id="claimed-rides-body" className="banner__detail">
            {t('serviceTypes.claimed.body', { name: claimed.item.nameEn })}
          </span>
          <ul className="claimed-rides__list">
            {claimed.rides.map((ride) => (
              <li key={ride.rideId}>
                {canRides ? (
                  <Link to={`/rides/${ride.rideId}`}>
                    <bdi dir="ltr">{rideRef(ride.rideId)}</bdi>
                  </Link>
                ) : (
                  <bdi dir="ltr">{rideRef(ride.rideId)}</bdi>
                )}
                {' · '}
                {formatMoment(ride.scheduledAt, i18n.language)}
              </li>
            ))}
          </ul>
          <span className="claimed-rides__actions">
            <button
              className="btn btn--danger"
              type="button"
              disabled={togglingId === claimed.item.id}
              onClick={() => void sendToggle(claimed.item, claimed.body, true)}
            >
              {t('serviceTypes.claimed.confirm')}
            </button>
            <button className="btn" type="button" onClick={() => setClaimed(null)}>
              {t('common.cancel')}
            </button>
          </span>
        </div>
      ) : null}

      {canEdit ? (
        <p>
          <button className="btn" type="button" onClick={() => openEditor({ mode: 'create' })}>
            {t('serviceTypes.add')}
          </button>
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="banner banner--info">{t('serviceTypes.empty')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('serviceTypes.columns.nameEn')}</th>
              <th>{t('serviceTypes.columns.nameAr')}</th>
              <th>{t('serviceTypes.columns.baseFare')}</th>
              <th>{t('serviceTypes.columns.perKmRate')}</th>
              <th>{t('serviceTypes.columns.perMinRate')}</th>
              <th>{t('serviceTypes.columns.minimumFare')}</th>
              <th>{t('serviceTypes.columns.state')}</th>
              {canEdit ? <th>{t('serviceTypes.columns.actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.nameEn}</td>
                <td>{item.nameAr}</td>
                <td>{item.baseFare}</td>
                <td>{item.perKmRate}</td>
                <td>{item.perMinRate}</td>
                <td>{item.minimumFare}</td>
                <td>
                  <span className={item.enabled ? 'state' : 'state state--suspended'}>
                    {item.enabled ? t('serviceTypes.enabled') : t('serviceTypes.disabled')}
                  </span>
                </td>
                {canEdit ? (
                  <td>
                    <span className="table__actions">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => openEditor({ mode: 'edit', item })}
                      >
                        {t('serviceTypes.edit')}
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={togglingId === item.id}
                        onClick={() => void handleToggle(item)}
                      >
                        {item.enabled ? t('serviceTypes.disable') : t('serviceTypes.enable')}
                      </button>
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
              ? t('serviceTypes.createTitle')
              : t('serviceTypes.editTitle', { name: editor.item.nameEn })}
          </h3>
          {editorError ? (
            <p className="banner banner--error" role="alert">
              {t(editorError)}
            </p>
          ) : null}
          <div className="panel__row">
            <div className="form-field">
              <label htmlFor="service-type-name-en">{t('serviceTypes.fields.nameEn')}</label>
              <input
                id="service-type-name-en"
                value={nameEn}
                onChange={(event) => setNameEn(event.target.value)}
                maxLength={50}
                required
                disabled={submitting}
              />
            </div>
            <div className="form-field">
              <label htmlFor="service-type-name-ar">{t('serviceTypes.fields.nameAr')}</label>
              <input
                id="service-type-name-ar"
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
                maxLength={50}
                required
                disabled={submitting}
                dir="rtl"
              />
            </div>
          </div>
          <div className="panel__row">
            {numberField(
              'service-type-base',
              'serviceTypes.fields.baseFare',
              baseFare,
              setBaseFare,
            )}
            {numberField(
              'service-type-per-km',
              'serviceTypes.fields.perKmRate',
              perKmRate,
              setPerKmRate,
            )}
            {numberField(
              'service-type-per-min',
              'serviceTypes.fields.perMinRate',
              perMinRate,
              setPerMinRate,
            )}
            {numberField(
              'service-type-minimum',
              'serviceTypes.fields.minimumFare',
              minimumFare,
              setMinimumFare,
            )}
          </div>
          <div className="panel__row">
            <button className="btn btn--primary" type="submit" disabled={submitting}>
              {submitting ? t('serviceTypes.saving') : t('serviceTypes.save')}
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

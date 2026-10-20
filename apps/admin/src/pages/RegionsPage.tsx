import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { createRegion, listRegions, type RegionSummary } from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, PageHeader } from '../ui';

/** Maps the contract's region-creation failures (regions-v1.yaml) to messages. */
function mapRegionError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'regions.errors.nameConflict';
    }
    if (error.status === 400) {
      return 'regions.errors.validation';
    }
  }
  return 'regions.errors.generic';
}

/**
 * UC-A-05 entry point: the region list and draft creation. Per the contract
 * only the NAME is mandatory at creation — everything else is filled in on
 * the detail page while the region is a draft. Viewing needs regions:view
 * (the route guard); creating needs regions:edit and is hidden without it.
 */
export default function RegionsPage() {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const canEdit = can('regions:edit');

  const [regions, setRegions] = useState<RegionSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listRegions(apiClient)
      .then((list) => {
        if (!cancelled) {
          setRegions(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setCreateError(null);
    try {
      const created = await createRegion(apiClient, { name: name.trim() });
      // Straight into the bundle (UC-A-05 steps 1-4 live on the detail page).
      navigate(`/regions/${created.id}`, { state: { created: true } });
    } catch (error) {
      setCreateError(mapRegionError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page">
      <PageHeader
        title={t('regions.title')}
        actions={
          canEdit && regions !== null && !creating ? (
            <button className="btn btn--primary" type="button" onClick={() => setCreating(true)}>
              {t('regions.create')}
            </button>
          ) : null
        }
      />

      {loadFailed ? (
        <p className="banner banner--error" role="alert">
          {t('regions.errors.loadFailed')}
        </p>
      ) : regions === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <>
          {canEdit && creating ? (
            <form className="card panel" onSubmit={(event) => void handleCreate(event)}>
              <h2 className="panel__title">{t('regions.createTitle')}</h2>
              <p className="panel__hint">{t('regions.createHint')}</p>
              {createError ? (
                <p className="banner banner--error" role="alert">
                  {t(createError)}
                </p>
              ) : null}
              <div className="panel__row">
                <div className="form-field">
                  <label htmlFor="region-name">{t('regions.nameLabel')}</label>
                  <input
                    id="region-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={100}
                    required
                    disabled={submitting}
                  />
                </div>
                <button className="btn btn--primary" type="submit" disabled={submitting}>
                  {submitting ? t('regions.creating') : t('regions.createSubmit')}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setCreating(false)}
                  disabled={submitting}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          ) : null}

          <DataTable isEmpty={regions.length === 0} empty={t('regions.empty')}>
            <thead>
              <tr>
                <th>{t('regions.columns.name')}</th>
                <th>{t('regions.columns.state')}</th>
                <th>{t('regions.columns.currency')}</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((region) => (
                <tr key={region.id}>
                  <td>
                    <Link className="table__link" to={`/regions/${region.id}`}>
                      {region.name}
                    </Link>
                  </td>
                  <td>
                    <span
                      className={region.state === 'active' ? 'state' : 'state state--suspended'}
                    >
                      {t(`regions.states.${region.state}`)}
                    </span>
                  </td>
                  <td>{region.currency ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
    </section>
  );
}

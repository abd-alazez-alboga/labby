import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createTicketCategory,
  listAdminTicketCategories,
  patchTicketCategory,
  TICKET_PRIORITIES,
  type AdminTicketCategory,
  type TicketPriority,
} from '../api/support';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { BackLink, DataTable, PageHeader, StatusChip } from '../ui';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { PRIORITY_TONES } from './support/support-format';

/**
 * UC-A-24: ticket-category management — the full list (inactive and the
 * seeded system "Lost item" row included), add / edit (names EN+AR, default
 * priority), deactivate / reactivate. The system category is locked: never
 * editable or deactivatable here (the server answers 409 `system_category`).
 * Existing tickets keep their category and priority. `content:view` (route);
 * writes need `content:manage` and are audit-logged.
 */
export default function TicketCategoriesPage() {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canManage = can('content:manage');

  const [categories, setCategories] = useState<AdminTicketCategory[] | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  // The add / edit inline form: null = closed, '' = adding, id = editing.
  const [editing, setEditing] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [defaultPriority, setDefaultPriority] = useState<TicketPriority>('normal');

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    listAdminTicketCategories(apiClient)
      .then((loaded) => {
        if (!cancelled) {
          setCategories(loaded);
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

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(false);
    try {
      await action();
      setAttempt((n) => n + 1);
    } catch {
      setActionError(true);
    } finally {
      setBusy(false);
    }
  }

  function openEditor(category: AdminTicketCategory | null) {
    setEditing(category ? category.ticketCategoryId : '');
    setNameEn(category?.nameEn ?? '');
    setNameAr(category?.nameAr ?? '');
    setDefaultPriority(category?.defaultPriority ?? 'normal');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const en = nameEn.trim();
    const ar = nameAr.trim();
    if (!en || !ar || busy) {
      return;
    }
    void act(async () => {
      if (editing) {
        await patchTicketCategory(apiClient, editing, { nameEn: en, nameAr: ar, defaultPriority });
      } else {
        await createTicketCategory(apiClient, { nameEn: en, nameAr: ar, defaultPriority });
      }
      setEditing(null);
    });
  }

  return (
    <section className="page">
      <BackLink to="/support">{t('ticketDetail.back')}</BackLink>
      <PageHeader
        title={t('ticketCategories.title')}
        description={t('ticketCategories.subtitle')}
        actions={
          canManage ? (
            <button className="btn btn--primary" type="button" onClick={() => openEditor(null)}>
              {t('ticketCategories.newCategory')}
            </button>
          ) : null
        }
      />

      {actionError ? (
        <p className="banner banner--error" role="alert">
          {t('helpCms.actionFailed')}
        </p>
      ) : null}

      {editing !== null ? (
        <form className="card section decision-panel__actions" onSubmit={submit}>
          <h2 className="section__heading">
            {editing === '' ? t('ticketCategories.newCategory') : t('ticketCategories.editTitle')}
          </h2>
          <div className="form-field">
            <label htmlFor="cat-name-en">{t('helpCms.nameEn')}</label>
            <input
              id="cat-name-en"
              value={nameEn}
              maxLength={80}
              onChange={(event) => setNameEn(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="cat-name-ar">{t('helpCms.nameAr')}</label>
            <input
              id="cat-name-ar"
              dir="rtl"
              value={nameAr}
              maxLength={80}
              onChange={(event) => setNameAr(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="cat-priority">{t('ticketCategories.columns.defaultPriority')}</label>
            <select
              id="cat-priority"
              value={defaultPriority}
              onChange={(event) => setDefaultPriority(event.target.value as TicketPriority)}
            >
              {TICKET_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {t(`support.priority.${priority}`)}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={busy || !nameEn.trim() || !nameAr.trim()}
          >
            {editing === '' ? t('ticketCategories.create') : t('ticketCategories.save')}
          </button>
          <button className="btn" type="button" onClick={() => setEditing(null)}>
            {t('helpCms.cancel')}
          </button>
        </form>
      ) : null}

      {loadError ? (
        <LoadFailure
          kind={loadError}
          notFoundKey="review.errors.server"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : categories === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <DataTable isEmpty={categories.length === 0} empty={t('ticketCategories.empty')}>
          <thead>
            <tr>
              <th>{t('ticketCategories.columns.nameEn')}</th>
              <th>{t('ticketCategories.columns.nameAr')}</th>
              <th>{t('ticketCategories.columns.defaultPriority')}</th>
              <th>{t('ticketCategories.columns.openTickets')}</th>
              <th>{t('ticketCategories.columns.status')}</th>
              <th className="table__cell--action">
                <span className="visually-hidden">{t('support.columns.action')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const system = category.systemCode !== null;
              return (
                <tr key={category.ticketCategoryId}>
                  <td>
                    <span className="person">
                      <span dir="auto">{category.nameEn}</span>
                      {system ? (
                        <span className="person__phone">{t('ticketCategories.system')}</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="table__muted" dir="rtl">
                    {category.nameAr}
                  </td>
                  <td>
                    <StatusChip tone={PRIORITY_TONES[category.defaultPriority]}>
                      {t(`support.priority.${category.defaultPriority}`)}
                    </StatusChip>
                  </td>
                  <td className="table__muted">{category.ticketCount}</td>
                  <td>
                    {system ? (
                      <span className="table__muted">{t('ticketCategories.systemNote')}</span>
                    ) : (
                      <StatusChip tone={category.active ? 'success' : 'neutral'}>
                        {t(
                          category.active
                            ? 'ticketCategories.active'
                            : 'ticketCategories.deactivated',
                        )}
                      </StatusChip>
                    )}
                  </td>
                  <td className="table__cell--action">
                    {canManage && !system ? (
                      category.active ? (
                        <>
                          <button
                            className="btn btn--small"
                            type="button"
                            disabled={busy}
                            onClick={() => openEditor(category)}
                          >
                            {t('ticketCategories.edit')}
                          </button>{' '}
                          <button
                            className="btn btn--small btn--danger-text"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                patchTicketCategory(apiClient, category.ticketCategoryId, {
                                  active: false,
                                }),
                              )
                            }
                          >
                            {t('ticketCategories.deactivate')}
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn--small"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              patchTicketCategory(apiClient, category.ticketCategoryId, {
                                active: true,
                              }),
                            )
                          }
                        >
                          {t('ticketCategories.reactivate')}
                        </button>
                      )
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <p className="panel__hint">{t('ticketCategories.footnote')}</p>
    </section>
  );
}

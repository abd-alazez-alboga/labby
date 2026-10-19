import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  createHelpCategory,
  deleteHelpCategory,
  listAdminHelpArticles,
  listAdminHelpCategories,
  renameHelpCategory,
  reorderHelpArticles,
  reorderHelpCategories,
  type AdminHelpArticle,
  type AdminHelpCategory,
} from '../api/support';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, PageHeader, StatusChip } from '../ui';
import { formatDay } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';

/**
 * UC-A-23 steps 1–2: the help center CMS — the ordered category list (add,
 * rename EN/AR, order arrows; a category shows in the apps only while it has
 * a published article; delete while it has no article) and the selected
 * category's article table in app order with order arrows on its published
 * rows. `content:view` (route); edits need `content:manage`.
 */
export default function HelpCmsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canManage = can('content:manage');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('categoryId');

  const [categories, setCategories] = useState<AdminHelpCategory[] | null>(null);
  const [articles, setArticles] = useState<AdminHelpArticle[] | null>(null);
  const [articlesError, setArticlesError] = useState<FailureKind | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  /** The i18n key of the last failed action's message, else null. */
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // The add / rename inline form: null = closed, '' = adding, id = renaming.
  const [editing, setEditing] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    listAdminHelpCategories(apiClient)
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

  const selected =
    categories?.find((category) => category.helpCategoryId === selectedId) ?? categories?.[0];

  useEffect(() => {
    if (!selected) {
      setArticles(null);
      return;
    }
    let cancelled = false;
    setArticles(null);
    setArticlesError(null);
    listAdminHelpArticles(apiClient, { categoryId: selected.helpCategoryId })
      .then((loaded) => {
        if (!cancelled) {
          setArticles(loaded);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setArticlesError(classifyError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, selected?.helpCategoryId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(
    action: () => Promise<unknown>,
    errorKey: (error: unknown) => string = () => 'helpCms.actionFailed',
  ) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      setAttempt((n) => n + 1);
    } catch (error: unknown) {
      setActionError(errorKey(error));
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    if (!categories) {
      return;
    }
    const ids = categories.map((category) => category.helpCategoryId);
    const target = index + delta;
    if (target < 0 || target >= ids.length) {
      return;
    }
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void act(() => reorderHelpCategories(apiClient, ids));
  }

  // Only published articles carry an app order (drafts show `—`).
  const publishedArticles = (articles ?? [])
    .filter((article) => article.status === 'published')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  function moveArticle(index: number, delta: -1 | 1) {
    if (!selected) {
      return;
    }
    const ids = publishedArticles.map((article) => article.helpArticleId);
    const target = index + delta;
    if (target < 0 || target >= ids.length) {
      return;
    }
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const categoryId = selected.helpCategoryId;
    void act(() => reorderHelpArticles(apiClient, categoryId, ids));
  }

  function removeCategory(category: AdminHelpCategory) {
    setConfirmingDeleteId(null);
    void act(
      async () => {
        await deleteHelpCategory(apiClient, category.helpCategoryId);
        if (selectedId === category.helpCategoryId) {
          setParams({});
        }
      },
      (error) =>
        error instanceof ApiError && error.code === 'category_not_empty'
          ? 'helpCms.errors.categoryNotEmpty'
          : 'helpCms.actionFailed',
    );
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    const en = nameEn.trim();
    const ar = nameAr.trim();
    if (!en || !ar || busy) {
      return;
    }
    void act(async () => {
      if (editing) {
        await renameHelpCategory(apiClient, editing, { nameEn: en, nameAr: ar });
      } else {
        await createHelpCategory(apiClient, { nameEn: en, nameAr: ar });
      }
      setEditing(null);
      setNameEn('');
      setNameAr('');
    });
  }

  function openEditor(category: AdminHelpCategory | null) {
    setEditing(category ? category.helpCategoryId : '');
    setNameEn(category?.nameEn ?? '');
    setNameAr(category?.nameAr ?? '');
  }

  return (
    <section className="page">
      <PageHeader
        title={t('helpCms.title')}
        description={t('helpCms.subtitle')}
        actions={
          canManage && selected ? (
            <Link
              className="btn btn--primary"
              to={`/help-center/articles/new?categoryId=${selected.helpCategoryId}`}
            >
              {t('helpCms.newArticle')}
            </Link>
          ) : null
        }
      />

      {actionError ? (
        <p className="banner banner--error" role="alert">
          {t(actionError)}
        </p>
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
        <div className="review-layout">
          <aside className="card section" aria-label={t('helpCms.categoriesTitle')}>
            <div className="table-card__head">
              <h2 className="section__heading">{t('helpCms.categoriesTitle')}</h2>
              {canManage ? (
                <button className="btn btn--small" type="button" onClick={() => openEditor(null)}>
                  {t('helpCms.addCategory')}
                </button>
              ) : null}
            </div>
            <div className="help-cats">
              {categories.map((category, index) => {
                const active = category.helpCategoryId === selected?.helpCategoryId;
                const drafts = category.articleCount - category.publishedCount;
                return (
                  <div
                    key={category.helpCategoryId}
                    className={active ? 'help-cats__row help-cats__row--active' : 'help-cats__row'}
                  >
                    {canManage ? (
                      <span className="help-cats__arrows">
                        <button
                          className="btn"
                          type="button"
                          disabled={busy || index === 0}
                          aria-label={t('helpCms.moveUp', { name: category.nameEn })}
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="btn"
                          type="button"
                          disabled={busy || index === categories.length - 1}
                          aria-label={t('helpCms.moveDown', { name: category.nameEn })}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </button>
                      </span>
                    ) : null}
                    <button
                      className="help-cats__name"
                      type="button"
                      onClick={() => setParams({ categoryId: category.helpCategoryId })}
                    >
                      <span dir="auto">
                        {language.startsWith('ar')
                          ? `${category.nameAr} · ${category.nameEn}`
                          : `${category.nameEn} · ${category.nameAr}`}
                      </span>
                      <span className="help-cats__counts">
                        {t('helpCms.published', { count: category.publishedCount })}
                        {drafts > 0 ? ` · ${t('helpCms.drafts', { count: drafts })}` : ''}
                        {category.publishedCount === 0 ? ` · ${t('helpCms.hiddenWhileEmpty')}` : ''}
                      </span>
                    </button>
                    {canManage ? (
                      <button
                        className="btn btn--small"
                        type="button"
                        onClick={() => openEditor(category)}
                      >
                        {t('helpCms.rename')}
                      </button>
                    ) : null}
                    {canManage && category.articleCount === 0 ? (
                      confirmingDeleteId === category.helpCategoryId ? (
                        <span className="table__confirm">
                          {t('helpCms.deleteConfirm')}
                          <button
                            className="btn btn--small btn--danger"
                            type="button"
                            disabled={busy}
                            onClick={() => removeCategory(category)}
                          >
                            {t('common.confirm')}
                          </button>
                          <button
                            className="btn btn--small"
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                          >
                            {t('common.cancel')}
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn btn--small btn--danger-text"
                          type="button"
                          aria-label={t('helpCms.deleteNamed', { name: category.nameEn })}
                          onClick={() => setConfirmingDeleteId(category.helpCategoryId)}
                        >
                          {t('helpCms.delete')}
                        </button>
                      )
                    ) : null}
                  </div>
                );
              })}
              {categories.length === 0 ? (
                <p className="panel__hint">{t('helpCms.noCategories')}</p>
              ) : null}
            </div>
            {editing !== null ? (
              <form className="decision-panel__actions" onSubmit={submitCategory}>
                <div className="form-field">
                  <label htmlFor="help-cat-en">{t('helpCms.nameEn')}</label>
                  <input
                    id="help-cat-en"
                    value={nameEn}
                    maxLength={80}
                    onChange={(event) => setNameEn(event.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="help-cat-ar">{t('helpCms.nameAr')}</label>
                  <input
                    id="help-cat-ar"
                    dir="rtl"
                    value={nameAr}
                    maxLength={80}
                    onChange={(event) => setNameAr(event.target.value)}
                  />
                </div>
                <button
                  className="btn btn--primary"
                  type="submit"
                  disabled={busy || !nameEn.trim() || !nameAr.trim()}
                >
                  {editing === '' ? t('helpCms.addCategory') : t('helpCms.rename')}
                </button>
                <button className="btn" type="button" onClick={() => setEditing(null)}>
                  {t('helpCms.cancel')}
                </button>
              </form>
            ) : null}
            <p className="panel__hint">{t('helpCms.orderHint')}</p>
          </aside>

          <div className="review-layout__main">
            {selected ? (
              <DataTable
                title={t('helpCms.articlesTitle', {
                  name: language.startsWith('ar') ? selected.nameAr : selected.nameEn,
                })}
                actions={<span className="panel__hint">{t('helpCms.articlesOrdered')}</span>}
                isEmpty={articles !== null && articles.length === 0}
                empty={t('helpCms.noArticles')}
              >
                <thead>
                  <tr>
                    <th>{t('helpCms.columns.order')}</th>
                    <th>{t('helpCms.columns.title')}</th>
                    <th>{t('helpCms.columns.status')}</th>
                    <th>{t('helpCms.columns.updated')}</th>
                    <th className="table__cell--action">
                      <span className="visually-hidden">{t('support.columns.action')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(articles ?? []).map((article) => {
                    const orderIndex = publishedArticles.indexOf(article);
                    const title = article.titleEn ?? article.titleAr ?? t('helpCms.untitled');
                    return (
                      <tr key={article.helpArticleId}>
                        <td className="table__muted">
                          {article.status === 'published' ? (
                            <span className="help-cats__arrows">
                              {article.sortOrder + 1}
                              {canManage ? (
                                <>
                                  <button
                                    className="btn"
                                    type="button"
                                    disabled={busy || orderIndex <= 0}
                                    aria-label={t('helpCms.moveUp', { name: title })}
                                    onClick={() => moveArticle(orderIndex, -1)}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    className="btn"
                                    type="button"
                                    disabled={busy || orderIndex === publishedArticles.length - 1}
                                    aria-label={t('helpCms.moveDown', { name: title })}
                                    onClick={() => moveArticle(orderIndex, 1)}
                                  >
                                    ↓
                                  </button>
                                </>
                              ) : null}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <span className="person">
                            <span dir="auto">{title}</span>
                            {article.missing.length > 0 ? (
                              <span className="person__phone">
                                {t('helpCms.missingNote', {
                                  fields: article.missing
                                    .map((field) => t(`helpEditor.fields.${field}`))
                                    .join(' · '),
                                })}
                              </span>
                            ) : article.titleAr ? (
                              <span className="person__phone" dir="rtl">
                                {article.titleAr}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          <StatusChip tone={article.status === 'published' ? 'success' : 'warning'}>
                            {t(`helpCms.status.${article.status}`)}
                          </StatusChip>
                        </td>
                        <td className="table__muted">{formatDay(article.updatedAt, language)}</td>
                        <td className="table__cell--action">
                          <Link
                            className={article.missing.length > 0 ? 'btn btn--primary' : 'btn'}
                            to={`/help-center/articles/${article.helpArticleId}`}
                          >
                            {t('helpCms.edit')}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            ) : (
              <p className="panel__hint">{t('helpCms.noCategories')}</p>
            )}
            {articlesError && selected ? (
              <LoadFailure
                kind={articlesError}
                notFoundKey="review.errors.server"
                onRetry={() => setAttempt((n) => n + 1)}
              />
            ) : articles === null && selected ? (
              <div className="loading">{t('common.loading')}</div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

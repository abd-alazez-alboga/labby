import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  createHelpArticle,
  getAdminHelpArticle,
  listAdminHelpCategories,
  patchHelpArticle,
  publishHelpArticle,
  unpublishHelpArticle,
  type AdminHelpArticle,
  type AdminHelpCategory,
} from '../api/support';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { BackLink, PageHeader, StatusChip } from '../ui';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';

const BODY_MAX = 20000;

type MissingField = 'titleEn' | 'titleAr' | 'bodyEn' | 'bodyAr';

/** The texts that are still blank — mirrors the server's `missing` rule. */
function missingFields(draft: {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}): MissingField[] {
  const missing: MissingField[] = [];
  if (!draft.titleEn.trim()) missing.push('titleEn');
  if (!draft.titleAr.trim()) missing.push('titleAr');
  if (!draft.bodyEn.trim()) missing.push('bodyEn');
  if (!draft.bodyAr.trim()) missing.push('bodyAr');
  return missing;
}

/**
 * UC-A-23 steps 3–4: the article editor — EN and AR side by side (title +
 * plain-text body), "Save draft" always allowed, "Publish" blocked until all
 * four texts are present (the server answers 422 `translation_missing`
 * otherwise — milestone AC). Editing a published article applies immediately.
 * Route: `content:manage` for /new, `content:view` to open an existing one;
 * the write buttons need `content:manage`.
 */
export default function HelpArticleEditorPage() {
  const { t, i18n } = useTranslation();
  const { helpArticleId } = useParams<{ helpArticleId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canManage = can('content:manage');
  const isNew = helpArticleId === undefined;

  const [article, setArticle] = useState<AdminHelpArticle | null>(null);
  const [categories, setCategories] = useState<AdminHelpCategory[]>([]);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [categoryId, setCategoryId] = useState(params.get('categoryId') ?? '');
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'published' | 'unpublished' | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminHelpCategories(apiClient)
      .then((loaded) => {
        if (!cancelled) {
          setCategories(loaded);
          setCategoryId((current) => current || (loaded[0]?.helpCategoryId ?? ''));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  useEffect(() => {
    if (isNew) {
      return;
    }
    let cancelled = false;
    setLoadError(null);
    getAdminHelpArticle(apiClient, helpArticleId)
      .then((loaded) => {
        if (!cancelled) {
          setArticle(loaded);
          setCategoryId(loaded.helpCategoryId);
          setTitleEn(loaded.titleEn ?? '');
          setTitleAr(loaded.titleAr ?? '');
          setBodyEn(loaded.bodyEn ?? '');
          setBodyAr(loaded.bodyAr ?? '');
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
  }, [apiClient, helpArticleId, isNew, attempt]);

  const missing = missingFields({ titleEn, titleAr, bodyEn, bodyAr });
  const status = article?.status ?? 'draft';
  const hasAnyTitle = titleEn.trim() !== '' || titleAr.trim() !== '';

  function payload() {
    return {
      helpCategoryId: categoryId,
      titleEn: titleEn.trim() || null,
      titleAr: titleAr.trim() || null,
      bodyEn: bodyEn || null,
      bodyAr: bodyAr || null,
    };
  }

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    setErrorKey(null);
    try {
      await action();
    } catch (error: unknown) {
      setErrorKey(
        error instanceof ApiError && error.code === 'translation_missing'
          ? 'helpEditor.errors.translationMissing'
          : error instanceof ApiError && error.code === 'body_too_long'
            ? 'helpEditor.errors.bodyTooLong'
            : 'helpEditor.errors.saveFailed',
      );
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    void act(async () => {
      if (article) {
        setArticle(await patchHelpArticle(apiClient, article.helpArticleId, payload()));
        setNotice('saved');
      } else {
        const created = await createHelpArticle(apiClient, payload());
        setNotice('saved');
        navigate(`/help-center/articles/${created.helpArticleId}`, { replace: true });
      }
    });
  }

  function publish() {
    void act(async () => {
      // Save the texts first so the publish checks what is on screen.
      const saved = article
        ? await patchHelpArticle(apiClient, article.helpArticleId, payload())
        : await createHelpArticle(apiClient, payload());
      setArticle(await publishHelpArticle(apiClient, saved.helpArticleId));
      setNotice('published');
      if (!article) {
        navigate(`/help-center/articles/${saved.helpArticleId}`, { replace: true });
      }
    });
  }

  function unpublish() {
    if (!article) {
      return;
    }
    void act(async () => {
      setArticle(await unpublishHelpArticle(apiClient, article.helpArticleId));
      setNotice('unpublished');
    });
  }

  const backLink = <BackLink to="/help-center">{t('helpEditor.back')}</BackLink>;

  if (!isNew && article === null) {
    return (
      <section className="page">
        {backLink}
        {loadError ? (
          <LoadFailure
            kind={loadError}
            notFoundKey="helpEditor.notFound"
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : (
          <div className="loading">{t('common.loading')}</div>
        )}
      </section>
    );
  }

  return (
    <section className="page">
      {backLink}
      <PageHeader
        title={isNew ? t('helpEditor.newTitle') : t('helpEditor.editTitle')}
        meta={
          <StatusChip tone={status === 'published' ? 'success' : 'warning'}>
            {t(`helpCms.status.${status}`)}
          </StatusChip>
        }
        actions={
          canManage ? (
            <>
              <button
                className="btn"
                type="button"
                disabled={busy || !hasAnyTitle}
                onClick={saveDraft}
              >
                {t('helpEditor.saveDraft')}
              </button>
              {status === 'published' ? (
                <button className="btn" type="button" disabled={busy} onClick={unpublish}>
                  {t('helpEditor.unpublish')}
                </button>
              ) : (
                <button
                  className="btn btn--primary"
                  type="button"
                  disabled={busy || missing.length > 0}
                  onClick={publish}
                >
                  {t('helpEditor.publish')}
                </button>
              )}
            </>
          ) : null
        }
      />

      <div className="form-field">
        <label htmlFor="article-category">{t('helpEditor.categoryLabel')}</label>
        <select
          id="article-category"
          value={categoryId}
          disabled={!canManage || busy}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          {categories.map((category) => (
            <option key={category.helpCategoryId} value={category.helpCategoryId}>
              {i18n.language.startsWith('ar') ? category.nameAr : category.nameEn}
            </option>
          ))}
        </select>
      </div>

      {missing.length > 0 && status !== 'published' ? (
        <p className="banner" role="status">
          {t('helpEditor.blocked', {
            fields: missing.map((field) => t(`helpEditor.fields.${field}`)).join(' · '),
          })}
        </p>
      ) : null}
      {notice ? (
        <p className="banner banner--success" role="status">
          {t(`helpEditor.notice.${notice}`)}
        </p>
      ) : null}
      {errorKey ? (
        <p className="banner banner--error" role="alert">
          {t(errorKey)}
        </p>
      ) : null}

      <div className="help-editor">
        <section className="card section help-editor__lang" aria-label={t('helpEditor.enTitle')}>
          <h2 className="section__heading">{t('helpEditor.enTitle')}</h2>
          <div className="form-field">
            <label htmlFor="title-en">{t('helpEditor.titleLabel')}</label>
            <input
              id="title-en"
              dir="ltr"
              value={titleEn}
              maxLength={160}
              disabled={!canManage}
              onChange={(event) => setTitleEn(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="body-en">{t('helpEditor.bodyLabel')}</label>
            <textarea
              id="body-en"
              dir="ltr"
              value={bodyEn}
              maxLength={BODY_MAX}
              disabled={!canManage}
              onChange={(event) => setBodyEn(event.target.value)}
            />
          </div>
          <span className="panel__hint">{t('helpEditor.charCount', { count: bodyEn.length })}</span>
        </section>

        <section className="card section help-editor__lang" aria-label={t('helpEditor.arTitle')}>
          <h2 className="section__heading">{t('helpEditor.arTitle')}</h2>
          <div className="form-field">
            <label htmlFor="title-ar">{t('helpEditor.titleArLabel')}</label>
            <input
              id="title-ar"
              dir="rtl"
              value={titleAr}
              maxLength={160}
              disabled={!canManage}
              onChange={(event) => setTitleAr(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="body-ar">{t('helpEditor.bodyArLabel')}</label>
            <textarea
              id="body-ar"
              dir="rtl"
              value={bodyAr}
              maxLength={BODY_MAX}
              disabled={!canManage}
              onChange={(event) => setBodyAr(event.target.value)}
            />
          </div>
          <span className="panel__hint">{t('helpEditor.charCount', { count: bodyAr.length })}</span>
        </section>
      </div>
    </section>
  );
}

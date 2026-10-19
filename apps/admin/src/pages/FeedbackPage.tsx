import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import {
  FEEDBACK_CATEGORIES,
  getFeedbackStats,
  listAdminFeedback,
  setFeedbackTags,
  type AdminFeedback,
  type AdminFeedbackPage,
  type FeedbackCategory,
  type FeedbackQuery,
  type FeedbackStats,
} from '../api/support';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, FilterChips, PageHeader, Section, TablePager } from '../ui';
import { formatDay } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';

const PAGE_SIZE = 20;
const TREND_WEEKS = 4;
const DAY_MS = 86_400_000;

type AppFilter = '' | 'rider' | 'driver';
type Period = '30d' | '7d' | 'all';

function parseCategory(value: string | null): FeedbackCategory | '' {
  return (FEEDBACK_CATEGORIES as readonly string[]).includes(value ?? '')
    ? (value as FeedbackCategory)
    : '';
}

function parsePeriod(value: string | null): Period {
  return value === '7d' || value === 'all' ? value : '30d';
}

/** The UTC start of the Monday `weeksBack` weeks before now. */
function weekStart(weeksBack: number, nowMs: number = Date.now()): Date {
  const now = new Date(nowMs);
  const day = (now.getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day);
  return new Date(monday - weeksBack * 7 * DAY_MS);
}

/**
 * UC-A-25: the feedback browser — the counts-by-category-per-week trend grid
 * (the stats endpoint, last 4 ISO weeks), app / category / period filters,
 * and the entries with their free-text tags (trimmed, lower-cased, ≤ 30
 * chars server-side). No reply is promised to users (FDBK-01) — tags group
 * themes. `support:view` (route); tagging needs `support:handle`.
 */
export default function FeedbackPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canHandle = can('support:handle');
  const [params, setParams] = useSearchParams();

  const app = (params.get('app') ?? '') as AppFilter;
  const category = parseCategory(params.get('category'));
  const period = parsePeriod(params.get('period'));
  const page = Math.max(0, Number(params.get('page')) || 0);

  const [result, setResult] = useState<AdminFeedbackPage | null>(null);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The entry whose "+ tag" input is open, and its draft text.
  const [tagging, setTagging] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [tagError, setTagError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    const query: FeedbackQuery = { page, size: PAGE_SIZE };
    if (app) {
      query.submittedAs = app;
    }
    if (category) {
      query.category = category;
    }
    if (period !== 'all') {
      const days = period === '7d' ? 7 : 30;
      query.from = new Date(Date.now() - days * DAY_MS).toISOString();
    }
    listAdminFeedback(apiClient, query)
      .then((loaded) => {
        if (!cancelled) {
          setResult(loaded);
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
  }, [apiClient, app, category, period, page, attempt]);

  // The trend is fixed to the last 4 whole-plus-current ISO weeks; only the
  // app filter applies to it (the board's "Entries by category" section).
  useEffect(() => {
    let cancelled = false;
    setStats(null);
    getFeedbackStats(apiClient, {
      from: weekStart(TREND_WEEKS - 1).toISOString(),
      to: weekStart(-1).toISOString(),
      bucket: 'week',
      submittedAs: app || undefined,
    })
      .then((loaded) => {
        if (!cancelled) {
          setStats(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStats(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, app, attempt]);

  function navigate(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    next.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    setParams(next);
  }

  function setPage(nextPage: number) {
    const next = new URLSearchParams(params);
    if (nextPage > 0) {
      next.set('page', String(nextPage));
    } else {
      next.delete('page');
    }
    setParams(next);
  }

  function submitTag(event: FormEvent, entry: AdminFeedback) {
    event.preventDefault();
    const tag = tagDraft.trim().toLowerCase();
    if (!tag || tag.length > 30 || busy) {
      return;
    }
    setBusy(true);
    setTagError(false);
    setFeedbackTags(apiClient, entry.feedbackId, [...new Set([...entry.tags, tag])])
      .then((updated) => {
        setResult((current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.feedbackId === updated.feedbackId ? updated : item,
                ),
              }
            : current,
        );
        setTagging(null);
        setTagDraft('');
      })
      .catch(() => setTagError(true))
      .finally(() => setBusy(false));
  }

  const maxCell = stats
    ? Math.max(1, ...stats.buckets.flatMap((bucket) => Object.values(bucket.byCategory)))
    : 1;

  function cellClass(count: number): string {
    if (count === 0 || maxCell === 0) {
      return 'trend__cell';
    }
    const share = count / maxCell;
    return share > 0.66 ? 'trend__cell trend__cell--hot' : 'trend__cell trend__cell--warm';
  }

  const lastPage = result ? Math.max(0, Math.ceil(result.totalItems / result.size) - 1) : 0;

  return (
    <section className="page">
      <PageHeader title={t('feedback.title')} description={t('feedback.subtitle')} />

      <Section
        title={t('feedback.trendTitle')}
        actions={<span className="panel__hint">{t('feedback.trendRange')}</span>}
      >
        {stats === null ? (
          <div className="loading">{t('common.loading')}</div>
        ) : (
          <div
            className="trend"
            role="table"
            aria-label={t('feedback.trendTitle')}
            style={{
              gridTemplateColumns: `150px repeat(${stats.buckets.length}, minmax(0, 1fr)) 70px`,
            }}
          >
            <span className="trend__head" aria-hidden="true" />
            {stats.buckets.map((bucket) => (
              <span key={bucket.start} className="trend__head">
                {formatDay(bucket.start, language)}
              </span>
            ))}
            <span className="trend__head trend__head--end">{t('feedback.trendTotal')}</span>
            {FEEDBACK_CATEGORIES.map((row) => (
              <FragmentRow
                key={row}
                label={t(`feedback.category.${row}`)}
                cells={stats.buckets.map((bucket) => bucket.byCategory[row] ?? 0)}
                total={stats.byCategory[row] ?? 0}
                cellClass={cellClass}
              />
            ))}
          </div>
        )}
      </Section>

      <div className="rides-filters">
        <FilterChips<AppFilter>
          label={t('feedback.appLabel')}
          options={[
            { value: '', label: t('feedback.apps.all') },
            { value: 'rider', label: t('feedback.apps.rider') },
            { value: 'driver', label: t('feedback.apps.driver') },
          ]}
          isSelected={(value) => value === app}
          onSelect={(value) => navigate({ app: value })}
        />
        <select
          aria-label={t('feedback.categoryLabel')}
          value={category}
          onChange={(event) => navigate({ category: event.target.value })}
        >
          <option value="">{t('feedback.allCategories')}</option>
          {FEEDBACK_CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {t(`feedback.category.${option}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('feedback.periodLabel')}
          value={period}
          onChange={(event) => navigate({ period: event.target.value })}
        >
          <option value="30d">{t('feedback.period.30d')}</option>
          <option value="7d">{t('feedback.period.7d')}</option>
          <option value="all">{t('feedback.period.all')}</option>
        </select>
      </div>

      {tagError ? (
        <p className="banner banner--error" role="alert">
          {t('feedback.tagFailed')}
        </p>
      ) : null}

      {loadError ? (
        <LoadFailure
          kind={loadError}
          notFoundKey="review.errors.server"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : result === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <DataTable
          isEmpty={result.items.length === 0}
          empty={t('feedback.empty')}
          footer={
            result.totalItems > result.size ? (
              <TablePager
                status={t('money.pageOf', { page: page + 1, total: lastPage + 1 })}
                previousLabel={t('audit.previous')}
                nextLabel={t('audit.next')}
                canPrevious={page > 0}
                canNext={page < lastPage}
                onPrevious={() => setPage(page - 1)}
                onNext={() => setPage(page + 1)}
              />
            ) : null
          }
        >
          <thead>
            <tr>
              <th>{t('feedback.columns.date')}</th>
              <th>{t('feedback.columns.app')}</th>
              <th>{t('feedback.columns.category')}</th>
              <th>{t('feedback.columns.feedback')}</th>
              <th>{t('feedback.columns.tags')}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((entry) => (
              <tr key={entry.feedbackId}>
                <td className="table__muted">{formatDay(entry.createdAt, language)}</td>
                <td className="table__muted">{t(`feedback.apps.${entry.submittedAs}`)}</td>
                <td className="table__muted">{t(`feedback.category.${entry.category}`)}</td>
                <td dir="auto">{entry.body}</td>
                <td>
                  <div className="tag-row">
                    {entry.tags.map((tag) => (
                      <span key={tag} className="chip chip--accent" dir="ltr">
                        {tag}
                      </span>
                    ))}
                    {canHandle ? (
                      tagging === entry.feedbackId ? (
                        <form onSubmit={(event) => submitTag(event, entry)}>
                          <input
                            autoFocus
                            value={tagDraft}
                            maxLength={30}
                            dir="ltr"
                            aria-label={t('feedback.tagLabel')}
                            onChange={(event) => setTagDraft(event.target.value)}
                          />
                          <button
                            className="btn btn--small"
                            type="submit"
                            disabled={busy || !tagDraft.trim()}
                          >
                            {t('feedback.tagSave')}
                          </button>
                        </form>
                      ) : (
                        <button
                          className="btn btn--small"
                          type="button"
                          onClick={() => {
                            setTagging(entry.feedbackId);
                            setTagDraft('');
                          }}
                        >
                          {t('feedback.addTag')}
                        </button>
                      )
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

/** One trend row: the category label, a cell per week, then the total. */
function FragmentRow({
  label,
  cells,
  total,
  cellClass,
}: {
  label: string;
  cells: number[];
  total: number;
  cellClass: (count: number) => string;
}) {
  return (
    <>
      <span className="trend__label">{label}</span>
      {cells.map((count, index) => (
        <span key={index} className={cellClass(count)}>
          {count}
        </span>
      ))}
      <span className="trend__total">{total}</span>
    </>
  );
}

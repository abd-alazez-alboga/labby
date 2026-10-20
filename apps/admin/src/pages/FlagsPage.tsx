import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  FLAG_KINDS,
  listAccountFlags,
  listAdminReports,
  resolveAccountFlag,
  type AccountFlag,
  type AccountFlagPage,
  type AdminReportSummary,
  type FlagKind,
  type FlagResolution,
} from '../api/trust';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { DataTable, DecisionPanel, PageHeader, ReviewLayout, TablePager } from '../ui';
import { formatDay } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { PartyName } from './trust/TrustUi';
import { conflictCode, decisionErrorKey, flagRule } from './trust/trust-format';

const PAGE_SIZE = 20;
type KindFilter = FlagKind | 'all';
const KIND_FILTERS: readonly KindFilter[] = ['all', ...FLAG_KINDS];

function parseKind(value: string | null): KindFilter {
  return (FLAG_KINDS as readonly string[]).includes(value ?? '') ? (value as FlagKind) : 'all';
}

/**
 * UC-A-16: the flagged-accounts queue (open flags, oldest first) — low
 * rating (RATE-03), metric warnings (DRV-07), report threshold (REP-03) —
 * with the triggering rule per kind. Selecting a flag opens the side panel:
 * evidence links, the profile (where suspension happens, UC-A-14) and, with
 * `users:suspend`, closing the flag as actioned or dismissed with a note.
 * Flags never suspend anyone. `users:view` (route guard).
 */
export default function FlagsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const [params, setParams] = useSearchParams();

  const kind = parseKind(params.get('kind'));
  const page = Math.max(0, Number(params.get('page')) || 0);

  const [result, setResult] = useState<AccountFlagPage | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ key: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    listAccountFlags(apiClient, {
      status: 'open',
      kind: kind === 'all' ? undefined : kind,
      page,
      size: PAGE_SIZE,
    })
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
  }, [apiClient, kind, page, attempt]);

  function navigate(nextKind: KindFilter, nextPage: number) {
    const next = new URLSearchParams();
    if (nextKind !== 'all') {
      next.set('kind', nextKind);
    }
    if (nextPage > 0) {
      next.set('page', String(nextPage));
    }
    setResult(null);
    setSelectedId(null);
    setNotice(null);
    setParams(next);
  }

  const items = result?.items ?? [];
  // The oldest flag is selected until the admin picks another.
  const selected = items.find((flag) => flag.id === selectedId) ?? items[0] ?? null;
  const lastPage = result ? Math.max(0, Math.ceil(result.totalElements / result.size) - 1) : 0;
  const total = result?.totalElements ?? null;

  function onClosed(resolution: FlagResolution) {
    setNotice({ key: `flags.closed.${resolution}`, tone: 'success' });
    setSelectedId(null);
    setAttempt((n) => n + 1);
  }

  function onConflict() {
    setNotice({ key: 'flags.errors.alreadyResolved', tone: 'error' });
    setSelectedId(null);
    setAttempt((n) => n + 1);
  }

  return (
    <section className="page">
      <PageHeader
        title={t('flags.title')}
        description={t('flags.subtitle')}
        actions={
          <div className="segmented" role="group" aria-label={t('flags.kindLabel')}>
            {KIND_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                className="segmented__option"
                aria-pressed={option === kind}
                onClick={() => navigate(option, 0)}
              >
                {option === kind && total !== null
                  ? t('flags.filterCount', { label: t(`flags.filter.${option}`), count: total })
                  : t(`flags.filter.${option}`)}
              </button>
            ))}
          </div>
        }
      />

      {notice ? (
        <p
          className={notice.tone === 'success' ? 'banner banner--success' : 'banner banner--error'}
          role={notice.tone === 'success' ? 'status' : 'alert'}
        >
          {t(notice.key)}
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
        <ReviewLayout
          aside={
            selected ? (
              <FlagPanel
                key={selected.id}
                flag={selected}
                onClosed={onClosed}
                onConflict={onConflict}
              />
            ) : null
          }
        >
          <DataTable
            isEmpty={items.length === 0}
            empty={t(kind === 'all' ? 'flags.empty' : 'flags.emptyKind')}
            footer={
              result.totalElements > result.size ? (
                <TablePager
                  status={t('money.pageOf', { page: page + 1, total: lastPage + 1 })}
                  previousLabel={t('audit.previous')}
                  nextLabel={t('audit.next')}
                  canPrevious={page > 0}
                  canNext={page < lastPage}
                  onPrevious={() => navigate(kind, page - 1)}
                  onNext={() => navigate(kind, page + 1)}
                />
              ) : null
            }
          >
            <thead>
              <tr>
                <th>{t('flags.columns.account')}</th>
                <th>{t('flags.columns.flag')}</th>
                <th>{t('flags.columns.rule')}</th>
                <th>{t('flags.columns.raised')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((flag) => {
                const isSelected = selected?.id === flag.id;
                return (
                  <tr key={flag.id} className={isSelected ? 'table__row--selected' : undefined}>
                    <td>
                      <span className="person">
                        <PartyName party={flag.user} />
                        <span className="person__phone">{t(`trust.role.${flag.user.role}`)}</span>
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="table__select-button"
                        aria-pressed={isSelected}
                        aria-label={t('flags.selectFor', {
                          kind: t(`flags.kind.${flag.kind}`),
                          name: flag.user.name,
                        })}
                        onClick={() => setSelectedId(flag.id)}
                      >
                        {t(`flags.kind.${flag.kind}`)}
                      </button>
                    </td>
                    <td className="table__muted">{flagRule(t, language, flag)}</td>
                    <td className="table__muted">{formatDay(flag.raisedAt, language)}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </ReviewLayout>
      )}
    </section>
  );
}

/** Side panel of the selected flag: evidence, the profile link, and closing it. */
function FlagPanel({
  flag,
  onClosed,
  onConflict,
}: {
  flag: AccountFlag;
  onClosed: (resolution: FlagResolution) => void;
  onConflict: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canSuspend = can('users:suspend');
  const canReports = can('reports:view');

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // AdminFlags board (V1 audit I85): the evidence reads "category · date".
  // One read of the user's substantiated reports names the flag's ids;
  // without reports:view (or on failure) the ids stay as refs.
  const [reportsById, setReportsById] = useState<Map<string, AdminReportSummary>>(new Map());
  const thresholdUserId = flag.kind === 'report_threshold' ? flag.user.userId : null;
  useEffect(() => {
    setReportsById(new Map());
    if (!thresholdUserId || !canReports) {
      return;
    }
    let cancelled = false;
    listAdminReports(apiClient, {
      status: 'substantiated',
      reportedUserId: thresholdUserId,
      size: 100,
    })
      .then((page) => {
        if (!cancelled) {
          setReportsById(new Map(page.items.map((report) => [report.id, report])));
        }
      })
      .catch(() => {
        // Keep the id refs.
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, thresholdUserId, canReports]);

  function reportLabel(reportId: string): string {
    const report = reportsById.get(reportId);
    return report
      ? t('flags.panel.reportEntry', {
          category: t(`reports.category.${report.category}`),
          date: formatDay(report.createdAt, i18n.language),
        })
      : t('flags.panel.report', { ref: reportId.slice(0, 8).toUpperCase() });
  }

  async function close(resolution: FlagResolution) {
    if (note.trim() === '') {
      setErrorKey('flags.panel.noteRequired');
      return;
    }
    setErrorKey(null);
    setBusy(true);
    try {
      await resolveAccountFlag(apiClient, flag.id, resolution, note.trim());
      onClosed(resolution);
    } catch (error) {
      if (conflictCode(error) === 'already_resolved') {
        onConflict();
      } else {
        setErrorKey(decisionErrorKey(error));
        setBusy(false);
      }
    }
  }

  const title = t('flags.panel.heading', {
    name: flag.user.name,
    kind: t(`flags.kind.${flag.kind}`),
  });

  return (
    <DecisionPanel title={title} label={t('flags.panel.label')}>
      <p className="panel__hint">{flagRule(t, i18n.language, flag)}</p>
      {flag.kind === 'report_threshold' ? (
        <div className="evidence-links">
          <span className="decision-panel__subtitle">{t('flags.panel.reportsTitle')}</span>
          {flag.details.reportIds.map((reportId) =>
            canReports ? (
              <Link key={reportId} to={`/reports/${reportId}`}>
                {reportLabel(reportId)}
              </Link>
            ) : (
              <span key={reportId}>{reportLabel(reportId)}</span>
            ),
          )}
        </div>
      ) : null}
      {can('users:view') ? (
        <Link
          className="btn btn--primary btn--lg btn--block"
          to={`/users/${flag.user.userId}/trust`}
          state={{ name: flag.user.name }}
        >
          {canSuspend ? t('flags.panel.openProfileToSuspend') : t('flags.panel.openProfile')}
        </Link>
      ) : null}
      {canSuspend ? (
        <>
          <div className="decision-panel__divider" />
          <div className="form-field">
            <label htmlFor="flag-note">{t('flags.panel.noteLabel')}</label>
            <textarea
              id="flag-note"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {errorKey ? (
            <p className="banner banner--error" role="alert">
              {t(errorKey)}
            </p>
          ) : null}
          <div className="panel__row">
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => void close('actioned')}
            >
              {t('flags.panel.markActioned')}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => void close('dismissed')}
            >
              {t('flags.panel.dismiss')}
            </button>
          </div>
          <p className="panel__hint">{t('flags.panel.audited')}</p>
        </>
      ) : null}
    </DecisionPanel>
  );
}

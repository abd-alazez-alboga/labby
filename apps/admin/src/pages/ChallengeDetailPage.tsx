import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { endChallenge, getChallenge, type ChallengeDetail } from '../api/growth';
import { listRegions, type RegionSummary } from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useToast } from '../toast/ToastProvider';
import {
  BackLink,
  DataTable,
  DecisionPanel,
  KpiRow,
  KpiTile,
  PageHeader,
  ReviewLayout,
  StatusChip,
  TablePager,
} from '../ui';
import { formatMoment, formatNumber } from './money/money-format';
import { ConfirmRow, LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import {
  CHALLENGE_STATUS_TONES,
  challengeStatus,
  pointsGranted,
  windowLabel,
} from './growth/growth-format';

const PAGE_SIZE = 20;

/**
 * UC-A-28 — one challenge with its participation and the early end (artboard
 * "A13ChallengeDetail", owner-approved 2026-10-18): participants with live
 * progress, the Participants / Completed / Points-granted KPIs (points
 * granted = completions × reward — owner-approved deviation 2026-10-18), and
 * End early, which stops new progress while completions already made keep
 * their reward. Route-guarded by `challenges:view`; ending needs
 * `challenges:manage` and is audit-logged server-side.
 */
export default function ChallengeDetailPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();
  const { challengeId } = useParams<{ challengeId: string }>();
  const [params, setParams] = useSearchParams();
  const page = Math.max(0, Number(params.get('page')) || 0);

  const [result, setResult] = useState<ChallengeDetail | null>(null);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!challengeId) {
      return undefined;
    }
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    getChallenge(apiClient, challengeId, { page, size: PAGE_SIZE })
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
  }, [apiClient, challengeId, page, attempt]);

  useEffect(() => {
    let cancelled = false;
    listRegions(apiClient)
      .then((loaded) => {
        if (!cancelled) {
          setRegions(loaded);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  async function handleEnd() {
    if (!challengeId) {
      return;
    }
    setEnding(true);
    try {
      const updated = await endChallenge(apiClient, challengeId);
      setResult((current) => (current ? { ...current, challenge: updated } : current));
      toast.show({ tone: 'success', message: t('challenges.endedToast') });
    } catch (error) {
      toast.show({
        tone: 'error',
        message:
          error instanceof ApiError && error.code === 'already_ended'
            ? t('challenges.errors.alreadyEnded')
            : t('challenges.errors.endFailed'),
      });
    } finally {
      setEnding(false);
      setConfirming(false);
    }
  }

  if (loadError) {
    return (
      <section className="page">
        <PageHeader
          title={t('challenges.detailTitle')}
          leading={<BackLink to="/challenges">{t('challenges.title')}</BackLink>}
        />
        <LoadFailure
          kind={loadError}
          notFoundKey="challenges.errors.notFound"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </section>
    );
  }
  if (result === null) {
    return (
      <section className="page">
        <div className="loading">{t('common.loading')}</div>
      </section>
    );
  }

  const { challenge, participation } = result;
  const status = challengeStatus(challenge);
  const stoppable = can('challenges:manage') && (status === 'active' || status === 'scheduled');
  const regionName = regions.find((region) => region.id === challenge.regionId)?.name ?? '—';
  const title = language === 'ar' ? challenge.titleAr : challenge.titleEn;
  const lastPage = Math.max(0, Math.ceil(participation.totalItems / participation.size) - 1);

  return (
    <section className="page">
      <PageHeader
        title={title}
        leading={<BackLink to="/challenges">{t('challenges.title')}</BackLink>}
        meta={
          <StatusChip tone={CHALLENGE_STATUS_TONES[status]}>
            {t(`challenges.status.${status}`)}
          </StatusChip>
        }
        description={t('challenges.detailMeta', {
          who: t(`challenges.role.${challenge.role}`),
          region: regionName,
          goal: t(`challenges.goal.${challenge.goalType}`, { count: challenge.goalTarget }),
          window: windowLabel(challenge.startsAt, challenge.endsAt, language),
          points: formatNumber(challenge.rewardPoints, language),
        })}
      />

      <KpiRow>
        <KpiTile
          label={t('challenges.kpi.participants')}
          value={formatNumber(challenge.participantCount, language)}
        />
        <KpiTile
          label={t('challenges.kpi.completed')}
          value={formatNumber(challenge.completedCount, language)}
        />
        <KpiTile
          label={t('challenges.kpi.pointsGranted')}
          value={pointsGranted(challenge, language)}
          hint={t('challenges.kpi.pointsGrantedHint')}
        />
      </KpiRow>

      <ReviewLayout
        aside={
          stoppable ? (
            <DecisionPanel title={t('challenges.end.title')} label={t('challenges.end.title')}>
              <div className="banner banner--warning">
                <strong>{t('challenges.end.whatHappens')}</strong>
                <p>
                  {t('challenges.end.body', {
                    done: formatNumber(challenge.completedCount, language),
                    points: formatNumber(challenge.rewardPoints, language),
                  })}
                </p>
              </div>
              {confirming ? (
                <ConfirmRow
                  text={t('challenges.end.confirmText')}
                  confirmLabel={t('challenges.end.action')}
                  busy={ending}
                  destructive
                  onConfirm={() => void handleEnd()}
                  onCancel={() => setConfirming(false)}
                />
              ) : (
                <button
                  className="btn btn--danger"
                  type="button"
                  onClick={() => setConfirming(true)}
                >
                  {t('challenges.end.action')}
                </button>
              )}
              <p className="panel__hint">{t('challenges.end.footnote')}</p>
            </DecisionPanel>
          ) : undefined
        }
      >
        <DataTable
          isEmpty={participation.items.length === 0}
          empty={t('challenges.participationEmpty')}
          footer={
            participation.totalItems > participation.size ? (
              <TablePager
                status={t('money.pageOf', { page: page + 1, total: lastPage + 1 })}
                previousLabel={t('audit.previous')}
                nextLabel={t('audit.next')}
                canPrevious={page > 0}
                canNext={page < lastPage}
                onPrevious={() => {
                  const next = new URLSearchParams();
                  if (page - 1 > 0) {
                    next.set('page', String(page - 1));
                  }
                  setParams(next);
                }}
                onNext={() => {
                  const next = new URLSearchParams();
                  next.set('page', String(page + 1));
                  setParams(next);
                }}
              />
            ) : null
          }
        >
          <thead>
            <tr>
              <th>{t(`challenges.participantColumn.${challenge.role}`)}</th>
              <th>{t('challenges.columns.progress')}</th>
              <th>{t('challenges.columns.completedAt')}</th>
              <th>{t('challenges.columns.reward')}</th>
            </tr>
          </thead>
          <tbody>
            {participation.items.map((participant) => (
              <tr key={participant.userId}>
                <td dir="auto">{participant.userName ?? participant.userId.slice(0, 8)}</td>
                <td className="table__muted">
                  {t('challenges.progressOf', {
                    progress: formatNumber(participant.progress, language),
                    target: formatNumber(challenge.goalTarget, language),
                  })}
                </td>
                <td className="table__muted">
                  {participant.completedAt ? formatMoment(participant.completedAt, language) : '—'}
                </td>
                <td>
                  {participant.completed ? (
                    <StatusChip tone="success">
                      {t('challenges.rewardCredited', {
                        points: formatNumber(challenge.rewardPoints, language),
                      })}
                    </StatusChip>
                  ) : (
                    <span className="table__muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <p className="panel__hint">{t('challenges.detailFootnote')}</p>
      </ReviewLayout>
    </section>
  );
}

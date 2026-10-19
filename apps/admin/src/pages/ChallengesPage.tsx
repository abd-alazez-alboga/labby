import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  CHALLENGE_GOAL_TYPES,
  createChallenge,
  listChallenges,
  type Challenge,
  type ChallengeGoalType,
  type ChallengePage,
  type ChallengeRole,
} from '../api/growth';
import { listRegions, type RegionSummary } from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useToast } from '../toast/ToastProvider';
import { DataTable, DecisionPanel, PageHeader, ReviewLayout, StatusChip, TablePager } from '../ui';
import { formatNumber } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import {
  CHALLENGE_STATUS_TONES,
  challengeStatus,
  windowLabel,
  toIso,
} from './growth/growth-format';

const PAGE_SIZE = 20;

/**
 * UC-A-28 (GAME-02) — the challenges queue and the New challenge form
 * (artboard "A13Challenges", owner-approved 2026-10-18): every challenge with
 * its participation counters, and creation by role, region, window, goal and
 * reward points. Points reward the level only — never payouts (owner ruling
 * 2026-10-18). Route-guarded by `challenges:view`; creating needs
 * `challenges:manage` and is audit-logged server-side. The contract requires
 * a region per challenge (SaveChallengeRequest.regionId), so there is no
 * "all regions" option in the form.
 */
export default function ChallengesPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const page = Math.max(0, Number(params.get('page')) || 0);

  const [result, setResult] = useState<ChallengePage | null>(null);
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [role, setRole] = useState<ChallengeRole>('driver');
  const [regionId, setRegionId] = useState('');
  const [goalType, setGoalType] = useState<ChallengeGoalType>('completed_rides');
  const [goalTarget, setGoalTarget] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [rewardPoints, setRewardPoints] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    listChallenges(apiClient, { page, size: PAGE_SIZE })
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
  }, [apiClient, page, attempt]);

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

  function navigate(nextPage: number) {
    const next = new URLSearchParams();
    if (nextPage > 0) {
      next.set('page', String(nextPage));
    }
    setParams(next);
  }

  function regionName(id: string): string {
    return regions.find((region) => region.id === id)?.name ?? '—';
  }

  function goalLabel(challenge: Challenge): string {
    return t('challenges.goalReward', {
      goal: t(`challenges.goal.${challenge.goalType}`, { count: challenge.goalTarget }),
      points: formatNumber(challenge.rewardPoints, language),
    });
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const starts = toIso(startsAt);
    const ends = toIso(endsAt);
    if (!starts || !ends || Date.parse(ends) <= Date.parse(starts)) {
      setFormError('challenges.errors.window');
      return;
    }
    setSubmitting(true);
    try {
      await createChallenge(apiClient, {
        regionId,
        role,
        titleEn: titleEn.trim(),
        titleAr: titleAr.trim(),
        goalType,
        goalTarget: Math.max(1, Number(goalTarget) || 1),
        rewardPoints: Math.max(1, Number(rewardPoints) || 1),
        startsAt: starts,
        endsAt: ends,
      });
      toast.show({ tone: 'success', message: t('challenges.created', { title: titleEn.trim() }) });
      setTitleEn('');
      setTitleAr('');
      setGoalTarget('');
      setRewardPoints('');
      setStartsAt('');
      setEndsAt('');
      navigate(0);
      setAttempt((n) => n + 1);
    } catch (error) {
      setFormError(
        error instanceof ApiError && (error.code === 'window_invalid' || error.status === 422)
          ? 'challenges.errors.window'
          : 'challenges.errors.generic',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const canManage = can('challenges:manage');
  const lastPage = result ? Math.max(0, Math.ceil(result.totalItems / result.size) - 1) : 0;

  const table = loadError ? (
    <LoadFailure
      kind={loadError}
      notFoundKey="review.errors.server"
      onRetry={() => setAttempt((n) => n + 1)}
    />
  ) : result === null ? (
    <div className="loading">{t('common.loading')}</div>
  ) : (
    <>
      <DataTable
        isEmpty={result.items.length === 0}
        empty={t('challenges.empty')}
        footer={
          result.totalItems > result.size ? (
            <TablePager
              status={t('money.pageOf', { page: page + 1, total: lastPage + 1 })}
              previousLabel={t('audit.previous')}
              nextLabel={t('audit.next')}
              canPrevious={page > 0}
              canNext={page < lastPage}
              onPrevious={() => navigate(page - 1)}
              onNext={() => navigate(page + 1)}
            />
          ) : null
        }
      >
        <thead>
          <tr>
            <th>{t('challenges.columns.challenge')}</th>
            <th>{t('challenges.columns.who')}</th>
            <th>{t('challenges.columns.goal')}</th>
            <th>{t('challenges.columns.window')}</th>
            <th>{t('challenges.columns.participation')}</th>
            <th>{t('challenges.columns.status')}</th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((challenge) => {
            const status = challengeStatus(challenge);
            return (
              <tr key={challenge.challengeId}>
                <td>
                  <Link
                    className="table__link"
                    to={`/challenges/${challenge.challengeId}`}
                    dir="auto"
                  >
                    {language === 'ar' ? challenge.titleAr : challenge.titleEn}
                  </Link>
                </td>
                <td className="table__muted">
                  {t(`challenges.role.${challenge.role}`)} · {regionName(challenge.regionId)}
                </td>
                <td className="table__muted">{goalLabel(challenge)}</td>
                <td className="table__muted">
                  {windowLabel(challenge.startsAt, challenge.endsAt, language)}
                </td>
                <td className="table__muted">
                  {t('challenges.participation', {
                    joined: formatNumber(challenge.participantCount, language),
                    done: formatNumber(challenge.completedCount, language),
                  })}
                </td>
                <td>
                  <StatusChip tone={CHALLENGE_STATUS_TONES[status]}>
                    {t(`challenges.status.${status}`)}
                  </StatusChip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      <p className="panel__hint">{t('challenges.footnote')}</p>
    </>
  );

  return (
    <section className="page">
      <PageHeader title={t('challenges.title')} description={t('challenges.subtitle')} />
      <ReviewLayout
        aside={
          canManage ? (
            <DecisionPanel title={t('challenges.form.title')} label={t('challenges.form.title')}>
              <form className="panel" onSubmit={(event) => void handleCreate(event)}>
                {formError ? (
                  <p className="banner banner--error" role="alert">
                    {t(formError)}
                  </p>
                ) : null}
                <div className="form-field">
                  <label htmlFor="challenge-title-en">{t('challenges.form.nameEn')}</label>
                  <input
                    id="challenge-title-en"
                    value={titleEn}
                    onChange={(event) => setTitleEn(event.target.value)}
                    required
                    maxLength={120}
                    disabled={submitting}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="challenge-title-ar">{t('challenges.form.nameAr')}</label>
                  <input
                    id="challenge-title-ar"
                    value={titleAr}
                    onChange={(event) => setTitleAr(event.target.value)}
                    required
                    maxLength={120}
                    dir="rtl"
                    lang="ar"
                    disabled={submitting}
                  />
                </div>
                <div className="panel__row">
                  <div className="form-field">
                    <label htmlFor="challenge-role">{t('challenges.form.who')}</label>
                    <select
                      id="challenge-role"
                      value={role}
                      onChange={(event) => setRole(event.target.value as ChallengeRole)}
                      disabled={submitting}
                    >
                      <option value="driver">{t('challenges.role.driver')}</option>
                      <option value="rider">{t('challenges.role.rider')}</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="challenge-region">{t('challenges.form.region')}</label>
                    <select
                      id="challenge-region"
                      value={regionId}
                      onChange={(event) => setRegionId(event.target.value)}
                      required
                      disabled={submitting}
                    >
                      <option value="">{t('challenges.form.pickRegion')}</option>
                      {regions.map((region) => (
                        <option key={region.id} value={region.id}>
                          {region.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="panel__row">
                  <div className="form-field">
                    <label htmlFor="challenge-goal">{t('challenges.form.goal')}</label>
                    <select
                      id="challenge-goal"
                      value={goalType}
                      onChange={(event) => setGoalType(event.target.value as ChallengeGoalType)}
                      disabled={submitting}
                    >
                      {CHALLENGE_GOAL_TYPES.map((option) => (
                        <option key={option} value={option}>
                          {t(`challenges.goalType.${option}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="challenge-count">{t('challenges.form.count')}</label>
                    <input
                      id="challenge-count"
                      value={goalTarget}
                      onChange={(event) => setGoalTarget(event.target.value)}
                      required
                      inputMode="numeric"
                      type="number"
                      min="1"
                      disabled={submitting}
                    />
                  </div>
                </div>
                <div className="panel__row">
                  <div className="form-field">
                    <label htmlFor="challenge-starts">{t('challenges.form.from')}</label>
                    <input
                      id="challenge-starts"
                      type="datetime-local"
                      value={startsAt}
                      onChange={(event) => setStartsAt(event.target.value)}
                      required
                      disabled={submitting}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="challenge-ends">{t('challenges.form.to')}</label>
                    <input
                      id="challenge-ends"
                      type="datetime-local"
                      value={endsAt}
                      onChange={(event) => setEndsAt(event.target.value)}
                      required
                      disabled={submitting}
                    />
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="challenge-reward">{t('challenges.form.reward')}</label>
                  <input
                    id="challenge-reward"
                    value={rewardPoints}
                    onChange={(event) => setRewardPoints(event.target.value)}
                    required
                    inputMode="numeric"
                    type="number"
                    min="1"
                    disabled={submitting}
                  />
                </div>
                <button className="btn btn--primary" type="submit" disabled={submitting}>
                  {submitting ? t('review.working') : t('challenges.form.submit')}
                </button>
              </form>
            </DecisionPanel>
          ) : undefined
        }
      >
        {table}
      </ReviewLayout>
    </section>
  );
}

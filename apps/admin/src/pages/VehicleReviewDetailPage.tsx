import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import {
  approveVehicleReview,
  getVehicleReview,
  rejectVehicleReview,
  type FileRef,
  type VehicleReview,
} from '../api/onboarding';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { Avatar, BackLink, DecisionPanel, PageHeader, ReviewLayout } from '../ui';
import { ApproveForm } from './onboarding/ApproveForm';
import {
  DocumentCard,
  DuplicatePlateBanner,
  LoadFailure,
  RejectForm,
  StaleFilesBanner,
  VehicleCard,
} from './onboarding/ReviewUi';
import {
  anyExpired,
  classifyError,
  decisionFailureKey,
  type ConflictDiagnosis,
  type FailureKind,
} from './onboarding/review-utils';
import { useReviewResource } from './onboarding/useReviewResource';

type Mode = 'none' | 'approve' | 'reject';

function reviewFiles(review: VehicleReview): FileRef[] {
  return [
    ...review.vehicle.photos,
    ...review.vehicle.documents.map((document) => document.file),
    ...(review.currentVehicle?.photos ?? []),
  ];
}

/** Plain-words reason for a refused (409) switch decision, from the current server state. */
function diagnoseConflict(
  action: 'approve' | 'reject',
  fresh: VehicleReview | null,
  refetchFailure: FailureKind | null,
): ConflictDiagnosis {
  if (refetchFailure === 'notFound') {
    return { key: 'review.conflict.decidedSwitch' };
  }
  if (!fresh) {
    return { key: 'review.conflict.generic' };
  }
  if (fresh.vehicle.reviewStatus !== 'pending') {
    return {
      key: 'review.conflict.decidedItem',
      stateKey: `review.itemStatus.${fresh.vehicle.reviewStatus}`,
    };
  }
  if (action === 'approve' && fresh.duplicatePlate) {
    return { key: 'review.conflict.duplicatePlate' };
  }
  if (action === 'approve' && anyExpired(fresh.vehicle.documents)) {
    return { key: 'review.conflict.expired' };
  }
  return { key: 'review.conflict.generic' };
}

/**
 * UC-A-11: one vehicle switch — the new vehicle with its registration and
 * insurance beside the driver's current active vehicle — and the decision:
 * approve (assign service types; the new vehicle becomes the single active
 * one) or reject with a reason (the driver keeps the current vehicle).
 * Viewing needs driver-review:view; deciding needs driver-review:decide.
 */
export default function VehicleReviewDetailPage() {
  const { t } = useTranslation();
  const { vehicleId = '' } = useParams<{ vehicleId: string }>();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canDecide = can('driver-review:decide');

  const load = useCallback(() => getVehicleReview(apiClient, vehicleId), [apiClient, vehicleId]);
  const resource = useReviewResource(load, reviewFiles);
  const review = resource.data;

  const [mode, setMode] = useState<Mode>('none');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ConflictDiagnosis | null>(null);

  async function decide(action: 'approve' | 'reject', run: () => Promise<VehicleReview>) {
    setBusy(true);
    setNotice(null);
    setFailure(null);
    try {
      resource.replace(await run());
      setMode('none');
      setNotice(`vehicleReviews.detail.success.${action}`);
    } catch (error) {
      const kind = classifyError(error);
      if (kind === 'conflict') {
        const result = await resource.refetch();
        setFailure(
          diagnoseConflict(
            action,
            'data' in result ? result.data : null,
            'error' in result ? classifyError(result.error) : null,
          ),
        );
        setMode('none');
      } else if (kind === 'validation' && action === 'approve') {
        setFailure({ key: 'review.decisionErrors.serviceTypes' });
      } else {
        setFailure({ key: decisionFailureKey(kind) });
      }
    } finally {
      setBusy(false);
    }
  }

  const backLink = <BackLink to="/vehicle-reviews">{t('vehicleReviews.detail.back')}</BackLink>;

  if (resource.loadError) {
    return (
      <section className="page">
        {backLink}
        <LoadFailure
          kind={resource.loadError}
          notFoundKey="vehicleReviews.detail.notFound"
          onRetry={resource.reload}
        />
      </section>
    );
  }
  if (review === null) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  const refresh = resource.refreshFiles;
  const pending = review.vehicle.reviewStatus === 'pending';
  const conflictClosed =
    failure?.key === 'review.conflict.decidedSwitch' ||
    failure?.key === 'review.conflict.decidedItem';
  const showDecision = canDecide && pending && !conflictClosed;

  return (
    <section className="page">
      {backLink}
      <PageHeader
        leading={<Avatar name={review.driver.name} size="lg" />}
        title={t('vehicleReviews.detail.title', { name: review.driver.name })}
        description={<span dir="ltr">{review.driver.phone}</span>}
      />

      {review.duplicatePlate ? <DuplicatePlateBanner /> : null}
      {notice ? (
        <p className="banner banner--success" role="status">
          {t(notice)}
        </p>
      ) : null}
      {failure ? (
        <p className="banner banner--error" role="alert">
          {t(failure.key, { state: failure.stateKey ? t(failure.stateKey) : '' })}
        </p>
      ) : null}
      {resource.filesStale ? <StaleFilesBanner onRefresh={refresh} /> : null}

      <ReviewLayout
        aside={
          showDecision ? (
            <DecisionPanel title={t('vehicleReviews.detail.decisionTitle')}>
              <div className="decision-panel__actions">
                <button
                  className="btn btn--primary btn--lg btn--block"
                  type="button"
                  aria-pressed={mode === 'approve'}
                  disabled={review.duplicatePlate}
                  onClick={() => setMode(mode === 'approve' ? 'none' : 'approve')}
                >
                  {t('vehicleReviews.detail.approve')}
                </button>
                <button
                  className="btn btn--danger-text btn--block"
                  type="button"
                  aria-pressed={mode === 'reject'}
                  onClick={() => setMode(mode === 'reject' ? 'none' : 'reject')}
                >
                  {t('vehicleReviews.detail.reject')}
                </button>
              </div>
              {review.duplicatePlate ? (
                <p className="panel__hint">{t('vehicleReviews.detail.approveBlockedDuplicate')}</p>
              ) : null}
              {mode === 'approve' && !review.duplicatePlate ? (
                <ApproveForm
                  idPrefix="vehicle"
                  hint={t('vehicleReviews.detail.approveHint')}
                  confirmText={t('vehicleReviews.detail.approveConfirm', {
                    name: review.driver.name,
                  })}
                  warning={
                    anyExpired(review.vehicle.documents)
                      ? t('applications.detail.expiredWarning')
                      : null
                  }
                  busy={busy}
                  onCancel={() => setMode('none')}
                  onSubmit={(serviceTypeIds) =>
                    void decide('approve', () =>
                      approveVehicleReview(apiClient, review.vehicle.id, { serviceTypeIds }),
                    )
                  }
                />
              ) : null}
              {mode === 'reject' ? (
                <RejectForm
                  idPrefix="vehicle"
                  hint={t('vehicleReviews.detail.rejectHint')}
                  confirmText={t('vehicleReviews.detail.rejectConfirm', {
                    name: review.driver.name,
                  })}
                  busy={busy}
                  onCancel={() => setMode('none')}
                  onSubmit={(reason) =>
                    void decide('reject', () =>
                      rejectVehicleReview(apiClient, review.vehicle.id, { reason }),
                    )
                  }
                />
              ) : null}
            </DecisionPanel>
          ) : null
        }
      >
        <div className="compare">
          <div className="compare__column">
            <h2 className="compare__heading">{t('vehicleReviews.detail.newVehicle')}</h2>
            <VehicleCard
              vehicle={review.vehicle}
              heading={t('vehicleReviews.detail.newVehicle')}
              onExpired={refresh}
            />
            {review.vehicle.documents.length > 0 ? (
              <div className="review-grid">
                {review.vehicle.documents.map((document) => (
                  <DocumentCard key={document.id} document={document} onExpired={refresh} />
                ))}
              </div>
            ) : null}
          </div>
          <div className="compare__column">
            <h2 className="compare__heading">{t('vehicleReviews.detail.currentVehicle')}</h2>
            {review.currentVehicle ? (
              <VehicleCard
                vehicle={review.currentVehicle}
                heading={t('vehicleReviews.detail.currentVehicle')}
                onExpired={refresh}
              />
            ) : (
              <p className="banner banner--info">{t('vehicleReviews.detail.noCurrentVehicle')}</p>
            )}
          </div>
        </div>
      </ReviewLayout>
    </section>
  );
}

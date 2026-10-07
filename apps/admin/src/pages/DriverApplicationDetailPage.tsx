import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import {
  approveApplication,
  getApplication,
  rejectApplication,
  requestChanges,
  startReview,
  type AdminDriverApplication,
  type ApplicationStatus,
  type FileRef,
  type RequestChangesRequest,
} from '../api/onboarding';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { Avatar, BackLink, DecisionPanel, PageHeader, ReviewLayout, Section } from '../ui';
import { ApproveForm } from './onboarding/ApproveForm';
import { RequestChangesForm } from './onboarding/RequestChangesForm';
import {
  ApplicationStatusChip,
  DocumentCard,
  DuplicatePlateBanner,
  FileView,
  LoadFailure,
  RejectForm,
  ReviewStatusChip,
  StaleFilesBanner,
  VehicleCard,
} from './onboarding/ReviewUi';
import {
  anyExpired,
  classifyError,
  decisionFailureKey,
  formatDateTime,
  type ConflictDiagnosis,
} from './onboarding/review-utils';
import { useReviewResource } from './onboarding/useReviewResource';

type Mode = 'none' | 'changes' | 'approve' | 'reject';
type Action = 'start' | 'changes' | 'approve' | 'reject';

function applicationFiles(application: AdminDriverApplication): FileRef[] {
  return [
    ...(application.personal.photo ? [application.personal.photo] : []),
    ...application.documents.map((document) => document.file),
    ...application.vehicle.photos,
  ];
}

/**
 * Explains a refused (409) decision in plain words from the CURRENT server
 * state — the contract's 409 has no machine-readable reason, so the page
 * refetches and tells apart: another reviewer already moved the
 * application, the duplicate plate is unresolved, or a document expired.
 */
function diagnoseConflict(action: Action, fresh: AdminDriverApplication | null): ConflictDiagnosis {
  if (!fresh) {
    return { key: 'review.conflict.generic' };
  }
  const expected: ApplicationStatus = action === 'start' ? 'submitted' : 'under_review';
  if (fresh.status !== expected) {
    return {
      key: 'review.conflict.decidedApplication',
      stateKey: `review.applicationStatus.${fresh.status}`,
    };
  }
  if (action === 'approve' && fresh.duplicatePlate) {
    return { key: 'review.conflict.duplicatePlate' };
  }
  if (action === 'approve' && anyExpired(fresh.documents)) {
    return { key: 'review.conflict.expired' };
  }
  return { key: 'review.conflict.generic' };
}

const SUCCESS_KEYS: Record<Action, string> = {
  start: 'applications.detail.success.start',
  changes: 'applications.detail.success.changes',
  approve: 'applications.detail.success.approve',
  reject: 'applications.detail.success.reject',
};

/**
 * UC-A-10 steps 2–3: one application with every reviewable item (personal,
 * the four documents, the vehicle), its stage history, the duplicate-plate
 * flag, and the decisions. Viewing needs driver-review:view (route guard);
 * every decision control needs driver-review:decide (RBAC-03 — the server
 * enforces regardless). Approve and reject are confirmed first.
 */
export default function DriverApplicationDetailPage() {
  const { t, i18n } = useTranslation();
  const { applicationId = '' } = useParams<{ applicationId: string }>();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canDecide = can('driver-review:decide');

  const load = useCallback(
    () => getApplication(apiClient, applicationId),
    [apiClient, applicationId],
  );
  const resource = useReviewResource(load, applicationFiles);
  const application = resource.data;

  const [mode, setMode] = useState<Mode>('none');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ConflictDiagnosis | null>(null);

  async function decide(action: Action, run: () => Promise<AdminDriverApplication>) {
    setBusy(true);
    setNotice(null);
    setFailure(null);
    try {
      resource.replace(await run());
      setMode('none');
      setNotice(SUCCESS_KEYS[action]);
    } catch (error) {
      const kind = classifyError(error);
      if (kind === 'conflict') {
        const result = await resource.refetch();
        setFailure(diagnoseConflict(action, 'data' in result ? result.data : null));
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

  const backLink = <BackLink to="/driver-applications">{t('applications.detail.back')}</BackLink>;

  if (resource.loadError) {
    return (
      <section className="page">
        {backLink}
        <LoadFailure
          kind={resource.loadError}
          notFoundKey="applications.detail.notFound"
          onRetry={resource.reload}
        />
      </section>
    );
  }
  if (application === null) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  const refresh = resource.refreshFiles;
  const expiredDocument = anyExpired(application.documents);

  const decision = canDecide ? (
    <>
      {application.status === 'submitted' ? (
        <div className="decision-panel__actions">
          <button
            className="btn btn--primary btn--lg btn--block"
            type="button"
            disabled={busy}
            onClick={() => void decide('start', () => startReview(apiClient, application.id))}
          >
            {busy ? t('review.working') : t('applications.detail.startReview')}
          </button>
          <p className="panel__hint">{t('applications.detail.startReviewHint')}</p>
        </div>
      ) : application.status === 'under_review' ? (
        <>
          <div className="decision-panel__actions">
            <button
              className="btn btn--primary btn--lg btn--block"
              type="button"
              aria-pressed={mode === 'changes'}
              onClick={() => setMode(mode === 'changes' ? 'none' : 'changes')}
            >
              {t('applications.detail.requestChanges')}
            </button>
            <button
              className="btn btn--lg btn--block"
              type="button"
              aria-pressed={mode === 'approve'}
              disabled={application.duplicatePlate}
              onClick={() => setMode(mode === 'approve' ? 'none' : 'approve')}
            >
              {t('applications.detail.approve')}
            </button>
            <button
              className="btn btn--danger-text btn--block"
              type="button"
              aria-pressed={mode === 'reject'}
              onClick={() => setMode(mode === 'reject' ? 'none' : 'reject')}
            >
              {t('applications.detail.reject')}
            </button>
          </div>
          {application.duplicatePlate ? (
            <p className="panel__hint">{t('applications.detail.approveBlockedDuplicate')}</p>
          ) : null}

          {mode === 'changes' ? (
            <RequestChangesForm
              busy={busy}
              onCancel={() => setMode('none')}
              onSubmit={(body: RequestChangesRequest) =>
                void decide('changes', () => requestChanges(apiClient, application.id, body))
              }
            />
          ) : null}
          {mode === 'approve' && !application.duplicatePlate ? (
            <ApproveForm
              idPrefix="application"
              hint={t('applications.detail.approveHint')}
              confirmText={t('applications.detail.approveConfirm', {
                name: application.applicant.name,
              })}
              warning={expiredDocument ? t('applications.detail.expiredWarning') : null}
              busy={busy}
              onCancel={() => setMode('none')}
              onSubmit={(serviceTypeIds) =>
                void decide('approve', () =>
                  approveApplication(apiClient, application.id, { serviceTypeIds }),
                )
              }
            />
          ) : null}
          {mode === 'reject' ? (
            <RejectForm
              idPrefix="application"
              hint={t('applications.detail.rejectHint')}
              confirmText={t('applications.detail.rejectConfirm', {
                name: application.applicant.name,
              })}
              busy={busy}
              onCancel={() => setMode('none')}
              onSubmit={(reason) =>
                void decide('reject', () =>
                  rejectApplication(apiClient, application.id, { reason }),
                )
              }
            />
          ) : null}
        </>
      ) : (
        <p className="panel__hint">{t(`applications.detail.noDecision.${application.status}`)}</p>
      )}
      <div className="decision-panel__divider" />
    </>
  ) : null;

  const history = (
    <>
      {canDecide ? (
        <h3 className="decision-panel__subtitle">{t('applications.detail.history')}</h3>
      ) : null}
      {application.history.length === 0 ? (
        <p className="panel__hint">{t('applications.detail.noHistory')}</p>
      ) : (
        <ol className="timeline">
          {application.history.map((event, index) => (
            <li key={`${event.at}-${index}`} className="timeline__item">
              <span>
                {event.fromStatus ? (
                  <>
                    <ApplicationStatusChip status={event.fromStatus} />{' '}
                    <span aria-hidden="true">{i18n.dir() === 'rtl' ? '←' : '→'}</span>{' '}
                  </>
                ) : null}
                <ApplicationStatusChip status={event.toStatus} />
              </span>
              <span className="timeline__when">{formatDateTime(event.at, i18n.language)}</span>
              {event.note ? <span className="timeline__note">{event.note}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );

  return (
    <section className="page">
      {backLink}
      <PageHeader
        leading={<Avatar name={application.applicant.name} size="lg" />}
        title={<span dir="auto">{application.applicant.name}</span>}
        description={
          <>
            <span dir="ltr">{application.applicant.phone}</span>
            {' · '}
            {t('applications.detail.submitted', {
              at: formatDateTime(application.submittedAt, i18n.language),
            })}
            {application.decidedAt ? (
              <>
                {' · '}
                {t('applications.detail.decided', {
                  at: formatDateTime(application.decidedAt, i18n.language),
                })}
              </>
            ) : null}
          </>
        }
        meta={<ApplicationStatusChip status={application.status} />}
      />

      {application.duplicatePlate ? <DuplicatePlateBanner /> : null}
      {application.status === 'rejected' && application.rejectionReason ? (
        <p className="banner banner--info">
          {t('applications.detail.rejectionReason', { reason: application.rejectionReason })}
        </p>
      ) : null}
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
          // Without driver-review:decide the panel only carries the history.
          <DecisionPanel
            title={
              canDecide ? t('applications.detail.decisionTitle') : t('applications.detail.history')
            }
          >
            {decision}
            {history}
          </DecisionPanel>
        }
      >
        <Section title={t('applications.detail.documents')}>
          <div className="review-grid">
            {application.documents.map((document) => (
              <DocumentCard key={document.id} document={document} onExpired={refresh} />
            ))}
          </div>
        </Section>

        <VehicleCard
          vehicle={application.vehicle}
          heading={t('review.items.vehicle')}
          onExpired={refresh}
        />

        <article className="card review-item" aria-label={t('review.items.personal')}>
          <header className="review-item__header">
            <h2 className="review-item__title">{t('review.items.personal')}</h2>
            <ReviewStatusChip status={application.personal.reviewStatus} />
          </header>
          <p className="person__name" dir="auto">
            {application.personal.name}
          </p>
          {application.personal.photo ? (
            <FileView
              key={application.personal.photo.fileId}
              file={application.personal.photo}
              label={t('applications.detail.profilePhoto')}
              onExpired={refresh}
            />
          ) : (
            <p className="panel__hint">{t('applications.detail.noProfilePhoto')}</p>
          )}
          {application.personal.reviewNote ? (
            <p className="review-item__note">
              {t('review.fields.reviewNote')}: {application.personal.reviewNote}
            </p>
          ) : null}
        </article>
      </ReviewLayout>
    </section>
  );
}

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import {
  approveRenewal,
  getRenewal,
  rejectRenewal,
  type DocumentRenewal,
  type FileRef,
} from '../api/onboarding';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import {
  ApplicantCell,
  ConfirmRow,
  DocumentCard,
  LoadFailure,
  RejectForm,
  StaleFilesBanner,
} from './onboarding/ReviewUi';
import {
  classifyError,
  decisionFailureKey,
  isExpired,
  type ConflictDiagnosis,
  type FailureKind,
} from './onboarding/review-utils';
import { useReviewResource } from './onboarding/useReviewResource';

type Mode = 'none' | 'approve' | 'reject';

function renewalFiles(item: DocumentRenewal): FileRef[] {
  return [item.renewal.file, item.current.file];
}

/** Plain-words reason for a refused (409) renewal decision, from the current server state. */
function diagnoseConflict(
  fresh: DocumentRenewal | null,
  refetchFailure: FailureKind | null,
): ConflictDiagnosis {
  if (refetchFailure === 'notFound') {
    return { key: 'review.conflict.decidedRenewal' };
  }
  if (!fresh) {
    return { key: 'review.conflict.generic' };
  }
  if (fresh.renewal.reviewStatus !== 'pending') {
    return {
      key: 'review.conflict.decidedItem',
      stateKey: `review.itemStatus.${fresh.renewal.reviewStatus}`,
    };
  }
  if (isExpired(fresh.renewal.expiresOn)) {
    return { key: 'review.conflict.renewalExpired' };
  }
  return { key: 'review.conflict.generic' };
}

/**
 * UC-A-12 renewal review: the renewed document beside the one it replaces.
 * Approving replaces the current document (it becomes `superseded`) and —
 * server-side — lifts an expiry suspension once no current document is
 * expired; rejecting needs a reason and keeps the current document.
 * Viewing needs driver-review:view; deciding needs driver-review:decide.
 */
export default function DocumentRenewalDetailPage() {
  const { t } = useTranslation();
  const { documentId = '' } = useParams<{ documentId: string }>();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canDecide = can('driver-review:decide');

  const load = useCallback(() => getRenewal(apiClient, documentId), [apiClient, documentId]);
  const resource = useReviewResource(load, renewalFiles);
  const item = resource.data;

  const [mode, setMode] = useState<Mode>('none');
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [failure, setFailure] = useState<ConflictDiagnosis | null>(null);

  async function decide(action: 'approve' | 'reject', run: () => Promise<DocumentRenewal>) {
    const wasSuspended = item?.driverSuspended ?? false;
    setBusy(true);
    setNotices([]);
    setFailure(null);
    try {
      const updated = await run();
      resource.replace(updated);
      setMode('none');
      const next = [`renewals.detail.success.${action}`];
      if (action === 'approve' && wasSuspended) {
        next.push(
          updated.driverSuspended
            ? 'renewals.detail.stillSuspended'
            : 'renewals.detail.suspensionLifted',
        );
      }
      setNotices(next);
    } catch (error) {
      const kind = classifyError(error);
      if (kind === 'conflict') {
        const result = await resource.refetch();
        setFailure(
          diagnoseConflict(
            'data' in result ? result.data : null,
            'error' in result ? classifyError(result.error) : null,
          ),
        );
        setMode('none');
      } else {
        setFailure({ key: decisionFailureKey(kind) });
      }
    } finally {
      setBusy(false);
    }
  }

  const backLink = (
    <p className="page__subtitle">
      <Link to="/document-expiries">{t('renewals.detail.back')}</Link>
    </p>
  );

  if (resource.loadError) {
    return (
      <section>
        {backLink}
        <LoadFailure
          kind={resource.loadError}
          notFoundKey="renewals.detail.notFound"
          onRetry={resource.reload}
        />
      </section>
    );
  }
  if (item === null) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  const refresh = resource.refreshFiles;
  const typeLabel = t(`review.documentType.${item.renewal.type}`);
  const pending = item.renewal.reviewStatus === 'pending';
  const conflictClosed =
    failure?.key === 'review.conflict.decidedRenewal' ||
    failure?.key === 'review.conflict.decidedItem';

  return (
    <section>
      {backLink}
      <h1 className="page__title">{t('renewals.detail.title', { document: typeLabel })}</h1>
      <div className="summary-row">
        <ApplicantCell person={item.driver} />
        {item.driverSuspended ? (
          <span className="chip chip--flag">{t('expiries.suspendedChip')}</span>
        ) : null}
      </div>

      {notices.map((key) => (
        <p key={key} className="banner banner--success" role="status">
          {t(key)}
        </p>
      ))}
      {failure ? (
        <p className="banner banner--error" role="alert">
          {t(failure.key, { state: failure.stateKey ? t(failure.stateKey) : '' })}
        </p>
      ) : null}
      {resource.filesStale ? <StaleFilesBanner onRefresh={refresh} /> : null}

      {canDecide && pending && !conflictClosed ? (
        <div className="card panel decision-bar">
          <h2 className="panel__title">{t('renewals.detail.decisionTitle')}</h2>
          <p className="panel__hint">{t('renewals.detail.approveHint')}</p>
          <div className="panel__row">
            <button
              className="btn btn--primary"
              type="button"
              aria-pressed={mode === 'approve'}
              onClick={() => setMode(mode === 'approve' ? 'none' : 'approve')}
            >
              {t('renewals.detail.approve')}
            </button>
            <button
              className="btn"
              type="button"
              aria-pressed={mode === 'reject'}
              onClick={() => setMode(mode === 'reject' ? 'none' : 'reject')}
            >
              {t('renewals.detail.reject')}
            </button>
          </div>
          {mode === 'approve' ? (
            <ConfirmRow
              text={t('renewals.detail.approveConfirm', {
                document: typeLabel,
                name: item.driver.name,
              })}
              confirmLabel={t('review.approve.confirm')}
              busy={busy}
              onConfirm={() =>
                void decide('approve', () => approveRenewal(apiClient, item.renewal.id))
              }
              onCancel={() => setMode('none')}
            />
          ) : null}
          {mode === 'reject' ? (
            <RejectForm
              idPrefix="renewal"
              hint={t('renewals.detail.rejectHint')}
              confirmText={t('renewals.detail.rejectConfirm', {
                document: typeLabel,
                name: item.driver.name,
              })}
              busy={busy}
              onCancel={() => setMode('none')}
              onSubmit={(reason) =>
                void decide('reject', () => rejectRenewal(apiClient, item.renewal.id, { reason }))
              }
            />
          ) : null}
        </div>
      ) : null}

      <div className="compare">
        <div className="compare__column">
          <h2 className="section__title">{t('renewals.detail.renewal')}</h2>
          <DocumentCard
            document={item.renewal}
            heading={t('renewals.detail.renewal')}
            onExpired={refresh}
          />
        </div>
        <div className="compare__column">
          <h2 className="section__title">{t('renewals.detail.current')}</h2>
          <DocumentCard
            document={item.current}
            heading={t('renewals.detail.current')}
            onExpired={refresh}
          />
        </div>
      </div>
    </section>
  );
}

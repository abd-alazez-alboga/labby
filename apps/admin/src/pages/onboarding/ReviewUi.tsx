import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  Applicant,
  ApplicationStatus,
  DriverDocument,
  FileRef,
  ReviewStatus,
  Vehicle,
} from '../../api/onboarding';
import { resolveFileUrl } from '../../api/onboarding';
import { useConfig } from '../../config/ConfigContext';
import { formatDateTime, isExpired, serviceTypeName, type FailureKind } from './review-utils';

/** Application stage chip (DRV-02 state machine). */
export function ApplicationStatusChip({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation();
  return <span className={`chip chip--${status}`}>{t(`review.applicationStatus.${status}`)}</span>;
}

/** Per-item review chip (personal, document, vehicle). */
export function ReviewStatusChip({ status }: { status: ReviewStatus }) {
  const { t } = useTranslation();
  return <span className={`chip chip--${status}`}>{t(`review.itemStatus.${status}`)}</span>;
}

/** The "plate already on another driver's active vehicle" flag (UC-A-10 E1). */
export function DuplicatePlateChip() {
  const { t } = useTranslation();
  return <span className="chip chip--flag">{t('review.duplicatePlate.chip')}</span>;
}

export function DuplicatePlateBanner() {
  const { t } = useTranslation();
  return (
    <div className="banner banner--error" role="alert">
      <strong>{t('review.duplicatePlate.title')}</strong> {t('review.duplicatePlate.body')}
    </div>
  );
}

/** Name + phone; the phone stays LTR inside Arabic text. */
export function ApplicantCell({ person }: { person: Applicant }) {
  return (
    <span className="person">
      <span>{person.name}</span>
      <span className="person__phone" dir="ltr">
        {person.phone}
      </span>
    </span>
  );
}

/**
 * Load/decision failure banner with plain-language copy: network trouble
 * (nothing reached the server) is told apart from a server fault.
 */
export function LoadFailure({
  kind,
  notFoundKey,
  onRetry,
}: {
  kind: FailureKind;
  notFoundKey: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const key =
    kind === 'notFound'
      ? notFoundKey
      : kind === 'network'
        ? 'review.errors.network'
        : kind === 'forbidden'
          ? 'review.errors.forbidden'
          : 'review.errors.server';
  return (
    <div className="banner banner--error" role="alert">
      <span>{t(key)}</span>
      {onRetry && kind !== 'notFound' && kind !== 'forbidden' ? (
        <>
          {' '}
          <button className="btn btn--small" type="button" onClick={onRetry}>
            {t('review.retry')}
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * One private file behind its expiring URL (NFR-S2). Images render inline
 * (`<img src>` — the signed token is the capability, no Authorization
 * header); PDFs open in a new tab. The first load failure asks the owner
 * page for fresh URLs (an expired token is a plain 404); a failure on the
 * fresh URL too shows "unavailable" instead of looping.
 */
export function FileView({
  file,
  label,
  onExpired,
}: {
  file: FileRef;
  label: string;
  onExpired: () => void;
}) {
  const { t } = useTranslation();
  const { apiBaseUrl } = useConfig();
  const [failure, setFailure] = useState<{ count: number; url: string | null }>({
    count: 0,
    url: null,
  });
  const src = resolveFileUrl(file.url, apiBaseUrl);

  if (failure.count >= 2) {
    return <span className="file-view file-view--missing">{t('review.files.unavailable')}</span>;
  }

  if (file.contentType === 'application/pdf') {
    return (
      <a
        className="btn btn--small file-view"
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('review.files.openPdf', { label })}
      >
        {t('review.files.pdf')}
      </a>
    );
  }

  function handleError() {
    if (failure.url === file.url) {
      return;
    }
    setFailure({ count: failure.count + 1, url: file.url });
    if (failure.count === 0) {
      onExpired();
    }
  }

  return (
    <a className="file-view" href={src} target="_blank" rel="noopener noreferrer">
      <img className="file-view__img" src={src} alt={label} onError={handleError} />
    </a>
  );
}

/** Shown when a silent URL refresh failed — links on screen may be dead. */
export function StaleFilesBanner({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="banner banner--error" role="alert">
      <span>{t('review.files.stale')}</span>{' '}
      <button className="btn btn--small" type="button" onClick={onRefresh}>
        {t('review.files.refresh')}
      </button>
    </div>
  );
}

/** One document: type, number, expiry (flagged once past), file, review state + note. */
export function DocumentCard({
  document,
  onExpired,
  heading,
}: {
  document: DriverDocument;
  onExpired: () => void;
  heading?: string;
}) {
  const { t, i18n } = useTranslation();
  const typeLabel = t(`review.documentType.${document.type}`);
  const expired = isExpired(document.expiresOn);
  return (
    <article className="card review-item" aria-label={heading ?? typeLabel}>
      <header className="review-item__header">
        <h3 className="review-item__title">{heading ?? typeLabel}</h3>
        <ReviewStatusChip status={document.reviewStatus} />
      </header>
      <dl className="facts">
        <dt>{t('review.fields.documentNumber')}</dt>
        <dd dir="auto">{document.number}</dd>
        <dt>{t('review.fields.expiresOn')}</dt>
        <dd>
          <span dir="ltr">{document.expiresOn}</span>{' '}
          {expired ? <span className="chip chip--flag">{t('review.expiredChip')}</span> : null}
        </dd>
        {document.submittedAt ? (
          <>
            <dt>{t('review.fields.submittedAt')}</dt>
            <dd>{formatDateTime(document.submittedAt, i18n.language)}</dd>
          </>
        ) : null}
      </dl>
      <FileView
        key={document.file.fileId}
        file={document.file}
        label={typeLabel}
        onExpired={onExpired}
      />
      {document.reviewNote ? (
        <p className="review-item__note">
          {t('review.fields.reviewNote')}: {document.reviewNote}
        </p>
      ) : null}
    </article>
  );
}

/** Vehicle details, photos (1..4, first is what riders see), review state, assigned types. */
export function VehicleCard({
  vehicle,
  heading,
  onExpired,
}: {
  vehicle: Vehicle;
  heading: string;
  onExpired: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <article className="card review-item" aria-label={heading}>
      <header className="review-item__header">
        <h3 className="review-item__title">{heading}</h3>
        <ReviewStatusChip status={vehicle.reviewStatus} />
        {vehicle.active ? <span className="chip">{t('review.vehicle.activeChip')}</span> : null}
      </header>
      <dl className="facts">
        <dt>{t('review.vehicle.makeModel')}</dt>
        <dd dir="auto">
          {vehicle.make} {vehicle.model}
        </dd>
        <dt>{t('review.vehicle.year')}</dt>
        <dd>{vehicle.year}</dd>
        <dt>{t('review.vehicle.color')}</dt>
        <dd dir="auto">{vehicle.color}</dd>
        <dt>{t('review.vehicle.plate')}</dt>
        <dd dir="auto">{vehicle.plate}</dd>
        <dt>{t('review.vehicle.seats')}</dt>
        <dd>{vehicle.seats}</dd>
        {vehicle.serviceTypes.length > 0 ? (
          <>
            <dt>{t('review.vehicle.serviceTypes')}</dt>
            <dd>
              {vehicle.serviceTypes
                .map((type) => serviceTypeName(type, i18n.language))
                .join(i18n.language === 'ar' ? '، ' : ', ')}
            </dd>
          </>
        ) : null}
      </dl>
      <div className="photo-strip">
        {vehicle.photos.map((photo, index) => (
          <FileView
            key={photo.fileId}
            file={photo}
            label={t('review.vehicle.photo', { n: index + 1 })}
            onExpired={onExpired}
          />
        ))}
      </div>
      {vehicle.reviewNote ? (
        <p className="review-item__note">
          {t('review.fields.reviewNote')}: {vehicle.reviewNote}
        </p>
      ) : null}
    </article>
  );
}

/** Inline "are you sure?" step for an irreversible decision. */
export function ConfirmRow({
  text,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  text: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="confirm-row" role="group" aria-label={confirmLabel}>
      <p className="confirm-row__text">{text}</p>
      <div className="panel__row">
        <button className="btn btn--danger" type="button" onClick={onConfirm} disabled={busy}>
          {busy ? t('review.working') : confirmLabel}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Mandatory-reason rejection with a confirmation step. */
export function RejectForm({
  idPrefix,
  hint,
  confirmText,
  busy,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  hint: string;
  confirmText: string;
  busy: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const trimmed = reason.trim();

  return (
    <div className="card panel">
      <h3 className="panel__title">{t('review.reject.title')}</h3>
      <p className="panel__hint">{hint}</p>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-reason`}>{t('review.reject.reasonLabel')}</label>
        <textarea
          id={`${idPrefix}-reason`}
          value={reason}
          maxLength={1000}
          rows={3}
          disabled={busy || confirming}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {confirming ? (
        <ConfirmRow
          text={confirmText}
          confirmLabel={t('review.reject.confirm')}
          busy={busy}
          onConfirm={() => onSubmit(trimmed)}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <div className="panel__row">
          <button
            className="btn btn--primary"
            type="button"
            disabled={trimmed.length === 0}
            onClick={() => setConfirming(true)}
          >
            {t('review.reject.submit')}
          </button>
          <button className="btn" type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          {trimmed.length === 0 ? (
            <span className="panel__hint">{t('review.reject.reasonRequired')}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

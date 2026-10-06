import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../api/client';
import { submitDocumentRenewal } from '../../api/onboarding';
import type { DocumentType } from '../../api/onboarding-types';
import { DOCUMENT_TYPES } from '../../api/onboarding-types';
import { emptyDocument, hasErrors, validateDocument } from '../../onboarding/drafts';
import type { DocumentDraft, DocumentField } from '../../onboarding/drafts';
import { failureKindOf, fieldErrorsOf, withoutErrors } from '../../onboarding/server-errors';
import type { ServerFieldErrors } from '../../onboarding/server-errors';
import { BodyText, ErrorBanner, FormScreen, InfoBanner, PrimaryButton, ScreenTitle } from '../auth/ui';
import { DocumentStep } from './steps';

function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

function RenewalForm({ type }: { type: DocumentType }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [draft, setDraft] = useState<DocumentDraft>(() => emptyDocument(type));
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerFieldErrors>({});
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const errors = attempted ? validateDocument(draft) : {};

  const onChange = (next: DocumentDraft, field: DocumentField) => {
    setDraft(next);
    const serverField = field === 'file' ? 'fileId' : field;
    setServerErrors((current) => withoutErrors(current, (key) => key === serverField));
  };

  const submit = async () => {
    setAttempted(true);
    if (hasErrors(validateDocument(draft))) return;
    setErrorKey(null);
    setBusy(true);
    try {
      await submitDocumentRenewal(type, {
        number: draft.number.trim(),
        expiresOn: draft.expiresOn as string,
        fileId: draft.file?.fileId as string,
      });
      setDone(true);
    } catch (error) {
      const fieldErrors = fieldErrorsOf(error);
      if (fieldErrors) {
        setServerErrors(fieldErrors);
        setErrorKey('onboarding.errors.fixHighlighted');
      } else if (error instanceof ApiError && error.status === 400) {
        setErrorKey('onboarding.errors.invalid');
      } else if (error instanceof ApiError && error.status === 409) {
        setErrorKey('onboarding.renewal.conflict');
      } else {
        setErrorKey(`onboarding.errors.${failureKindOf(error)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/documents');
  };

  if (done) {
    return (
      <FormScreen testID="renewal-done">
        <InfoBanner testID="renewal-info">{t('onboarding.renewal.done')}</InfoBanner>
        <PrimaryButton
          title={t('onboarding.renewal.backToDocuments')}
          onPress={back}
          testID="renewal-back"
        />
      </FormScreen>
    );
  }

  return (
    <FormScreen testID="renew-document-screen">
      <ScreenTitle>{t(`onboarding.documentTypes.${type}`)}</ScreenTitle>
      <BodyText>{t('onboarding.renewal.hint')}</BodyText>
      {errorKey ? <ErrorBanner testID="renewal-error">{t(errorKey)}</ErrorBanner> : null}
      <DocumentStep
        draft={draft}
        onChange={onChange}
        errors={errors}
        serverErrors={serverErrors}
        scope=""
        testID={`renewal-${type}`}
      />
      <PrimaryButton
        title={t('onboarding.renewal.submit')}
        onPress={() => void submit()}
        busy={busy}
        testID="renewal-submit"
      />
    </FormScreen>
  );
}

/** UC-D-19 — upload a renewed document (number + expiry + one file). */
export function RenewDocumentScreen() {
  const { t } = useTranslation();
  const { type } = useLocalSearchParams<{ type?: string }>();
  if (!isDocumentType(type)) {
    return (
      <FormScreen testID="renew-document-screen">
        <ErrorBanner testID="renewal-unknown-type">{t('onboarding.renewal.unknownType')}</ErrorBanner>
      </FormScreen>
    );
  }
  return <RenewalForm type={type} />;
}

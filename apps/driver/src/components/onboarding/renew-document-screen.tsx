import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "../../api/client";
import { submitDocumentRenewal } from "../../api/onboarding";
import type { DocumentType } from "../../api/onboarding-types";
import { DOCUMENT_TYPES } from "../../api/onboarding-types";
import {
  emptyDocument,
  hasErrors,
  validateDocument,
} from "../../onboarding/drafts";
import type { DocumentDraft, DocumentField } from "../../onboarding/drafts";
import {
  failureKindOf,
  fieldErrorsOf,
  withoutErrors,
} from "../../onboarding/server-errors";
import type { ServerFieldErrors } from "../../onboarding/server-errors";
import { Banner, BodyText, FormScreen, PrimaryButton } from "../ui";
import { DocumentStep } from "./steps";

function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" &&
    (DOCUMENT_TYPES as readonly string[]).includes(value)
  );
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
    const serverField = field === "file" ? "fileId" : field;
    setServerErrors((current) =>
      withoutErrors(current, (key) => key === serverField),
    );
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
        setErrorKey("onboarding.errors.fixHighlighted");
      } else if (error instanceof ApiError && error.status === 400) {
        setErrorKey("onboarding.errors.invalid");
      } else if (error instanceof ApiError && error.status === 409) {
        setErrorKey("onboarding.renewal.conflict");
      } else {
        setErrorKey(`onboarding.errors.${failureKindOf(error)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/documents");
  };

  if (done) {
    return (
      <FormScreen
        title={t(`onboarding.documentTypes.${type}`)}
        testID="renewal-done"
        footer={
          <PrimaryButton
            title={t("onboarding.renewal.backToDocuments")}
            onPress={back}
            testID="renewal-back"
          />
        }
      >
        <Banner
          tone="success"
          message={t("onboarding.renewal.done")}
          testID="renewal-info"
        />
      </FormScreen>
    );
  }

  return (
    <FormScreen
      title={t(`onboarding.documentTypes.${type}`)}
      testID="renew-document-screen"
      footer={
        <PrimaryButton
          title={t("onboarding.renewal.submit")}
          onPress={() => void submit()}
          busy={busy}
          testID="renewal-submit"
        />
      }
    >
      <BodyText>{t("onboarding.renewal.hint")}</BodyText>
      {errorKey ? (
        <Banner tone="danger" message={t(errorKey)} testID="renewal-error" />
      ) : null}
      <DocumentStep
        draft={draft}
        onChange={onChange}
        errors={errors}
        serverErrors={serverErrors}
        scope=""
        testID={`renewal-${type}`}
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
      <FormScreen
        title={t("onboarding.renewal.title")}
        testID="renew-document-screen"
      >
        <Banner
          tone="danger"
          message={t("onboarding.renewal.unknownType")}
          testID="renewal-unknown-type"
        />
      </FormScreen>
    );
  }
  return <RenewalForm type={type} />;
}

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, StyleSheet, View } from "react-native";

import { updateMyProfile } from "../../api/auth";
import { ApiError } from "../../api/client";
import type { DocumentType } from "../../api/onboarding-types";
import { PROFILE_NAME_MAX } from "../../api/onboarding-types";
import { useAuth } from "../../auth/AuthProvider";
import { useLocale } from "../../i18n/LocaleProvider";
import { colors, spacing } from "../../theme/tokens";
import { formatDate } from "../../onboarding/dates";
import {
  hasErrors,
  validateDocument,
  validateVehicleDetails,
  validateVehiclePhotos,
} from "../../onboarding/drafts";
import type {
  DocumentDraft,
  DocumentField,
  VehicleDraft,
  VehicleField,
} from "../../onboarding/drafts";
import {
  failureKindOf,
  fieldErrorsOf,
  messageKeyFor,
  targetOf,
  withoutErrors,
} from "../../onboarding/server-errors";
import type { ServerFieldErrors } from "../../onboarding/server-errors";
import {
  AppText,
  Banner,
  Card,
  FormScreen,
  KeyValue,
  PrimaryButton,
  ScreenHeader,
  TextButton,
  useDirection,
} from "../ui";
import {
  DocumentStep,
  PersonalStep,
  VehicleDetailsStep,
  VehiclePhotosStep,
} from "./steps";
import { StepProgress } from "./ui";

/**
 * Generic staged onboarding wizard (UC-D-01 apply, UC-D-02 resubmit,
 * UC-D-18 vehicle switch): one concern per screen, progress on top,
 * per-step client validation before any API call, and server 400
 * `fieldErrors` mapped back to their step (E1).
 */

export type StepId =
  "personal" | `doc:${DocumentType}` | "vehicle" | "photos" | "review";

export function docStep(type: DocumentType): StepId {
  return `doc:${type}`;
}

function docTypeOf(step: StepId): DocumentType | null {
  return step.startsWith("doc:") ? (step.slice(4) as DocumentType) : null;
}

export interface WizardResult {
  documents: DocumentDraft[];
  vehicle: VehicleDraft;
  confirmPersonalDetails: boolean;
}

export interface OnboardingWizardProps {
  testID: string;
  steps: StepId[];
  initialDocuments: Partial<Record<DocumentType, DocumentDraft>>;
  initialVehicle: VehicleDraft;
  /** Reviewer notes per step (resubmission only). */
  notes?: Partial<Record<StepId, string | null>>;
  /** Ask the applicant to confirm their personal details (flagged personal item). */
  confirmPersonal?: boolean;
  submitLabel: string;
  /** Intro line on the review step. */
  reviewHint: string;
  /** i18n key for the flow's 409 (conflict) answer. */
  conflictKey: string;
  submit: (result: WizardResult) => Promise<void>;
  /** Leaves the wizard (after success, or from the 409 banner). */
  onExit: () => void;
}

type SubmitFailure =
  | { kind: "fields"; unknown: ServerFieldErrors }
  | { kind: "invalid" }
  | { kind: "conflict" }
  | { kind: "network" }
  | { kind: "server" };

export function OnboardingWizard(props: OnboardingWizardProps) {
  const { t } = useTranslation();
  const { language } = useLocale();
  const { user, setUser } = useAuth();
  const { flipRows } = useDirection();
  const { steps } = props;

  const [index, setIndex] = useState(0);
  const [attempted, setAttempted] = useState<Partial<Record<StepId, boolean>>>(
    {},
  );
  const [documents, setDocuments] = useState(props.initialDocuments);
  const [vehicle, setVehicle] = useState(props.initialVehicle);
  const [name, setName] = useState(user?.name ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerFieldErrors>({});
  const [stepErrorKey, setStepErrorKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<SubmitFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const step = steps[index];

  const goTo = (next: number) => {
    setStepErrorKey(null);
    setIndex(next);
  };

  // Android hardware back walks the steps before leaving the wizard.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (index > 0 && !busy) {
          setStepErrorKey(null);
          setIndex(index - 1);
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [index, busy]);

  // ------------------------------------------------------- validation

  const personalErrors = (): {
    name?: string;
    photo?: string;
    confirm?: string;
  } => {
    const errors: { name?: string; photo?: string; confirm?: string } = {};
    const trimmed = name.trim();
    if (trimmed.length === 0)
      errors.name = "onboarding.validation.nameRequired";
    else if (trimmed.length > PROFILE_NAME_MAX)
      errors.name = "onboarding.validation.tooLong";
    if (!user?.photoUrl) errors.photo = "onboarding.validation.photoRequired";
    if (props.confirmPersonal && !confirmed)
      errors.confirm = "onboarding.validation.confirm";
    return errors;
  };

  const errorsFor = (id: StepId): object => {
    const type = docTypeOf(id);
    if (type) return validateDocument(documents[type] as DocumentDraft);
    if (id === "personal") return personalErrors();
    if (id === "vehicle") return validateVehicleDetails(vehicle);
    if (id === "photos") {
      const key = validateVehiclePhotos(vehicle);
      return key ? { photos: key } : {};
    }
    return {};
  };

  const shownErrors = (id: StepId): Record<string, string | undefined> =>
    attempted[id] ? (errorsFor(id) as Record<string, string | undefined>) : {};

  // ------------------------------------------------------- navigation

  const next = async () => {
    setAttempted((current) => ({ ...current, [step]: true }));
    if (hasErrors(errorsFor(step))) return;
    if (step === "personal" && user && name.trim() !== user.name) {
      // Personal details live on the account (contract: edited via /users/me).
      setBusy(true);
      setStepErrorKey(null);
      try {
        const profile = await updateMyProfile({
          name: name.trim(),
          language: user.language,
        });
        await setUser(profile);
      } catch (error) {
        setStepErrorKey(
          failureKindOf(error) === "network"
            ? "onboarding.errors.network"
            : "onboarding.errors.server",
        );
        return;
      } finally {
        setBusy(false);
      }
    }
    goTo(index + 1);
  };

  const submit = async () => {
    const invalidStep = steps.findIndex((id) => hasErrors(errorsFor(id)));
    if (invalidStep >= 0) {
      setAttempted((current) => ({ ...current, [steps[invalidStep]]: true }));
      goTo(invalidStep);
      return;
    }
    setFailure(null);
    setBusy(true);
    try {
      await props.submit({
        documents: steps
          .map(docTypeOf)
          .filter((type): type is DocumentType => type !== null)
          .map((type) => documents[type] as DocumentDraft),
        vehicle,
        confirmPersonalDetails: !!props.confirmPersonal && confirmed,
      });
      props.onExit();
    } catch (error) {
      const fieldErrors = fieldErrorsOf(error);
      if (fieldErrors) {
        // E1: route every error to its step; unmappable ones stay on review.
        const stepFor = (key: string): StepId | null => {
          const target = targetOf(key);
          const id: StepId | null =
            target.step === "document"
              ? docStep(target.type)
              : target.step === "unknown"
                ? null
                : target.step;
          return id && steps.includes(id) ? id : null;
        };
        const unknown = withoutErrors(
          fieldErrors,
          (key) => stepFor(key) !== null,
        );
        setServerErrors(fieldErrors);
        setFailure({ kind: "fields", unknown });
        const firstStep = steps.findIndex((id) =>
          Object.keys(fieldErrors).some((key) => stepFor(key) === id),
        );
        if (firstStep >= 0) {
          setIndex(firstStep);
          setStepErrorKey("onboarding.errors.fixHighlighted");
        }
      } else if (error instanceof ApiError && error.status === 400) {
        setFailure({ kind: "invalid" });
      } else if (error instanceof ApiError && error.status === 409) {
        setFailure({ kind: "conflict" });
      } else {
        setFailure({ kind: failureKindOf(error) });
      }
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------- edits

  const onDocumentChange = (draft: DocumentDraft, field: DocumentField) => {
    setDocuments((current) => ({ ...current, [draft.type]: draft }));
    const scope = `documents[${draft.type}]`;
    const serverField = field === "file" ? "fileId" : field;
    setServerErrors((current) =>
      withoutErrors(
        current,
        (key) => key === scope || key === `${scope}.${serverField}`,
      ),
    );
  };

  const onVehicleChange = (draft: VehicleDraft, field: VehicleField) => {
    setVehicle(draft);
    setServerErrors((current) =>
      withoutErrors(
        current,
        (key) => key === "vehicle" || key === `vehicle.${field}`,
      ),
    );
  };

  const onPhotosChange = (draft: VehicleDraft) => {
    setVehicle(draft);
    setServerErrors((current) =>
      withoutErrors(current, (key) => key.startsWith("vehicle.photoFileIds")),
    );
  };

  // ------------------------------------------------------- rendering

  const titleOf = (id: StepId): string => {
    const type = docTypeOf(id);
    if (type) return t(`onboarding.documentTypes.${type}`);
    return t(`onboarding.steps.${id}`);
  };

  const renderStep = () => {
    const type = docTypeOf(step);
    const shown = shownErrors(step);
    if (type) {
      return (
        <DocumentStep
          draft={documents[type] as DocumentDraft}
          onChange={onDocumentChange}
          errors={shown}
          serverErrors={serverErrors}
          scope={`documents[${type}]`}
          note={props.notes?.[step]}
          testID={`step-doc-${type}`}
        />
      );
    }
    if (step === "personal") {
      return (
        <PersonalStep
          name={name}
          onNameChange={(value) => {
            setName(value);
            setServerErrors((current) =>
              withoutErrors(current, (key) => key === "name"),
            );
          }}
          nameErrorKey={
            shown.name ??
            ("name" in serverErrors ? messageKeyFor("name") : null)
          }
          photoErrorKey={
            shown.photo ??
            ("profilePhoto" in serverErrors
              ? messageKeyFor("profilePhoto")
              : null)
          }
          onPhotoChanged={() =>
            setServerErrors((current) =>
              withoutErrors(current, (key) => key === "profilePhoto"),
            )
          }
          note={props.notes?.personal}
          confirm={
            props.confirmPersonal
              ? {
                  checked: confirmed,
                  onToggle: () => setConfirmed((value) => !value),
                  errorKey: shown.confirm,
                }
              : undefined
          }
        />
      );
    }
    if (step === "vehicle") {
      return (
        <VehicleDetailsStep
          draft={vehicle}
          onChange={onVehicleChange}
          errors={shown}
          serverErrors={serverErrors}
          note={props.notes?.vehicle}
        />
      );
    }
    if (step === "photos") {
      return (
        <VehiclePhotosStep
          draft={vehicle}
          onChange={onPhotosChange}
          errorKey={shown.photos ?? null}
          serverErrors={serverErrors}
          note={props.notes?.vehicle}
        />
      );
    }
    return renderReview();
  };

  const reviewSummary = (id: StepId) => {
    const type = docTypeOf(id);
    if (type) {
      const draft = documents[type] as DocumentDraft;
      return (
        <>
          <KeyValue
            label={t("onboarding.document.number")}
            value={draft.number.trim()}
          />
          <KeyValue
            label={t("onboarding.document.expiresOn")}
            value={
              draft.expiresOn ? formatDate(draft.expiresOn, language) : "—"
            }
          />
          <KeyValue
            label={t("onboarding.document.file")}
            value={draft.file ? t("onboarding.review.fileAttached") : "—"}
          />
        </>
      );
    }
    if (id === "personal") {
      return (
        <>
          <KeyValue label={t("auth.fields.name")} value={name.trim()} />
          <KeyValue
            label={t("onboarding.personal.photo")}
            value={user?.photoUrl ? t("onboarding.review.photoOnFile") : "—"}
          />
        </>
      );
    }
    if (id === "vehicle") {
      return (
        <>
          <KeyValue
            label={t("onboarding.vehicle.title")}
            value={`${vehicle.make.trim()} ${vehicle.model.trim()} · ${vehicle.year.trim()}`}
          />
          <KeyValue
            label={t("onboarding.vehicle.color")}
            value={vehicle.color.trim()}
          />
          <KeyValue
            label={t("onboarding.vehicle.plate")}
            value={vehicle.plate.trim()}
          />
          <KeyValue
            label={t("onboarding.vehicle.seats")}
            value={vehicle.seats.trim()}
          />
        </>
      );
    }
    if (id === "photos") {
      return (
        <KeyValue
          label={t("onboarding.steps.photos")}
          value={t("onboarding.review.photoCount", {
            count: vehicle.photos.length,
          })}
        />
      );
    }
    return null;
  };

  const renderReview = () => (
    <View style={styles.review} testID="step-review">
      <AppText variant="body" color={colors.textSecondary}>
        {props.reviewHint}
      </AppText>
      {failure ? renderFailure() : null}
      {steps
        .filter((id) => id !== "review")
        .map((id) => (
          <Card key={id} testID={`review-${id}`}>
            <View style={[styles.reviewHeader, flipRows && styles.rowReverse]}>
              <AppText variant="rowTitle" style={styles.reviewTitle}>
                {titleOf(id)}
              </AppText>
              <TextButton
                title={t("onboarding.actions.edit")}
                onPress={() => goTo(steps.indexOf(id))}
                testID={`review-edit-${id}`}
              />
            </View>
            {reviewSummary(id)}
          </Card>
        ))}
    </View>
  );

  const renderFailure = () => {
    if (!failure) return null;
    if (failure.kind === "fields") {
      const unknownKeys = Object.keys(failure.unknown);
      if (unknownKeys.length === 0) return null;
      return (
        <Banner
          tone="danger"
          message={[
            t("onboarding.errors.invalid"),
            ...unknownKeys.map((key) => `• ${t(messageKeyFor(key))}`),
          ].join("\n")}
          testID="wizard-error"
        />
      );
    }
    const key =
      failure.kind === "conflict"
        ? props.conflictKey
        : failure.kind === "invalid"
          ? "onboarding.errors.invalid"
          : `onboarding.errors.${failure.kind}`;
    return (
      <>
        <Banner tone="danger" message={t(key)} testID="wizard-error" />
        {failure.kind === "conflict" ? (
          <TextButton
            title={t("onboarding.actions.backToStatus")}
            onPress={props.onExit}
            testID="wizard-conflict-exit"
          />
        ) : null}
      </>
    );
  };

  const back = index > 0 && !busy ? () => goTo(index - 1) : undefined;

  return (
    <FormScreen
      key={step}
      testID={props.testID}
      header={
        <>
          <ScreenHeader onBack={back} />
          <StepProgress
            current={index + 1}
            total={steps.length}
            title={titleOf(step)}
          />
        </>
      }
      footer={
        <>
          {step === "review" ? (
            <PrimaryButton
              title={props.submitLabel}
              onPress={() => void submit()}
              busy={busy}
              testID="wizard-submit"
            />
          ) : (
            <PrimaryButton
              title={t("onboarding.actions.next")}
              onPress={() => void next()}
              busy={busy}
              testID="wizard-next"
            />
          )}
          {index > 0 ? (
            <TextButton
              title={t("onboarding.actions.back")}
              onPress={() => goTo(index - 1)}
              disabled={busy}
              testID="wizard-back"
            />
          ) : null}
        </>
      }
    >
      {stepErrorKey ? (
        <Banner
          tone="danger"
          message={t(stepErrorKey)}
          testID="wizard-step-error"
        />
      ) : null}
      {renderStep()}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  review: { gap: spacing.ms },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reviewTitle: { flex: 1 },
  rowReverse: { flexDirection: "row-reverse" },
});

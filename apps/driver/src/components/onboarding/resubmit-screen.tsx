import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";

import { getMyApplication, resubmitApplication } from "../../api/onboarding";
import type {
  ApplicationResubmitRequest,
  DocumentType,
  DriverApplication,
} from "../../api/onboarding-types";
import { flaggedItems } from "../../onboarding/application";
import {
  documentFromServer,
  emptyVehicle,
  toDocumentInput,
  toVehicleInput,
  vehicleFromServer,
} from "../../onboarding/drafts";
import type { DocumentDraft } from "../../onboarding/drafts";
import { useRemote } from "../../onboarding/use-remote";
import {
  BodyText,
  FailureState,
  FormScreen,
  LoadingState,
  PrimaryButton,
} from "../ui";
import { OnboardingWizard, docStep } from "./wizard";
import type { StepId } from "./wizard";

const NOT_FOUND = [404] as const;

function ResubmitWizard({ application }: { application: DriverApplication }) {
  const { t } = useTranslation();
  const router = useRouter();
  const flagged = flaggedItems(application);

  const steps: StepId[] = [
    ...(flagged.personal ? (["personal"] as StepId[]) : []),
    ...flagged.documents.map((document) => docStep(document.type)),
    ...(flagged.vehicle ? (["vehicle", "photos"] as StepId[]) : []),
    "review",
  ];
  const notes: Partial<Record<StepId, string | null>> = {
    personal: application.personal.reviewNote,
    vehicle: application.vehicle.reviewNote,
  };
  const initialDocuments: Partial<Record<DocumentType, DocumentDraft>> = {};
  for (const document of flagged.documents) {
    notes[docStep(document.type)] = document.reviewNote;
    initialDocuments[document.type] = documentFromServer(document);
  }

  const exit = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/apply-to-drive");
  };

  return (
    <OnboardingWizard
      testID="resubmit-wizard"
      steps={steps}
      initialDocuments={initialDocuments}
      initialVehicle={
        flagged.vehicle
          ? vehicleFromServer(application.vehicle)
          : emptyVehicle()
      }
      notes={notes}
      confirmPersonal={flagged.personal}
      submitLabel={t("onboarding.resubmit.submit")}
      reviewHint={t("onboarding.resubmit.reviewHint")}
      conflictKey="onboarding.resubmit.conflict"
      submit={async ({ documents, vehicle, confirmPersonalDetails }) => {
        // UC-D-02: EXACTLY the flagged items — nothing else goes in the body.
        const body: ApplicationResubmitRequest = {};
        if (flagged.personal)
          body.confirmPersonalDetails = confirmPersonalDetails;
        if (documents.length > 0)
          body.documents = documents.map(toDocumentInput);
        if (flagged.vehicle) body.vehicle = toVehicleInput(vehicle);
        await resubmitApplication(body);
      }}
      onExit={exit}
    />
  );
}

/** UC-D-02 — resubmit only the items the reviewer flagged, with their notes. */
export function ResubmitScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, reload } = useRemote(getMyApplication, NOT_FOUND);

  if (state.status === "loading") {
    return (
      <FormScreen
        title={t("onboarding.resubmit.title")}
        testID="resubmit-screen"
      >
        <LoadingState />
      </FormScreen>
    );
  }
  if (state.status === "error") {
    return (
      <FormScreen
        title={t("onboarding.resubmit.title")}
        testID="resubmit-screen"
      >
        <FailureState kind={state.kind} onRetry={() => void reload()} />
      </FormScreen>
    );
  }
  if (state.status === "absent" || state.data.status !== "needs_changes") {
    return (
      <FormScreen
        title={t("onboarding.resubmit.title")}
        testID="resubmit-screen"
        footer={
          <PrimaryButton
            title={t("onboarding.actions.backToStatus")}
            onPress={() => router.replace("/apply-to-drive")}
            testID="resubmit-back"
          />
        }
      >
        <BodyText testID="resubmit-nothing">
          {t("onboarding.resubmit.nothing")}
        </BodyText>
      </FormScreen>
    );
  }
  return <ResubmitWizard application={state.data} />;
}

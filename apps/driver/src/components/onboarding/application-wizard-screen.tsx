import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { submitApplication } from '../../api/onboarding';
import type { DocumentType } from '../../api/onboarding-types';
import { DOCUMENT_TYPES } from '../../api/onboarding-types';
import { emptyDocument, emptyVehicle, toDocumentInput, toVehicleInput } from '../../onboarding/drafts';
import type { DocumentDraft } from '../../onboarding/drafts';
import { OnboardingWizard, docStep } from './wizard';
import type { StepId } from './wizard';

const APPLY_STEPS: StepId[] = [
  'personal',
  ...DOCUMENT_TYPES.map(docStep),
  'vehicle',
  'photos',
  'review',
];

function emptyDocuments(): Record<DocumentType, DocumentDraft> {
  return Object.fromEntries(
    DOCUMENT_TYPES.map((type) => [type, emptyDocument(type)]),
  ) as Record<DocumentType, DocumentDraft>;
}

/**
 * UC-D-01 — the full application (also the reapplication after a
 * rejection, UC-D-03 A2, which is a full new submission).
 */
export function ApplicationWizardScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const exit = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/apply-to-drive');
  };

  return (
    <OnboardingWizard
      testID="application-wizard"
      steps={APPLY_STEPS}
      initialDocuments={emptyDocuments()}
      initialVehicle={emptyVehicle()}
      submitLabel={t('onboarding.apply.submit')}
      reviewHint={t('onboarding.apply.reviewHint')}
      conflictKey="onboarding.apply.conflict"
      submit={async ({ documents, vehicle }) => {
        await submitApplication({
          documents: documents.map(toDocumentInput),
          vehicle: toVehicleInput(vehicle),
        });
      }}
      onExit={exit}
    />
  );
}

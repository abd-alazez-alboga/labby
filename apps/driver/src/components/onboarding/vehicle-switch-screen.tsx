import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { submitVehicleSwitch } from '../../api/onboarding';
import { VEHICLE_DOCUMENT_TYPES } from '../../api/onboarding-types';
import { emptyDocument, emptyVehicle, toDocumentInput, toVehicleInput } from '../../onboarding/drafts';
import { OnboardingWizard, docStep } from './wizard';
import type { StepId } from './wizard';

const SWITCH_STEPS: StepId[] = [
  'vehicle',
  'photos',
  ...VEHICLE_DOCUMENT_TYPES.map(docStep),
  'review',
];

/**
 * UC-D-18 — submit a new vehicle with its registration + insurance. The
 * current vehicle stays active until the switch is approved.
 */
export function VehicleSwitchScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const exit = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/vehicles');
  };

  return (
    <OnboardingWizard
      testID="vehicle-switch-wizard"
      steps={SWITCH_STEPS}
      initialDocuments={{
        vehicle_registration: emptyDocument('vehicle_registration'),
        insurance: emptyDocument('insurance'),
      }}
      initialVehicle={emptyVehicle()}
      submitLabel={t('onboarding.switch.submit')}
      reviewHint={t('onboarding.switch.reviewHint')}
      conflictKey="onboarding.switch.conflict"
      submit={async ({ documents, vehicle }) => {
        await submitVehicleSwitch({
          vehicle: toVehicleInput(vehicle),
          documents: documents.map(toDocumentInput),
        });
      }}
      onExit={exit}
    />
  );
}

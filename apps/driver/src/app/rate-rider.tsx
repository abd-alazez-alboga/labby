import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  RateRiderScreen,
  reportHrefFor,
} from "../components/trust/rate-rider-screen";
import { LoadingState, Muted, Screen } from "../components/ui";
import { useOptionalRatingPrompt } from "../trust/RatingPromptProvider";

/**
 * UC-S-17 A1 — rating a skipped ride from Trips while its 7-day window is
 * open (`GET /ratings/pending?as=driver` decides what is still rateable).
 */
export default function RateRiderRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const prompts = useOptionalRatingPrompt();
  const target =
    prompts?.pending.find((item) => item.rideId === rideId) ?? null;
  const [checked, setChecked] = useState(false);
  const refresh = prompts?.refresh;

  useEffect(() => {
    if (target || checked || !refresh) {
      if (!refresh) setChecked(true);
      return;
    }
    void refresh().finally(() => setChecked(true));
  }, [target, checked, refresh]);

  if (target) {
    return (
      <RateRiderScreen
        target={target}
        payment={null}
        mode="history"
        onSkip={() => router.back()}
        onDone={(id) => {
          prompts?.finish(id);
          router.back();
        }}
        onReport={() => router.push(reportHrefFor(target))}
      />
    );
  }
  return (
    <Screen testID="rate-rider-unavailable">
      {checked ? (
        <Muted>{t("trust.rate.unavailable")}</Muted>
      ) : (
        <LoadingState />
      )}
    </Screen>
  );
}

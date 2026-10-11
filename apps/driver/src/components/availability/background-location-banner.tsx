import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";

import {
  getBackgroundLocationStatus,
  subscribeBackgroundLocationStatus,
} from "../../realtime/location-source";
import type { BackgroundLocationStatus } from "../../realtime/location-source";
import { Banner } from "../ui/banner";
import { TextButton } from "../ui/buttons";

/**
 * M6-X2, owner decision 2026-10-08: a driver who refused "Allow all the time"
 * may stay online, streaming only while the app is open. While that is the
 * case this persistent warning explains that ride requests stop with Labby in
 * the background and opens the system settings to change it. Nothing shows
 * for active background streaming, Expo Go (`unsupported`) or offline.
 */
export function BackgroundLocationBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BackgroundLocationStatus>(
    getBackgroundLocationStatus,
  );

  useEffect(() => {
    setStatus(getBackgroundLocationStatus());
    return subscribeBackgroundLocationStatus(setStatus);
  }, []);

  if (status !== "denied") return null;
  return (
    <Banner
      tone="warning"
      title={t("backgroundLocation.deniedTitle")}
      message={t("backgroundLocation.deniedBody")}
      testID="background-location-banner"
    >
      <TextButton
        title={t("backgroundLocation.openSettings")}
        onPress={() => {
          Linking.openSettings().catch(() => {});
        }}
        testID="background-location-settings"
      />
    </Banner>
  );
}

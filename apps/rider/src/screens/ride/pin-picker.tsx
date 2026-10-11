/**
 * "Choose on map" / "Drop a pin": a full map with a fixed centre pin; the
 * rider pans the map under it and confirms. Used by booking, route changes
 * and saved places (UC-R-01, UC-R-04 step 1).
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AppText,
  BottomSheet,
  MapFab,
  MapScreen,
  PrimaryButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import type { LatLng } from "../../map/geo";
import { LabbyMap } from "../../map/labby-map";
import { colors, spacing } from "../../theme/tokens";

export function PinPicker({
  initial,
  onConfirm,
  onBack,
  testID = "pin-picker",
}: {
  initial: LatLng;
  onConfirm: (point: LatLng) => void;
  onBack: () => void;
  testID?: string;
}) {
  const { t } = useLocale();
  const { backChevron } = useDirection();
  const { top } = useSafeAreaInsets();
  const [point, setPoint] = useState<LatLng>(initial);
  return (
    <MapScreen
      testID={testID}
      map={
        <View style={styles.fill}>
          <LabbyMap
            center={initial}
            onCenterChange={setPoint}
            noticeTop={top + 72}
            style={styles.fill}
            testID={`${testID}-map`}
          />
          {/* The pin stays at the map centre; the map moves under it. */}
          <View pointerEvents="none" style={styles.pinWrap}>
            <Ionicons name="location-sharp" size={44} color={colors.text} />
          </View>
        </View>
      }
      floating={
        <MapFab
          icon={backChevron}
          accessibilityLabel={t("common.back")}
          onPress={onBack}
          testID={`${testID}-back`}
        />
      }
      sheet={
        <BottomSheet>
          <AppText variant="heading">{t("booking.pinTitle")}</AppText>
          <PrimaryButton
            label={t("booking.pinConfirm")}
            onPress={() => onConfirm(point)}
            testID={`${testID}-confirm`}
          />
        </BottomSheet>
      }
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  pinWrap: {
    position: "absolute",
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: "center",
    justifyContent: "center",
    // The pin's tip (not its centre) marks the point.
    paddingBottom: 44,
    gap: spacing.xs,
  },
});

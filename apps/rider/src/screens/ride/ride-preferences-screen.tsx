/**
 * Ride preferences (UC-R-02 comfort, UC-R-03 matching) — approved artboard
 * RiderPreferences: ONE exclusive matching setting (`nearby_only` |
 * `accept_distant_fee`) and the comfort values shown to the driver, with
 * the exact contract enums. Reachable from booking ("Change") and settings.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  CONVERSATIONS,
  MUSIC,
  type PickupDistanceMode,
  type RiderPreferences,
  TEMPERATURES,
} from "../../api/rides";
import {
  AppText,
  Banner,
  ErrorView,
  LoadingView,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useRiderPreferences } from "../../ride/use-rider-preferences";
import { colors, radius, spacing } from "../../theme/tokens";

const MODES: { mode: PickupDistanceMode; title: string; body: string }[] = [
  {
    mode: "nearby_only",
    title: "ridePrefs.nearbyTitle",
    body: "ridePrefs.nearbyBody",
  },
  {
    mode: "accept_distant_fee",
    title: "ridePrefs.distantTitle",
    body: "ridePrefs.distantBody",
  },
];

function Segmented<V extends string>({
  label,
  values,
  value,
  onChange,
  testID,
}: {
  label: string;
  values: readonly V[];
  value: V;
  onChange: (next: V) => void;
  testID: string;
}) {
  const { t } = useLocale();
  const { row } = useDirection();
  return (
    <View style={styles.group}>
      <AppText variant="label" weight={700} tone="secondary">
        {label}
      </AppText>
      <View
        style={[styles.segments, { flexDirection: row }]}
        accessibilityRole="radiogroup"
      >
        {values.map((item) => {
          const selected = item === value;
          return (
            <Pressable
              key={item}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(item)}
              style={[styles.segment, selected && styles.segmentOn]}
              testID={`${testID}-${item}`}
            >
              <AppText
                variant="caption"
                weight={700}
                tone={selected ? "onAccent" : "default"}
                align="center"
              >
                {t(`ridePrefs.values.${item}`)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function RidePreferencesScreen() {
  const { t } = useLocale();
  const { row } = useDirection();
  const { preferences, status, reload, save } = useRiderPreferences();
  const [edited, setDraft] = useState<RiderPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"saved" | "failed" | null>(null);

  const draft = edited ?? preferences;

  if (status === "error" && !draft) {
    return <ErrorView kind="network" onRetry={() => void reload()} />;
  }
  if (!draft) return <LoadingView testID="ride-prefs-loading" />;

  const update = (patch: Partial<RiderPreferences>) => {
    setNotice(null);
    setDraft({ ...draft, ...patch });
  };

  const submit = async () => {
    setBusy(true);
    setNotice(null);
    try {
      setDraft(await save(draft));
      setNotice("saved");
    } catch {
      setNotice("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="ride-preferences-screen"
    >
      <View style={styles.group} accessibilityRole="radiogroup">
        <AppText variant="rowTitle" weight={800}>
          {t("ridePrefs.matching")}
        </AppText>
        {MODES.map((item) => {
          const selected = draft.pickupDistanceMode === item.mode;
          return (
            <Pressable
              key={item.mode}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => update({ pickupDistanceMode: item.mode })}
              style={[
                styles.mode,
                { flexDirection: row },
                selected && styles.modeOn,
              ]}
              testID={`ride-prefs-mode-${item.mode}`}
            >
              <View style={[styles.radio, selected && styles.radioOn]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" weight={800}>
                  {t(item.title)}
                </AppText>
                <AppText variant="caption" tone="secondary" weight={400}>
                  {t(item.body)}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      <AppText variant="rowTitle" weight={800}>
        {`${t("ridePrefs.comfort")} `}
        <AppText variant="caption" tone="muted">
          {t("ridePrefs.shownToDriver")}
        </AppText>
      </AppText>
      <Segmented
        label={t("ridePrefs.temperature")}
        values={TEMPERATURES}
        value={draft.temperature}
        onChange={(temperature) => update({ temperature })}
        testID="ride-prefs-temperature"
      />
      <Segmented
        label={t("ridePrefs.conversation")}
        values={CONVERSATIONS}
        value={draft.conversation}
        onChange={(conversation) => update({ conversation })}
        testID="ride-prefs-conversation"
      />
      <Segmented
        label={t("ridePrefs.music")}
        values={MUSIC}
        value={draft.music}
        onChange={(music) => update({ music })}
        testID="ride-prefs-music"
      />

      {notice === "saved" ? (
        <Banner tone="success" message={t("ridePrefs.saved")} testID="ride-prefs-saved" />
      ) : notice === "failed" ? (
        <Banner
          tone="danger"
          message={t("ridePrefs.saveFailed")}
          testID="ride-prefs-failed"
        />
      ) : null}

      <PrimaryButton
        label={t("ridePrefs.save")}
        onPress={() => void submit()}
        loading={busy}
        testID="ride-prefs-save"
      />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  segments: {
    gap: 6,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  segmentOn: {
    backgroundColor: colors.text,
  },
  mode: {
    gap: spacing.md,
    alignItems: "flex-start",
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  modeOn: {
    borderColor: colors.text,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  radioOn: {
    borderColor: colors.accent,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  flex: {
    flex: 1,
  },
});

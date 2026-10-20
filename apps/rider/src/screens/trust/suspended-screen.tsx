/**
 * Suspended state (USR-04..06, M11) — approved artboard RiderSuspended:
 * shown on home instead of booking while the rider role or the whole
 * account is suspended. The reason card carries the admin's note ("from
 * the Labby team", manual suspensions and whole-account suspensions) or the
 * rating rule (`low_rating`); without a known reason the card is left out.
 * No "Contact support" action: the approved board has none (an appeal /
 * contact entry is Phase B, not V1). The menu button keeps Settings
 * (language, log out) reachable.
 *
 * SOS and finishing a ride already in flight stay available (owner ruling
 * 2026-10-15): home shows that ride, not this screen, while it lasts.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

import {
  AppText,
  MapFab,
  Screen,
  ScreenScrollView,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { colors, radius, spacing } from "../../theme/tokens";
import type { RiderSuspension } from "../../trust/suspension";

export default function SuspendedScreen({
  suspension,
}: {
  suspension: RiderSuspension;
}) {
  const { t } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const lowRating = suspension.scope === "role" && suspension.reason === "low_rating";

  return (
    <Screen edges={["top"]} style={styles.page} testID="suspended-screen">
      <View style={[styles.topBar, { flexDirection: row }]}>
        <MapFab
          icon="menu"
          accessibilityLabel={t("home.openSettings")}
          onPress={() => router.push("/settings")}
          testID="suspended-settings"
        />
      </View>
      <ScreenScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconWell}>
          <Ionicons name="ban-outline" size={30} color={colors.text} />
        </View>
        <View style={styles.titleBlock}>
          <AppText variant="title" testID="suspended-title">
            {t(
              suspension.scope === "account"
                ? "suspended.accountTitle"
                : "suspended.roleTitle",
            )}
          </AppText>
          <AppText variant="body" tone="secondary" style={styles.lines}>
            {t("suspended.body")}
          </AppText>
        </View>
        {suspension.note ? (
          <View style={styles.noteCard} testID="suspended-note">
            <AppText variant="caption" weight={700} tone="muted">
              {t("suspended.reasonFromTeam")}
            </AppText>
            <AppText variant="bodyStrong" style={styles.lines}>
              {t("suspended.quoted", { note: suspension.note })}
            </AppText>
          </View>
        ) : null}
        {lowRating ? (
          <View style={styles.ruleCard} testID="suspended-rule">
            <AppText variant="caption" weight={700} tone="muted">
              {t("suspended.reasonLabel")}
            </AppText>
            <AppText variant="body" weight={700} style={styles.lines}>
              {t("suspended.lowRating")}
            </AppText>
          </View>
        ) : null}
        <AppText
          variant="caption"
          tone="muted"
          weight={400}
          style={[styles.footer, styles.lines]}
        >
          {t("suspended.footer")}
        </AppText>
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  topBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: 34,
    gap: spacing.xl,
  },
  iconWell: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: {
    gap: spacing.sm,
  },
  lines: {
    lineHeight: 22,
  },
  noteCard: {
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  ruleCard: {
    gap: 6,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  footer: {
    marginTop: "auto",
  },
});

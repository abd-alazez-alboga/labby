/**
 * Suspended state (USR-04..06, M11) — approved artboards RiderSuspended
 * and V1FRiderSuspendedAppeal (+Ar, V1 audit W39): shown on home instead
 * of booking while the rider role or the whole account is suspended. The
 * reason card carries the admin's note ("from the Labby team", manual
 * suspensions and whole-account suspensions) or the rating rule
 * (`low_rating`); without a known reason the card is left out. The card's
 * label carries the suspension date when the profile has it (auth-v1
 * `suspendedAt`, "Reason · from the Labby team · 14 Oct"). "Contact
 * support" opens the create-ticket flow pre-filled about the suspension
 * (UC-R-04 E3 appeal); the Settings link keeps language and log out
 * reachable.
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
  PrimaryButton,
  Screen,
  ScreenScrollView,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { colors, radius, spacing } from "../../theme/tokens";
import type { RiderSuspension } from "../../trust/suspension";
import {
  suspensionDate,
  suspensionTicketHref,
} from "../../trust/suspension-ticket";
import { QuietLink } from "./suspension-support";

export default function SuspendedScreen({
  suspension,
}: {
  suspension: RiderSuspension;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const date = suspensionDate(suspension, locale);
  const lowRating = suspension.scope === "role" && suspension.reason === "low_rating";

  return (
    <Screen edges={["top"]} style={styles.page} testID="suspended-screen">
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
          <View style={styles.reasonCard} testID="suspended-note">
            <AppText variant="caption" weight={700} tone="muted">
              {date
                ? t("suspended.reasonFromTeamDated", { date })
                : t("suspended.reasonFromTeam")}
            </AppText>
            <AppText variant="bodyStrong" style={styles.lines}>
              {t("suspended.quoted", { note: suspension.note })}
            </AppText>
          </View>
        ) : null}
        {lowRating ? (
          <View style={styles.reasonCard} testID="suspended-rule">
            <AppText variant="caption" weight={700} tone="muted">
              {date
                ? t("suspended.reasonLabelDated", { date })
                : t("suspended.reasonLabel")}
            </AppText>
            <AppText variant="bodyStrong" style={styles.lines}>
              {t("suspended.lowRating")}
            </AppText>
          </View>
        ) : null}
        <AppText
          variant="secondary"
          tone="secondary"
          weight={400}
          style={styles.lines}
        >
          {t("suspended.footer")}
        </AppText>
        <View style={styles.actions}>
          <PrimaryButton
            label={t("suspended.contactSupport")}
            onPress={() =>
              router.push(suspensionTicketHref(suspension.reason) as never)
            }
            testID="suspended-contact-support"
          />
          <AppText variant="caption" tone="muted" weight={400} align="center">
            {t("suspended.contactSupportHint")}
          </AppText>
          <QuietLink
            label={t("home.openSettings")}
            onPress={() => router.push("/settings")}
            testID="suspended-settings"
          />
        </View>
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: 40,
    paddingBottom: 34,
    gap: 18,
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
  reasonCard: {
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  actions: {
    marginTop: "auto",
    gap: spacing.sm,
  },
});

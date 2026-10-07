import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import type {
  ApplicationStatus,
  DriverApplication,
} from "../../api/onboarding-types";
import { useLocale } from "../../i18n/LocaleProvider";
import { flaggedItems } from "../../onboarding/application";
import { formatDateTime } from "../../onboarding/dates";
import { colors, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  ListRow,
  Muted,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  StatusChip,
} from "../ui";
import type { Tone } from "../ui";

export const STATUS_TONES: Record<ApplicationStatus, Tone> = {
  submitted: "accent",
  under_review: "warning",
  needs_changes: "warning",
  approved: "success",
  rejected: "danger",
};

/**
 * UC-D-03 — the stage tracker: current stage, what happens next, flagged
 * items with the reviewer's notes, the rejection reason, and the history.
 * The stage's one next step is `TrackerPrimaryAction`, pinned by the gate.
 */
export function ApplicationTracker({
  application,
  onRefresh,
  refreshing,
}: {
  application: DriverApplication;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useTranslation();
  const { language } = useLocale();
  const { status } = application;
  const flagged = status === "needs_changes" ? flaggedItems(application) : null;
  const flaggedRows = flagged
    ? [
        ...(flagged.personal
          ? [
              {
                key: "personal",
                title: t("onboarding.steps.personal"),
                note: application.personal.reviewNote,
              },
            ]
          : []),
        ...flagged.documents.map((document) => ({
          key: document.type,
          title: t(`onboarding.documentTypes.${document.type}`),
          note: document.reviewNote,
        })),
        ...(flagged.vehicle
          ? [
              {
                key: "vehicle",
                title: t("onboarding.steps.vehicle"),
                note: application.vehicle.reviewNote,
              },
            ]
          : []),
      ]
    : [];

  return (
    <View style={styles.tracker} testID={`tracker-${status}`}>
      <ListRow
        title={t("onboarding.tracker.currentStage")}
        trailing={
          <StatusChip
            label={t(`onboarding.status.${status}.label`)}
            tone={STATUS_TONES[status]}
            testID="tracker-status-chip"
          />
        }
        last
        testID="tracker-status"
      >
        <AppText variant="body" testID="tracker-status-body">
          {t(`onboarding.status.${status}.next`)}
        </AppText>
        <Muted>
          {t("onboarding.tracker.submittedAt", {
            date: formatDateTime(application.submittedAt, language),
          })}
        </Muted>
      </ListRow>

      {flagged ? (
        <View style={styles.group} testID="tracker-flagged">
          <Banner
            tone="warning"
            title={t("onboarding.tracker.flaggedTitle")}
            message={t("onboarding.tracker.flaggedHint")}
          />
          <View>
            {flaggedRows.map((row, index) => (
              <ListRow
                key={row.key}
                title={row.title}
                subtitle={row.note ?? ""}
                subtitleColor={colors.warning}
                trailing={
                  <StatusChip
                    label={t("onboarding.status.needs_changes.label")}
                    tone="warning"
                  />
                }
                last={index === flaggedRows.length - 1}
                testID={`flagged-${row.key}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      {status === "rejected" ? (
        <View style={styles.group} testID="tracker-rejected-card">
          {application.rejectionReason ? (
            <Banner
              tone="danger"
              title={t("onboarding.tracker.rejectionReason")}
              message={application.rejectionReason}
              testID="tracker-rejection-reason"
            />
          ) : null}
          <Muted>{t("onboarding.tracker.reapplyHint")}</Muted>
        </View>
      ) : null}

      {status === "approved" ? (
        <Banner
          tone="success"
          message={t("onboarding.tracker.approvedHint")}
          testID="tracker-approved-card"
        />
      ) : null}

      <View testID="tracker-history">
        <SectionLabel>{t("onboarding.tracker.history")}</SectionLabel>
        {application.history.map((event, index) => (
          <ListRow
            key={`${event.at}-${index}`}
            title={t(`onboarding.status.${event.toStatus}.label`)}
            subtitle={formatDateTime(event.at, language)}
            last={index === application.history.length - 1}
            testID={`history-${index}`}
          >
            {event.note ? (
              <AppText variant="secondary" color={colors.textSecondary}>
                {event.note}
              </AppText>
            ) : null}
          </ListRow>
        ))}
      </View>

      <SecondaryButton
        title={t(
          refreshing
            ? "onboarding.tracker.refreshing"
            : "onboarding.tracker.refresh",
        )}
        icon="refresh"
        onPress={onRefresh}
        disabled={refreshing}
        testID="tracker-refresh"
      />
    </View>
  );
}

/** The stage's one next step (fix, reapply, open home) — pinned under the tracker. */
export function TrackerPrimaryAction({
  application,
  onContinueApproved,
  approvedBusy,
}: {
  application: DriverApplication;
  /** Re-reads /users/me so the activated driver role unlocks driver home. */
  onContinueApproved: () => void;
  approvedBusy: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  switch (application.status) {
    case "needs_changes":
      return (
        <PrimaryButton
          title={t("onboarding.tracker.fixItems")}
          onPress={() => router.push("/application-resubmit")}
          testID="tracker-fix"
        />
      );
    case "rejected":
      return (
        <PrimaryButton
          title={t("onboarding.tracker.reapply")}
          onPress={() => router.push("/driver-application")}
          testID="tracker-reapply"
        />
      );
    case "approved":
      return (
        <PrimaryButton
          title={t("onboarding.tracker.openHome")}
          onPress={onContinueApproved}
          busy={approvedBusy}
          testID="tracker-open-home"
        />
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  tracker: { gap: spacing.md },
  group: { gap: spacing.ms },
});

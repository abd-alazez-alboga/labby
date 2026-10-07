import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, RefreshControl, StyleSheet, View } from "react-native";

import { getMyProfile } from "../../api/auth";
import { driverRoleOf, hasActiveDriverRole } from "../../api/auth-types";
import { getMyApplication } from "../../api/onboarding";
import { useAuth } from "../../auth/AuthProvider";
import { failureKindOf } from "../../onboarding/server-errors";
import { useRemote } from "../../onboarding/use-remote";
import { colors, spacing } from "../../theme/tokens";
import { NotificationsBell } from "../notifications/notifications-bell";
import {
  ApplicationTracker,
  TrackerPrimaryAction,
} from "../onboarding/application-tracker";
import {
  AppText,
  Banner,
  DestructiveTextButton,
  FailureState,
  FieldError,
  ListRow,
  LoadingState,
  Muted,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionLabel,
  useDirection,
} from "../ui";

// Brand asset copied from /assets/images/labby-logo.png (source of truth).
const logo = require("../../../assets/images/labby-logo.png");

const NOT_FOUND = [404] as const;

/** Re-reads /users/me; the root stack re-evaluates the driver gate from it. */
function useProfileRefresh() {
  const { setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const profile = await getMyProfile();
      await setUser(profile);
      return profile;
    } catch (error) {
      setErrorKey(`onboarding.errors.${failureKindOf(error)}`);
      return null;
    } finally {
      setBusy(false);
    }
  }, [setUser]);

  return { busy, errorKey, setErrorKey, refresh };
}

function GateLayout({
  title,
  body,
  children,
  footer,
  refreshing,
  onRefresh,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
  /** The gate's one next step, pinned above the navigation bar. */
  footer?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { flipRows } = useDirection();

  return (
    <Screen
      testID="apply-to-drive-screen"
      header={
        <View style={[styles.topRow, flipRows && styles.rowReverse]}>
          <Image
            source={logo}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel={t("app.name")}
          />
          {/* Applicants get their stage updates in the center too (UC-S-11). */}
          <NotificationsBell variant="plain" />
        </View>
      }
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} />
        ) : undefined
      }
      footer={footer}
    >
      <View style={styles.intro}>
        <AppText variant="display" testID="gate-title">
          {title}
        </AppText>
        <AppText variant="body" color={colors.textSecondary} testID="gate-body">
          {body}
        </AppText>
      </View>
      {children}
      <View style={styles.account}>
        {user ? (
          <Muted testID="gate-user">
            {t("gate.signedInAs", { name: user.name })}
          </Muted>
        ) : null}
        <DestructiveTextButton
          title={t("gate.logout")}
          onPress={() => signOut()}
          testID="gate-logout"
        />
      </View>
    </Screen>
  );
}

/**
 * Driver role suspended. A `document_expired` suspension (DRV-04) explains
 * itself and leads straight to renewal; any other reason keeps the generic
 * suspended copy (reasons arrive with later milestones).
 */
function SuspendedGate({ expired }: { expired: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useProfileRefresh();

  if (!expired) {
    return (
      <GateLayout
        title={t("gate.suspendedTitle")}
        body={t("gate.suspendedBody")}
      />
    );
  }
  return (
    <GateLayout
      title={t("gate.expiredTitle")}
      body={t("gate.expiredBody")}
      footer={
        <PrimaryButton
          title={t("gate.renewDocuments")}
          onPress={() => router.push("/documents")}
          testID="gate-renew"
        />
      }
    >
      <Banner
        tone="danger"
        title={t("gate.expiredWhatNow")}
        message={t("gate.expiredSteps")}
        testID="gate-expired"
      />
      <SecondaryButton
        title={t("gate.checkStatus")}
        icon="refresh"
        onPress={() => void profile.refresh()}
        disabled={profile.busy}
        testID="gate-check-status"
      />
      {profile.errorKey ? <FieldError>{t(profile.errorKey)}</FieldError> : null}
    </GateLayout>
  );
}

/** No driver role yet: application intro (never applied) or the stage tracker. */
function ApplicationGate() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, refreshing, reload } = useRemote(getMyApplication, NOT_FOUND);
  const profile = useProfileRefresh();
  const { refresh: refreshProfile, setErrorKey } = profile;
  const approvedId =
    state.status === "loaded" && state.data.status === "approved"
      ? state.data.id
      : null;

  const openDriverHome = useCallback(async () => {
    const fresh = await refreshProfile();
    if (fresh && !hasActiveDriverRole(fresh)) {
      setErrorKey("onboarding.tracker.notActiveYet");
    }
  }, [refreshProfile, setErrorKey]);

  // UC-D-03 A1: once approved, pick up the activated driver role right away.
  useEffect(() => {
    if (approvedId) void openDriverHome();
  }, [approvedId, openDriverHome]);

  if (state.status === "loaded") {
    const application = state.data;
    return (
      <GateLayout
        title={t("onboarding.tracker.title")}
        body={t(`onboarding.status.${application.status}.body`)}
        refreshing={refreshing}
        onRefresh={() => void reload()}
        footer={
          application.status === "needs_changes" ||
          application.status === "rejected" ||
          application.status === "approved" ? (
            <TrackerPrimaryAction
              application={application}
              onContinueApproved={() => void openDriverHome()}
              approvedBusy={profile.busy}
            />
          ) : undefined
        }
      >
        <ApplicationTracker
          application={application}
          refreshing={refreshing}
          onRefresh={() => void reload()}
        />
        {profile.errorKey ? (
          <FieldError testID="gate-profile-error">
            {t(profile.errorKey)}
          </FieldError>
        ) : null}
      </GateLayout>
    );
  }

  return (
    <GateLayout
      title={t("gate.title")}
      body={t("gate.body")}
      footer={
        state.status === "absent" ? (
          <PrimaryButton
            title={t("gate.start")}
            onPress={() => router.push("/driver-application")}
            testID="gate-start"
          />
        ) : undefined
      }
    >
      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? (
        <FailureState kind={state.kind} onRetry={() => void reload()} />
      ) : null}
      {state.status === "absent" ? (
        <View testID="gate-intro">
          <SectionLabel>{t("gate.needTitle")}</SectionLabel>
          <ListRow
            icon="person-outline"
            title={t("gate.needPersonal")}
            titleVariant="body"
          />
          <ListRow
            icon="document-text-outline"
            title={t("gate.needDocuments")}
            titleVariant="body"
          />
          <ListRow
            icon="car-outline"
            title={t("gate.needVehicle")}
            titleVariant="body"
            last
          />
        </View>
      ) : null}
    </GateLayout>
  );
}

/**
 * The driver gate: shown to signed-in accounts WITHOUT an active `driver`
 * role. It hosts the driver application (UC-D-01) entry, the stage tracker
 * (UC-D-03) and the suspended states (USR-04, DRV-04).
 */
export function ApplyToDriveScreen() {
  const { user } = useAuth();
  const driverRole = user ? driverRoleOf(user) : null;
  if (driverRole?.state === "suspended") {
    return (
      <SuspendedGate
        expired={driverRole.suspensionReason === "document_expired"}
      />
    );
  }
  return <ApplicationGate />;
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
  },
  rowReverse: { flexDirection: "row-reverse" },
  logo: { width: 120, height: 22 },
  intro: { gap: spacing.ms, marginBottom: spacing.sm },
  account: {
    marginTop: "auto",
    paddingTop: spacing.lg,
    alignItems: "center",
    gap: spacing.xs,
  },
});

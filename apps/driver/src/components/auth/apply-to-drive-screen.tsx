import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, RefreshControl, StyleSheet, View } from "react-native";

import { getMyProfile } from "../../api/auth";
import {
  canRide,
  driverRoleOf,
  hasActiveDriverRole,
} from "../../api/auth-types";
import { getMyApplication } from "../../api/onboarding";
import { getDriverPerformance } from "../../api/trust";
import { ratingKey, type DriverPerformance } from "../../api/trust-types";
import { useAuth } from "../../auth/AuthProvider";
import { failureKindOf } from "../../onboarding/server-errors";
import { useRemote } from "../../onboarding/use-remote";
import { colors, radius, spacing } from "../../theme/tokens";
import { countCopy, formatRating, formatThreshold } from "../../trust/format";
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
  Icon,
  ListRow,
  LoadingState,
  Muted,
  OutlineButton,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionLabel,
  TextButton,
  useDirection,
} from "../ui";
import { RateRiderScreen, reportHrefFor } from "../trust/rate-rider-screen";
import { useOptionalRatingPrompt } from "../../trust/RatingPromptProvider";

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
  lead,
  children,
  footer,
  refreshing,
  onRefresh,
}: {
  title: string;
  body: string;
  /** Shown above the title (M11 suspended screens: the round "ban" icon). */
  lead?: React.ReactNode;
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
        {lead}
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
 * M11 (D-W1): a suspended driver ROLE may still report riders and read the
 * outcomes — "Your reports" stays one tap away on its suspended screens.
 */
function ReportsLink() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <TextButton
      title={t("trust.links.reports")}
      icon="flag-outline"
      onPress={() => router.push("/reports")}
      testID="gate-reports"
    />
  );
}

/** The round "ban" mark of the M11 suspended screens. */
function SuspendedMark() {
  return (
    <View style={styles.mark}>
      <Icon name="ban-outline" size={30} />
    </View>
  );
}

/** One bordered (or filled) card with a muted caption over the copy. */
function GateCard({
  caption,
  text,
  filled,
  testID,
}: {
  caption: string;
  text: string;
  filled?: boolean;
  testID: string;
}) {
  return (
    <View style={[styles.card, filled && styles.cardFilled]} testID={testID}>
      <AppText variant="caption" weight="700" color={colors.textMuted}>
        {caption}
      </AppText>
      <AppText
        variant={filled ? "body" : "bodyStrong"}
        weight={filled ? "600" : "700"}
        color={filled ? colors.textSecondary : colors.text}
        testID={`${testID}-text`}
      >
        {text}
      </AppText>
    </View>
  );
}

/**
 * USR-05 reason copy: the region's rule from `GET /driver/performance`
 * (readable while the role is suspended), with the snapshot average when it
 * agrees with the suspension (no suffix without one); a generic line when
 * the rule is unavailable.
 */
function useLowRatingReason(enabled: boolean): string {
  const { t } = useTranslation();
  const { language } = useDirection();
  const [performance, setPerformance] = useState<DriverPerformance | null>(
    null,
  );
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    getDriverPerformance()
      .then((data) => {
        if (!cancelled) setPerformance(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  const rule = performance?.ratingRule;
  if (!rule) return t("trust.suspended.lowRatingGeneric");
  const values = {
    min: formatThreshold(rule.minAvgRating, language),
    rides: countCopy(
      t,
      "trust.performance.ratedRides",
      rule.minRatedRides,
      language,
    ),
  };
  const average = performance?.rating.average;
  if (typeof average === "number" && average < rule.minAvgRating) {
    return t("trust.suspended.lowRatingRuleWith", {
      ...values,
      average: formatRating(average, language),
    });
  }
  return t("trust.suspended.lowRatingRule", values);
}

/**
 * M11 (artboard "Driver Suspended"): the driver role suspended for a low
 * rating (USR-05) or by an admin (USR-06, with the note). Earnings and
 * balance stay readable; "Riding still works" only while the rider role is
 * active. No contact-support action (owner decision).
 */
function RoleSuspendedGate({
  reason,
  note,
}: {
  reason: "low_rating" | "manual";
  note: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, refreshProfile } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const lowRatingText = useLowRatingReason(reason === "low_rating");
  const reasonText =
    reason === "low_rating"
      ? lowRatingText
      : note
        ? t("trust.suspended.note", { note })
        : null;

  return (
    <GateLayout
      lead={<SuspendedMark />}
      title={t("trust.suspended.title")}
      body={t("trust.suspended.body")}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void refreshProfile().finally(() => setRefreshing(false));
      }}
      footer={
        <>
          <Muted testID="gate-suspended-footer">
            {t(
              reason === "low_rating"
                ? "trust.suspended.lowRatingFooter"
                : "trust.suspended.manualFooter",
            )}
          </Muted>
          <OutlineButton
            title={t("trust.suspended.viewMoney")}
            onPress={() => router.push("/earnings")}
            testID="gate-view-money"
          />
        </>
      }
    >
      {reasonText ? (
        <GateCard
          caption={t(
            reason === "manual"
              ? "trust.suspended.reasonFromTeam"
              : "trust.suspended.reason",
          )}
          text={reasonText}
          testID="gate-reason"
        />
      ) : null}
      {user && canRide(user) ? (
        <GateCard
          caption={t("trust.suspended.ridingTitle")}
          text={t("trust.suspended.ridingBody")}
          filled
          testID="gate-riding"
        />
      ) : null}
      <ReportsLink />
    </GateLayout>
  );
}

/**
 * M11 (USR-06 "deactivate"): the whole account is suspended — every rider
 * and driver feature is refused, so there is nothing to open; the admin's
 * note is shown. A ride already in flight never lands here (the ride
 * facade keeps the driver app open until it ends).
 */
function AccountSuspendedGate({ note }: { note: string | null }) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <GateLayout
      lead={<SuspendedMark />}
      title={t("trust.suspended.accountTitle")}
      body={t("trust.suspended.accountBody")}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void refreshProfile().finally(() => setRefreshing(false));
      }}
      footer={
        <Muted testID="gate-suspended-footer">
          {t("trust.suspended.manualFooter")}
        </Muted>
      }
    >
      {note ? (
        <GateCard
          caption={t("trust.suspended.reasonFromTeam")}
          text={t("trust.suspended.note", { note })}
          testID="gate-reason"
        />
      ) : null}
    </GateLayout>
  );
}

/**
 * Driver role suspended. A `document_expired` suspension (DRV-04) explains
 * itself and leads straight to renewal; `low_rating` / `manual` (M11) get
 * the suspended screen above; an unrecorded reason keeps the generic copy.
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
      >
        <ReportsLink />
      </GateLayout>
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
      <ReportsLink />
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
          application.status === "withdrawn" ||
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
 * role (or whose account is suspended). It hosts the driver application
 * (UC-D-01) entry, the stage tracker (UC-D-03) and the suspended states
 * (USR-04, DRV-04; M11 USR-05/06).
 */
export function ApplyToDriveScreen() {
  const { user, driverAccess } = useAuth();
  const router = useRouter();
  const ratings = useOptionalRatingPrompt();
  const driverRole = user ? driverRoleOf(user) : null;
  // M11 (D-W1): a suspended driver ROLE still rates — the post-trip /
  // cold-start prompt shows here once the ride hold has released.
  if (driverAccess === "roleSuspended" && ratings?.prompt) {
    const { target, payment } = ratings.prompt;
    return (
      <RateRiderScreen
        // M12 review H4: a fresh screen per prompt — the next member starts empty.
        key={ratingKey(target)}
        target={target}
        payment={payment}
        mode="prompt"
        onSkip={ratings.skip}
        onDone={ratings.finish}
        onReport={() => router.push(reportHrefFor(target))}
      />
    );
  }
  if (user?.state === "suspended") {
    return <AccountSuspendedGate note={user.suspensionNote ?? null} />;
  }
  if (
    driverRole?.state === "suspended" &&
    (driverRole.suspensionReason === "low_rating" ||
      driverRole.suspensionReason === "manual")
  ) {
    return (
      <RoleSuspendedGate
        reason={driverRole.suspensionReason}
        note={driverRole.suspensionNote ?? null}
      />
    );
  }
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
  mark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  card: {
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardFilled: { borderWidth: 0, backgroundColor: colors.surfaceFill },
  account: {
    marginTop: "auto",
    paddingTop: spacing.lg,
    alignItems: "center",
    gap: spacing.xs,
  },
});

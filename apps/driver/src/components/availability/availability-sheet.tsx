import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import type { DriverAvailability } from "../../api/realtime-types";
import { useLocale } from "../../i18n/LocaleProvider";
import { formatDateTime } from "../../onboarding/dates";
import type { AvailabilityContextValue } from "../../realtime/AvailabilityProvider";
import { colors, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  FailureState,
  GoButton,
  Muted,
  SecondaryButton,
  StatusChip,
  useDirection,
} from "../ui";
import type { Tone } from "../ui";

/** The blocked-state copy key for the GET's reason (UC-D-04 E1). */
function blockedKey(data: DriverAvailability): string {
  switch (data.cannotGoOnlineReason) {
    case "role_suspended":
      return data.suspensionReason === "document_expired"
        ? "availability.blocked.document_expired"
        : "availability.blocked.role_suspended";
    case "not_approved":
      return "availability.blocked.not_approved";
    case "no_active_vehicle":
      return "availability.blocked.no_active_vehicle";
    default:
      return "availability.blocked.unknown";
  }
}

function StreamIndicator({ ctx }: { ctx: AvailabilityContextValue }) {
  const { t } = useTranslation();
  let key: string | null = null;
  let tone: Tone = "accent";
  if (ctx.stream === "live") {
    if (ctx.serverHealthy === false) {
      key = "stale";
      tone = "warning";
    } else {
      key = "live";
      tone = "success";
    }
  } else if (ctx.stream === "connecting") {
    key = "connecting";
  } else if (ctx.stream === "reconnecting") {
    key = "reconnecting";
    tone = "warning";
  }
  if (!key) return null;
  return (
    <StatusChip
      label={t(`availability.stream.${key}`)}
      tone={tone}
      testID={`stream-${key}`}
    />
  );
}

/**
 * The floating GO button (UC-D-04 go online). Shown while the driver is
 * offline; blocked states disable it and explain themselves in the sheet.
 * `floorBlocked` (M8, COM-03) disables it too — the balance is at/below the
 * floor and the sheet shows the blocked card. Going offline is the sheet's
 * own action (`AvailabilitySheet`).
 */
export function AvailabilityGoButton({
  ctx,
  floorBlocked,
}: {
  ctx: AvailabilityContextValue | null;
  floorBlocked?: boolean;
}) {
  const { t } = useTranslation();
  if (!ctx || ctx.load.status !== "loaded" || ctx.load.data.online) return null;
  const { data } = ctx.load;
  return (
    <GoButton
      label={t("availability.go")}
      accessibilityLabel={t("availability.goOnline")}
      disabled={!data.canGoOnline || !!floorBlocked}
      busy={ctx.pending !== null}
      onPress={() => void ctx.goOnline()}
      testID="availability-toggle"
    />
  );
}

/**
 * UC-D-04 in the home bottom sheet: "You're offline / online" with the
 * region line, every blocked state explained, the live-stream indicator,
 * GPS permission states, and — while online — the go-offline action.
 */
export function AvailabilitySheet({
  ctx,
  regionLine,
  floorBlocked,
}: {
  ctx: AvailabilityContextValue | null;
  /** Region + service types (or "finding your area"), under the status title. */
  regionLine: React.ReactNode;
  /** M8 (COM-03): the FloorBlockedCard is on screen — skip the generic banner. */
  floorBlocked?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useLocale();
  const { flipRows } = useDirection();

  if (!ctx) return <>{regionLine}</>;
  const { load } = ctx;

  if (load.status === "loading") {
    return (
      <View style={styles.group}>
        <View
          style={[styles.row, flipRows && styles.rowReverse]}
          testID="availability-loading"
        >
          <ActivityIndicator color={colors.accent} />
          <AppText variant="secondary" color={colors.textSecondary}>
            {t("availability.loading")}
          </AppText>
        </View>
        {regionLine}
      </View>
    );
  }
  if (load.status === "error") {
    return (
      <View style={styles.group}>
        <FailureState
          kind={load.kind}
          onRetry={() => void ctx.reload()}
          testID={`availability-error-${load.kind}`}
        />
        {regionLine}
      </View>
    );
  }
  if (load.status === "noProfile") {
    return (
      <View style={styles.group}>
        <Banner
          tone="neutral"
          message={t("availability.noProfile")}
          testID="availability-no-profile"
        />
        {regionLine}
      </View>
    );
  }

  const { data } = load;
  const online = data.online;
  const blocked = !online && !data.canGoOnline;
  const expired =
    data.cannotGoOnlineReason === "role_suspended" &&
    data.suspensionReason === "document_expired";

  return (
    <View
      style={styles.group}
      testID={online ? "availability-online" : "availability-offline"}
    >
      <View style={[styles.row, flipRows && styles.rowReverse]}>
        <View
          style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]}
        />
        <View style={styles.headerText}>
          <AppText variant="heading" testID="availability-status">
            {t(
              online ? "availability.onlineTitle" : "availability.offlineTitle",
            )}
          </AppText>
          {regionLine}
        </View>
      </View>

      {online && data.onlineSince ? (
        <Muted>
          {t("availability.onlineSince", {
            time: formatDateTime(data.onlineSince, language),
          })}
        </Muted>
      ) : null}
      {online ? <StreamIndicator ctx={ctx} /> : null}
      {!blocked ? (
        <Muted>
          {t(online ? "availability.onlineHint" : "availability.offlineHint")}
        </Muted>
      ) : null}

      {blocked ? (
        <Banner
          tone="danger"
          title={t("availability.blockedTitle")}
          message={t(blockedKey(data))}
          messageTestID="availability-blocked-reason"
          testID={`availability-blocked-${data.cannotGoOnlineReason ?? "unknown"}`}
        >
          {expired ? (
            <SecondaryButton
              title={t("availability.renewDocuments")}
              icon="document-text-outline"
              onPress={() => router.push("/documents")}
              testID="availability-renew-documents"
            />
          ) : null}
          {data.cannotGoOnlineReason === "no_active_vehicle" ? (
            <SecondaryButton
              title={t("availability.manageVehicle")}
              icon="car-outline"
              onPress={() => router.push("/vehicles")}
              testID="availability-manage-vehicle"
            />
          ) : null}
        </Banner>
      ) : null}

      {online && data.offersBlockedReason && !floorBlocked ? (
        <Banner
          tone="warning"
          title={t("availability.offersBlockedTitle")}
          message={t("availability.offersBlockedBody")}
          testID="offers-blocked"
        />
      ) : null}

      {ctx.gps === "denied" && !blocked ? (
        <Banner
          tone="warning"
          icon="location-outline"
          title={t("availability.gpsDeniedTitle")}
          message={t(
            online
              ? "availability.gpsDeniedOnlineBody"
              : "availability.gpsDeniedBody",
          )}
          testID="gps-denied"
        >
          {!ctx.gpsCanAskAgain ? (
            <AppText variant="secondary" color={colors.warning}>
              {t("availability.gpsBlockedHint")}
            </AppText>
          ) : null}
          <SecondaryButton
            title={t("availability.openSettings")}
            icon="settings-outline"
            onPress={ctx.openSettings}
            testID="gps-open-settings"
          />
        </Banner>
      ) : null}

      {online && ctx.gps === "granted" && ctx.gpsUnavailable ? (
        <Banner
          tone="danger"
          message={t("availability.gpsUnavailable")}
          testID="gps-unavailable"
        />
      ) : null}

      {ctx.actionError ? (
        <Banner
          tone="danger"
          message={t(`availability.errors.${ctx.actionError}`)}
          testID={`availability-action-error-${ctx.actionError}`}
        />
      ) : null}

      {online ? (
        <SecondaryButton
          title={t("availability.goOffline")}
          icon="power"
          busy={ctx.pending !== null}
          onPress={() => void ctx.goOffline()}
          testID="availability-toggle"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.ms },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  rowReverse: { flexDirection: "row-reverse" },
  headerText: { flex: 1, gap: 2 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotOnline: { backgroundColor: colors.online },
  dotOffline: { backgroundColor: colors.textSubtle },
});

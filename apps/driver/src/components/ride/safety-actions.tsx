import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Linking,
  Pressable,
  Share,
  StyleSheet,
  View,
} from "react-native";

import type { Ride } from "../../api/ride-types";
import { chatWritable, useOptionalChat } from "../../chat/ChatProvider";
import { useOptionalAvailability } from "../../realtime/AvailabilityProvider";
import { useOptionalRegion } from "../../region/RegionProvider";
import { getShareUrl } from "../../safety/share-trip";
import { sendSosEvent, sosSample } from "../../safety/sos";
import { colors, radius, shadows, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  Icon,
  OutlineButton,
  TextButton,
  useDirection,
  useSafeBottomBar,
} from "../ui";
import type { IconName } from "../ui";

/**
 * The on-ride safety actions (UC-S-13..16, design canvas "Driver · on the
 * ride · safety actions"): the Chat / Call / Share trip row on every
 * active-ride sheet, the floating red SOS pill over the map and the SOS
 * confirm sheet. Red #D92D20 is the owner-approved functional safety
 * colour — SOS only.
 */

// ------------------------------------------------------------ action row

function ActionButton({
  icon,
  label,
  onPress,
  disabled,
  badge,
  badgeTestID,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  badge?: number;
  badgeTestID?: string;
  testID?: string;
}) {
  const count = badge && badge > 0 ? (badge > 99 ? "99+" : String(badge)) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={() => {
        if (!disabled) onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        pressed && !disabled && styles.actionPressed,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Icon name={icon} size={20} />
      <AppText variant="caption" weight="800" align="center">
        {label}
      </AppText>
      {count ? (
        <View style={styles.badge} testID={badgeTestID}>
          <AppText
            variant="caption"
            weight="800"
            color={colors.onAccent}
            align="center"
            style={styles.badgeText}
          >
            {count}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Chat (unread badge) / Call / Share trip — on the to-pickup, at-pickup and
 * in-ride sheets — and (M11) the "Report {rider}" text link under them. Chat shows only while a thread exists (no thread = no
 * entry point); Call only while `counterpart.phone` is non-null (CALL-01).
 */
export function SafetyRow({ ride }: { ride: Ride }) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  const router = useRouter();
  const chat = useOptionalChat();
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNotice, setShareNotice] = useState<
    "unavailable" | "error" | null
  >(null);

  const riderName = ride.rider?.firstName?.trim() || t("ride.theRider");
  const reportWhen =
    ride.timeline.startedAt ?? ride.timeline.acceptedAt ?? null;
  const reportPlace = ride.destination.label?.trim() || null;

  const thread = chat?.rideId === ride.id ? (chat?.thread ?? null) : null;
  const hasThread = thread !== null;
  const phone = chatWritable(thread) ? thread?.counterpart.phone ?? null : null;

  const share = useCallback(async () => {
    if (shareBusy) return;
    setShareBusy(true);
    setShareNotice(null);
    const result = await getShareUrl(ride.id);
    setShareBusy(false);
    if (result.kind === "url") {
      try {
        await Share.share({ message: result.url });
      } catch {
        // The user dismissed the OS sheet — nothing to report.
      }
      return;
    }
    setShareNotice(result.kind);
  }, [ride.id, shareBusy]);

  return (
    <View style={styles.rowGroup}>
      <View style={[styles.row, flipRows && styles.rowReverse]}>
        {hasThread ? (
          <ActionButton
            icon="chatbubble-outline"
            label={t("safety.chat")}
            onPress={() => router.push("/chat")}
            badge={chat?.unread}
            badgeTestID="chat-unread-badge"
            testID="safety-chat"
          />
        ) : null}
        {phone ? (
          <ActionButton
            icon="call-outline"
            label={t("safety.call")}
            onPress={() => {
              Linking.openURL(`tel:${phone}`).catch(() => {});
            }}
            testID="safety-call"
          />
        ) : null}
        <ActionButton
          icon="share-social-outline"
          label={t("safety.share")}
          onPress={() => void share()}
          disabled={shareBusy}
          testID="safety-share"
        />
      </View>
      {shareNotice ? (
        <Banner
          tone="warning"
          message={t(`safety.share_${shareNotice}`)}
          testID={`share-notice-${shareNotice}`}
        />
      ) : null}
      {/* M11 (UC-S-18): the rider can be reported from acceptance on —
          during the ride too (same text link as the rider app). */}
      <TextButton
        title={t("trust.report.title", { name: riderName })}
        onPress={() =>
          router.push({
            pathname: "/report-rider",
            params: {
              rideId: ride.id,
              name: ride.rider?.firstName ?? "",
              ...(reportWhen ? { when: reportWhen } : {}),
              ...(reportPlace ? { place: reportPlace } : {}),
            },
          })
        }
        testID="safety-report"
      />
    </View>
  );
}

// --------------------------------------------------------------- SOS pill

/** The floating red SOS pill over the ride map (48 px, SAFE-01). */
export function SosPill({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("safety.sosLabel")}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        flipRows && styles.pillFlipped,
        pressed && styles.pillPressed,
      ]}
      testID="sos-pill"
    >
      <Icon name="shield-outline" size={18} color={colors.onAccent} />
      <AppText variant="rowTitle" weight="800" color={colors.onAccent}>
        {t("safety.sos")}
      </AppText>
    </Pressable>
  );
}

// ------------------------------------------------------------ SOS confirm

/**
 * The SOS confirm sheet (design canvas "SOS confirm", driver copy): the
 * region's emergency number from the resolved region config; confirming
 * records the SOS event silently (fire-and-forget, one retry — never
 * blocking) and opens the OS dialer in parallel.
 */
export function SosConfirmSheet({
  ride,
  onClose,
}: {
  ride: Ride;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const bottom = useSafeBottomBar();
  const region = useOptionalRegion()?.config ?? null;
  const position = useOptionalAvailability()?.position ?? null;
  const emergencyNumber = region?.emergencyNumber ?? null;

  const confirm = () => {
    // The silent half first (never awaited — SAFE-01), the dialer at once.
    void sendSosEvent(ride.id, sosSample(position, ride.pickup));
    if (emergencyNumber) {
      Linking.openURL(`tel:${emergencyNumber}`).catch(() => {});
    }
    onClose();
  };

  return (
    <View style={styles.overlay} testID="sos-sheet">
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("safety.sosCancel")}
        onPress={onClose}
        testID="sos-backdrop"
      />
      <View style={[styles.sheet, { paddingBottom: bottom }]}>
        <View style={styles.handle} />
        <View style={styles.shield}>
          <Icon name="shield-outline" size={30} color={colors.sos} />
        </View>
        <AppText variant="heading" align="center" testID="sos-title">
          {t("safety.sosTitle")}
        </AppText>
        <AppText
          color={colors.textSecondary}
          align="center"
          testID="sos-body"
        >
          {emergencyNumber
            ? t("safety.sosBody", {
                number: emergencyNumber,
                region: region?.name ?? "",
              })
            : t("safety.sosBodyNoNumber")}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            emergencyNumber
              ? t("safety.sosConfirm", { number: emergencyNumber })
              : t("safety.sosConfirmNoNumber")
          }
          onPress={confirm}
          style={({ pressed }) => [
            styles.confirm,
            pressed && styles.pillPressed,
          ]}
          testID="sos-confirm"
        >
          <Icon name="call-outline" size={20} color={colors.onAccent} />
          <AppText variant="rowTitle" weight="800" color={colors.onAccent}>
            {emergencyNumber
              ? t("safety.sosConfirm", { number: emergencyNumber })
              : t("safety.sosConfirmNoNumber")}
          </AppText>
        </Pressable>
        <OutlineButton
          title={t("safety.sosCancel")}
          onPress={onClose}
          testID="sos-cancel"
        />
        <AppText
          variant="caption"
          weight="600"
          color={colors.textMuted}
          align="center"
        >
          {t("safety.sosFootnote")}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rowGroup: { gap: spacing.ms },
  row: { flexDirection: "row", gap: 10 },
  rowReverse: { flexDirection: "row-reverse" },
  action: {
    flex: 1,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionPressed: { backgroundColor: colors.line },
  disabled: { opacity: 0.4 },
  badge: {
    position: "absolute",
    top: 8,
    right: 18,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, lineHeight: 14 },
  pill: {
    alignSelf: "flex-end",
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: 24,
    backgroundColor: colors.sos,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.floating,
  },
  pillFlipped: { alignSelf: "flex-start", flexDirection: "row-reverse" },
  pillPressed: { opacity: 0.85 },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.shadow,
    opacity: 0.48,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 10,
    paddingHorizontal: spacing.ml,
    gap: spacing.md,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grabHandle,
  },
  shield: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.sosBg,
    alignItems: "center",
    justifyContent: "center",
  },
  confirm: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.sos,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
  },
});

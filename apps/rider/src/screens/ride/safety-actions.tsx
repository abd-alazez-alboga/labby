/**
 * On-ride safety actions (M10, UC-S-13..16) — approved artboards
 * RiderSafetyActions / RiderSosConfirm. Rendered on the active-ride sheets
 * (accepted / driver_arrived / in_progress):
 *
 * - Chat (unread badge) — shown only while the ride's thread exists
 *   (a 404 thread means no chat entry point);
 * - Call — `tel:` with the counterpart's phone, shown only while it is
 *   non-null (the CALL-01 window gating is server-side);
 * - Share trip (SHARE-01) — POST /rides/{id}/share-links once, the url is
 *   kept per ride (AsyncStorage) and reused on every re-tap; a 409
 *   `already_shared` with a lost url tells the user instead of erroring;
 * - the red SOS pill over the map + the confirm sheet (SAFE-01): confirm
 *   opens the dialer with the region's emergency number AND fires the SOS
 *   event silently and at once with the best position already in hand
 *   (the fix warmed while the sheet was open → last known → pickup) +
 *   recordedAt; one retry; never blocking the dialer.
 *
 * M11 (UC-S-18): "Report <driver>" under the row opens the report flow —
 * a driver can be reported from acceptance on, during the ride too.
 *
 * Red #D92D20 is owner-approved as a functional safety color (2026-10-13).
 */
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  View,
} from "react-native";

import { createShareLink, sendSos } from "../../api/comms";
import { ApiError } from "../../api/http-client";
import type { LatLngPoint, Ride } from "../../api/rides";
import { useOptionalChat } from "../../chat/chat-context";
import {
  AppText,
  Banner,
  BottomSheet,
  PrimaryButton,
  SecondaryButton,
  TextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { UnreadBadge } from "../../notifications/unread-badge";
import { useOptionalRegion } from "../../region/region-context";
import { colors, radius, spacing, touchTarget } from "../../theme/tokens";
import { useAccountSuspended } from "../../trust/suspension";

/** Owner-approved functional safety red (RiderSafetyActions / RiderSosConfirm). */
export const SAFETY_RED = "#D92D20";
const SAFETY_RED_TINT = "#FEE4E2";

export const SHARE_LINK_KEY_PREFIX = "labby.rider.share-link.";

/**
 * Upper bound for reading the OS's cached (last known) position — a cache
 * read that normally answers at once; the SOS never waits for a fresh fix.
 */
const SOS_LAST_KNOWN_TIMEOUT_MS = 1000;

// ---------------------------------------------------------------- share

async function storedShareUrl(rideId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(`${SHARE_LINK_KEY_PREFIX}${rideId}`);
  } catch {
    return null;
  }
}

async function storeShareUrl(rideId: string, url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${SHARE_LINK_KEY_PREFIX}${rideId}`, url);
  } catch {
    // Best effort — a lost url surfaces as the 409 notice on a re-tap.
  }
}

// ------------------------------------------------------------------ SOS

async function lastKnownPosition(): Promise<LatLngPoint | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const last = await Promise.race([
      Location.getLastKnownPositionAsync(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SOS_LAST_KNOWN_TIMEOUT_MS);
      }),
    ]);
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
  } catch {
    // fall through
  } finally {
    if (timer) clearTimeout(timer);
  }
  return null;
}

/**
 * Records the SOS event silently and at once with the best position
 * already available — the fix warmed while the confirm sheet was open,
 * else the last known position, else the pickup (the event must carry a
 * position) — + the device moment, one retry on failure. Never awaited by
 * the dialer path.
 */
async function fireSosEvent(
  ride: Ride,
  warmFix: LatLngPoint | null,
): Promise<void> {
  const recordedAt = new Date().toISOString();
  const point = warmFix ?? (await lastKnownPosition()) ?? ride.pickup;
  const event = { lat: point.lat, lng: point.lng, recordedAt };
  try {
    await sendSos(ride.id, event);
  } catch {
    try {
      await sendSos(ride.id, event);
    } catch {
      // Silent by design (SAFE-01): the call is the primary channel.
    }
  }
}

// ------------------------------------------------------------------- UI

function ActionTile({
  icon,
  label,
  onPress,
  badge,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  badge?: React.ReactNode;
  testID: string;
}) {
  const { flipRows } = useDirection();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
      <AppText variant="secondary" weight={800} numberOfLines={1}>
        {label}
      </AppText>
      {badge ? (
        <View
          style={[
            styles.tileBadge,
            flipRows ? styles.tileBadgeRtl : styles.tileBadgeLtr,
          ]}
        >
          {badge}
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The Chat / Call / Share trip row of the active-ride sheets. Chat and
 * Call hide themselves while the thread (or the phone) is unavailable.
 */
export function SafetyActionsRow({ ride }: { ride: Ride }) {
  const { t } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const chat = useOptionalChat();
  const [notice, setNotice] = useState<string | null>(null);
  const sharing = useRef(false);
  // Reports are refused for a suspended account (M11): no Report link.
  const accountSuspended = useAccountSuspended();

  const thread = chat?.thread?.rideId === ride.id ? chat.thread : null;
  const phone = thread?.counterpart.phone ?? null;

  const openChat = useCallback(() => {
    router.push(`/chat/${encodeURIComponent(ride.id)}` as never);
  }, [router, ride.id]);

  const call = useCallback(() => {
    if (phone) void Linking.openURL(`tel:${phone}`).catch(() => {});
  }, [phone]);

  const shareTrip = useCallback(async () => {
    if (sharing.current) return;
    sharing.current = true;
    setNotice(null);
    try {
      let url = await storedShareUrl(ride.id);
      if (!url) {
        try {
          const link = await createShareLink(ride.id);
          url = link.url;
          await storeShareUrl(ride.id, url);
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.status === 409 &&
            error.body?.code === "already_shared"
          ) {
            // The link exists but this install lost it: the raw url is
            // served exactly once (SHARE-01), so tell the user instead.
            setNotice(t("safety.shareAlready"));
            return;
          }
          setNotice(t("safety.shareFailed"));
          return;
        }
      }
      await Share.share({ message: url });
    } catch {
      // The OS share sheet was dismissed or failed — nothing to report.
    } finally {
      sharing.current = false;
    }
  }, [ride.id, t]);

  return (
    <View style={styles.rowWrap} testID="safety-actions">
      <View style={[styles.tiles, { flexDirection: row }]}>
        {thread ? (
          <ActionTile
            icon="chatbubble-outline"
            label={t("safety.chat")}
            onPress={openChat}
            badge={
              <UnreadBadge
                count={chat?.unreadCount ?? 0}
                testID="safety-chat-unread"
              />
            }
            testID="safety-chat"
          />
        ) : null}
        {phone ? (
          <ActionTile
            icon="call-outline"
            label={t("safety.callAction")}
            onPress={call}
            testID="safety-call"
          />
        ) : null}
        <ActionTile
          icon="share-social-outline"
          label={t("safety.share")}
          onPress={() => void shareTrip()}
          testID="safety-share"
        />
      </View>
      {notice ? (
        <Banner tone="neutral" message={notice} testID="safety-share-notice" />
      ) : null}
      {ride.driver && !accountSuspended ? (
        <TextButton
          label={t("report.title", { name: ride.driver.firstName })}
          onPress={() =>
            router.push(`/report/${encodeURIComponent(ride.id)}` as never)
          }
          style={styles.report}
          testID="safety-report"
        />
      ) : null}
    </View>
  );
}

/** The red SOS pill floating over the ride map (RiderSafetyActions). */
export function SosPill({
  onPress,
  top,
}: {
  onPress: () => void;
  top: number;
}) {
  const { t } = useLocale();
  const { flipRows } = useDirection();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("safety.sosLabel")}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sosPill,
        { top },
        flipRows ? styles.sosPillRtl : styles.sosPillLtr,
        { flexDirection: flipRows ? "row-reverse" : "row" },
        pressed && styles.sosPillPressed,
      ]}
      testID="ride-sos"
    >
      <Ionicons name="shield-outline" size={18} color={colors.onAccent} />
      {/* The pill label stays "SOS" in both languages (approved artboard). */}
      <AppText variant="bodyStrong" weight={800} tone="onAccent">
        {t("safety.sos")}
      </AppText>
    </Pressable>
  );
}

/**
 * The SOS confirm sheet (RiderSosConfirm). Confirm opens the dialer with
 * the region's emergency number and fires the event in parallel — the POST
 * never delays or blocks the call.
 */
export function SosConfirmSheet({
  ride,
  visible,
  onClose,
}: {
  ride: Ride;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const region = useOptionalRegion();
  const number = region?.config?.emergencyNumber ?? null;
  const regionName = region?.config?.name ?? null;

  // Warm a fresh fix while the sheet is open, so the confirm tap already
  // has a current position and the event never waits for the GPS.
  const warmFix = useRef<LatLngPoint | null>(null);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((fix) => {
        if (live) {
          warmFix.current = {
            lat: fix.coords.latitude,
            lng: fix.coords.longitude,
          };
        }
      })
      .catch(() => {
        // No fix — confirm falls back to last known, then pickup.
      });
    return () => {
      live = false;
    };
  }, [visible]);

  const confirm = () => {
    // Dialer first — the event fires silently alongside it (SAFE-01).
    void Linking.openURL(number ? `tel:${number}` : "tel:").catch(() => {});
    void fireSosEvent(ride, warmFix.current);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="sos-sheet-modal"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("safety.sosCancel")}
        />
        <BottomSheet testID="sos-sheet">
          <View style={styles.sosIconWell}>
            <Ionicons name="shield-outline" size={30} color={SAFETY_RED} />
          </View>
          <View style={styles.sosTitleBlock}>
            <AppText variant="title" align="center">
              {t("safety.sosTitle")}
            </AppText>
            <AppText variant="body" tone="secondary" align="center">
              {number && regionName
                ? t("safety.sosBody", { number, region: regionName })
                : t("safety.sosBodyNoNumber")}
            </AppText>
          </View>
          <PrimaryButton
            label={
              number
                ? t("safety.sosConfirm", { number })
                : t("safety.sosConfirmNoNumber")
            }
            onPress={confirm}
            style={styles.sosConfirm}
            testID="sos-confirm"
          />
          <SecondaryButton
            label={t("safety.sosCancel")}
            onPress={onClose}
            testID="sos-cancel"
          />
          <AppText variant="caption" tone="muted" weight={400} align="center">
            {t("safety.sosFootnote")}
          </AppText>
        </BottomSheet>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    gap: spacing.md,
  },
  tiles: {
    gap: 10,
  },
  report: {
    alignSelf: "center",
  },
  tile: {
    flex: 1,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  tilePressed: {
    backgroundColor: colors.line,
  },
  tileBadge: {
    position: "absolute",
    top: 6,
  },
  tileBadgeLtr: {
    right: 18,
  },
  tileBadgeRtl: {
    left: 18,
  },
  sosPill: {
    position: "absolute",
    height: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.round,
    backgroundColor: SAFETY_RED,
    alignItems: "center",
    gap: spacing.sm,
    shadowColor: SAFETY_RED,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  sosPillLtr: {
    right: spacing.lg,
  },
  sosPillRtl: {
    left: spacing.lg,
  },
  sosPillPressed: {
    opacity: 0.85,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(20,16,24,0.45)",
    justifyContent: "flex-end",
  },
  dismissArea: {
    flex: 1,
  },
  sosIconWell: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: SAFETY_RED_TINT,
    alignItems: "center",
    justifyContent: "center",
  },
  sosTitleBlock: {
    gap: 6,
  },
  sosConfirm: {
    backgroundColor: SAFETY_RED,
  },
});

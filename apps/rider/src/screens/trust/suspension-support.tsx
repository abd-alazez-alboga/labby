/**
 * "Contact support" about a suspension (UC-R-04 E3, V1 audit W39):
 *
 * - `BookingRefusedSheet` — approved artboard V1FRiderBookingRefused: a
 *   booking answered 403 `rider_suspended`. The reason in plain words (the
 *   admin's note or the rating rule — never the raw enum), "Nothing was
 *   booked and nothing was charged.", Contact support (the create-ticket
 *   flow pre-filled about the suspension) and Close;
 * - `useBookingRefusal` — the booking screens' hook: `catchRefusal(error)`
 *   opens the sheet for a `rider_suspended` refusal and says so;
 * - `QuietLink` — the boards' grey 48 px text link (Settings, Close).
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { rideErrorCode, rideErrorDetail } from "../../api/rides";
import { useOptionalAuth } from "../../auth/auth-context";
import {
  AppText,
  BottomSheet,
  PrimaryButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { colors, spacing, touchTarget } from "../../theme/tokens";
import { riderSuspension } from "../../trust/suspension";
import {
  suspensionTicketHref,
  withFallbackReason,
} from "../../trust/suspension-ticket";

/** A booking refused because the rider role is suspended. */
export interface BookingRefusal {
  /** `details.suspensionReason` of the 403 (null when absent). */
  reason: string | null;
}

export function useBookingRefusal() {
  const [refusal, setRefusal] = useState<BookingRefusal | null>(null);
  /** Opens the sheet for a `rider_suspended` refusal; false for anything else. */
  const catchRefusal = useCallback((error: unknown): boolean => {
    if (rideErrorCode(error) !== "rider_suspended") return false;
    setRefusal({ reason: rideErrorDetail(error, "suspensionReason") });
    return true;
  }, []);
  const close = useCallback(() => setRefusal(null), []);
  return { refusal, catchRefusal, close };
}

export function QuietLink({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      testID={testID}
    >
      <AppText variant="bodyStrong" weight={800} tone="secondary" align="center">
        {label}
      </AppText>
    </Pressable>
  );
}

export function BookingRefusedSheet({
  refusal,
  onClose,
}: {
  refusal: BookingRefusal | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { flipRows } = useDirection();
  const router = useRouter();
  const auth = useOptionalAuth();
  if (!refusal) return null;

  // The profile re-read (fired by the 403) may already carry the admin's
  // note; until then the refusal's own reason code speaks.
  const suspension = withFallbackReason(
    riderSuspension(auth?.user ?? null, null),
    refusal.reason,
  );
  const reason = suspension.note
    ? t("suspended.refusedNote", { note: suspension.note })
    : suspension.reason === "low_rating"
      ? t("suspended.lowRating")
      : null;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="booking-refused-modal"
    >
      <View style={styles.backdrop}>
        <BottomSheet testID="booking-refused">
          <View
            style={[
              styles.iconWell,
              flipRows ? styles.selfEnd : styles.selfStart,
            ]}
          >
            <Ionicons name="ban-outline" size={26} color={colors.text} />
          </View>
          <View style={styles.titleBlock}>
            <AppText
              variant="title"
              accessibilityRole="header"
              testID="booking-refused-title"
            >
              {t("suspended.refusedTitle")}
            </AppText>
            <AppText
              variant="body"
              tone="secondary"
              style={styles.lines}
              testID="booking-refused-body"
            >
              {reason
                ? `${t("suspended.refusedBody")} ${reason}`
                : t("suspended.refusedBody")}
            </AppText>
          </View>
          <AppText variant="caption" tone="muted" weight={400}>
            {t("suspended.refusedNothingCharged")}
          </AppText>
          <PrimaryButton
            label={t("suspended.contactSupport")}
            onPress={() => {
              onClose();
              router.push(suspensionTicketHref(suspension.reason) as never);
            }}
            testID="booking-refused-support"
          />
          <QuietLink
            label={t("ride.close")}
            onPress={onClose}
            testID="booking-refused-close"
          />
        </BottomSheet>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,16,24,0.36)",
  },
  iconWell: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  selfStart: {
    alignSelf: "flex-start",
  },
  selfEnd: {
    alignSelf: "flex-end",
  },
  titleBlock: {
    gap: 6,
  },
  lines: {
    lineHeight: 22,
  },
  link: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    opacity: 0.6,
  },
});

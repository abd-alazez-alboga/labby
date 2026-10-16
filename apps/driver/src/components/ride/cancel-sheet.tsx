import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import {
  CANCEL_NOTE_MAX,
  DRIVER_CANCEL_REASONS,
} from "../../api/ride-types";
import type { DriverCancelReason, Ride } from "../../api/ride-types";
import type { DriverRideContextValue } from "../../rides/DriverRideProvider";
import { formatClock, formatTime } from "../../rides/format";
import { useNow } from "../../rides/use-now";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  FieldLabel,
  OutlineButton,
  PrimaryButton,
  TextField,
  useDirection,
  useSafeBottomBar,
} from "../ui";

/** Whether the server will accept `rider_no_show` right now (UC-D-07 E2). */
export function noShowAllowed(ride: Ride, now: number): boolean {
  if (ride.state !== "driver_arrived" || !ride.waitGraceEndsAt) return false;
  return Date.parse(ride.waitGraceEndsAt) <= now;
}

/**
 * Design canvas "Driver cancel" (UC-D-10): a mandatory reason, `other`
 * needs a note (the only typing on the ride screens), the no-show reason
 * disabled until the wait grace is over; copy that the rider is not
 * charged and gets another driver, and that it counts toward the
 * cancellation rate. "Keep the ride" is the dominant action.
 */
export function CancelSheet({
  ctx,
  ride,
  initialReason,
  onClose,
}: {
  ctx: DriverRideContextValue;
  ride: Ride;
  initialReason?: DriverCancelReason | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const now = useNow(true, 1000);
  const bottom = useSafeBottomBar();
  const [reason, setReason] = useState<DriverCancelReason | null>(
    initialReason ?? null,
  );
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);
  const name = ride.rider?.firstName?.trim() || t("ride.theRider");
  // M12 (UC-D-13 E1): on a shared ride a no-show is per member, never the ride.
  const reasons =
    ride.kind === "shared"
      ? DRIVER_CANCEL_REASONS.filter((option) => option !== "rider_no_show")
      : DRIVER_CANCEL_REASONS;
  const allowNoShow = noShowAllowed(ride, now);
  const busy = ctx.pending === "cancel";
  const error = ctx.error?.action === "cancel" ? ctx.error : null;
  const graceLeft = ride.waitGraceEndsAt
    ? Date.parse(ride.waitGraceEndsAt) - now
    : null;

  // The grace window can never be "un-reached", but a resync could move the
  // ride back out of driver_arrived: drop a selection that became invalid.
  const effectiveReason =
    reason === "rider_no_show" && !allowNoShow ? null : reason;

  const confirm = async () => {
    if (!effectiveReason) return;
    if (effectiveReason === "other" && note.trim().length === 0) {
      setNoteError(true);
      return;
    }
    const done = await ctx.cancel(
      effectiveReason,
      effectiveReason === "other" ? note.trim() : undefined,
    );
    if (done) onClose();
  };

  const noShowHint = (() => {
    if (allowNoShow) return t("ride.cancel.noShowAvailable");
    if (ride.state === "driver_arrived" && graceLeft !== null)
      return t("ride.cancel.noShowIn", {
        time: formatClock(Math.max(0, graceLeft), language),
      });
    return t("ride.cancel.noShowAfterArrival");
  })();

  return (
    <View style={styles.overlay} testID="cancel-sheet">
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("ride.cancel.keep")}
        onPress={busy ? undefined : onClose}
        testID="cancel-backdrop"
      />
      <View style={[styles.sheet, { paddingBottom: bottom }]}>
        <View style={styles.handle} />
        <AppText variant="title" testID="cancel-title">
          {t("ride.cancel.title", { name })}
        </AppText>
        <AppText color={colors.textSecondary} testID="cancel-copy">
          {effectiveReason === "rider_no_show"
            ? t("ride.cancel.noShowCopy", { name })
            : t("ride.cancel.copy", { name })}
        </AppText>

        <View accessibilityRole="radiogroup">
          <FieldLabel>{t("ride.cancel.reasonLabel")}</FieldLabel>
          {reasons.map((option, index) => {
            const disabled = option === "rider_no_show" && !allowNoShow;
            const selected = effectiveReason === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                onPress={() => {
                  if (disabled || busy) return;
                  setReason(option);
                  setNoteError(false);
                  ctx.clearError();
                }}
                style={[
                  styles.option,
                  index < reasons.length - 1 && styles.divider,
                  flipRows && styles.rowReverse,
                ]}
                testID={`cancel-reason-${option}`}
              >
                <View
                  style={[
                    styles.radio,
                    selected && styles.radioSelected,
                    disabled && styles.radioDisabled,
                  ]}
                >
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
                <View style={styles.grow}>
                  <AppText
                    variant="rowTitle"
                    color={disabled ? colors.textMuted : colors.text}
                  >
                    {t(`ride.cancel.reasons.${option}`)}
                  </AppText>
                  {option === "rider_no_show" ? (
                    <AppText
                      variant="caption"
                      color={colors.textMuted}
                      testID="cancel-no-show-hint"
                    >
                      {noShowHint}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {effectiveReason === "other" ? (
          <TextField
            label={t("ride.cancel.noteLabel")}
            value={note}
            onChangeText={(value) => {
              setNote(value);
              if (value.trim()) setNoteError(false);
            }}
            maxLength={CANCEL_NOTE_MAX}
            error={noteError ? t("ride.cancel.noteRequired") : null}
            testID="cancel-note"
          />
        ) : null}

        {error?.kind === "noShowTooEarly" ? (
          <Banner
            tone="warning"
            message={
              error.availableAt
                ? t("ride.cancel.noShowTooEarlyAt", {
                    time: formatTime(error.availableAt, language),
                  })
                : t("ride.cancel.noShowTooEarly")
            }
            testID="cancel-no-show-too-early"
          />
        ) : null}
        {error && (error.kind === "network" || error.kind === "server") ? (
          <Banner
            tone="danger"
            message={t(`ride.errors.${error.kind}`)}
            testID={`cancel-error-${error.kind}`}
          />
        ) : null}

        <View style={styles.buttons}>
          <PrimaryButton
            title={t("ride.cancel.keep")}
            size="large"
            onPress={onClose}
            disabled={busy}
            testID="cancel-keep"
          />
          <OutlineButton
            title={t("ride.cancel.confirm")}
            tone="danger"
            onPress={() => void confirm()}
            disabled={!effectiveReason}
            busy={busy}
            testID="cancel-confirm"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    gap: 14,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grabHandle,
  },
  option: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    paddingVertical: spacing.sm,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowReverse: { flexDirection: "row-reverse" },
  grow: { flex: 1, gap: 1 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: colors.accent },
  radioDisabled: { opacity: 0.5 },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  buttons: { gap: 10 },
});

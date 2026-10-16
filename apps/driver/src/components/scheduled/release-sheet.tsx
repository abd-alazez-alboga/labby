import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import {
  CLAIM_RELEASE_REASONS,
  RELEASE_NOTE_MAX,
} from "../../api/scheduled-types";
import type { ClaimReleaseReason } from "../../api/scheduled-types";
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

/**
 * Artboard "Release a claim" (UC-D-12 E1): a mandatory reason
 * (`vehicle_issue` | `unsafe_pickup` | `other` + note), copy that the ride
 * goes back on the board, the rider is told and it counts toward the
 * cancellation rate. "Keep the ride" is the dominant action.
 */
export function ReleaseSheet({
  riderName,
  when,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  riderName: string;
  when: string;
  busy: boolean;
  error: "network" | "server" | null;
  onConfirm: (reason: ClaimReleaseReason, note?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  const bottom = useSafeBottomBar();
  const [reason, setReason] = useState<ClaimReleaseReason | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);

  const confirm = () => {
    if (!reason) return;
    if (reason === "other" && note.trim().length === 0) {
      setNoteError(true);
      return;
    }
    onConfirm(reason, reason === "other" ? note.trim() : undefined);
  };

  return (
    <View style={styles.overlay} testID="release-sheet">
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("scheduled.release.keep")}
        onPress={busy ? undefined : onClose}
        testID="release-backdrop"
      />
      <View style={[styles.sheet, { paddingBottom: bottom }]}>
        <View style={styles.handle} />
        <AppText variant="title" testID="release-title">
          {t("scheduled.release.title", { name: riderName })}
        </AppText>
        <AppText color={colors.textSecondary}>
          {t("scheduled.release.copy", { name: riderName, when })}
        </AppText>

        <View accessibilityRole="radiogroup">
          <FieldLabel>{t("ride.cancel.reasonLabel")}</FieldLabel>
          {CLAIM_RELEASE_REASONS.map((option, index) => {
            const selected = reason === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  if (busy) return;
                  setReason(option);
                  setNoteError(false);
                }}
                style={[
                  styles.option,
                  index < CLAIM_RELEASE_REASONS.length - 1 && styles.divider,
                  flipRows && styles.rowReverse,
                ]}
                testID={`release-reason-${option}`}
              >
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
                <AppText variant="rowTitle" style={styles.grow}>
                  {t(`ride.cancel.reasons.${option}`)}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {reason === "other" ? (
          <TextField
            label={t("ride.cancel.noteLabel")}
            value={note}
            onChangeText={(value) => {
              setNote(value);
              if (value.trim()) setNoteError(false);
            }}
            maxLength={RELEASE_NOTE_MAX}
            error={noteError ? t("ride.cancel.noteRequired") : null}
            testID="release-note"
          />
        ) : null}

        {error ? (
          <Banner
            tone="danger"
            message={t(`ride.errors.${error}`)}
            testID={`release-error-${error}`}
          />
        ) : null}

        <View style={styles.buttons}>
          <PrimaryButton
            title={t("scheduled.release.keep")}
            size="large"
            onPress={onClose}
            disabled={busy}
            testID="release-keep"
          />
          <OutlineButton
            title={t("scheduled.release.confirm")}
            tone="danger"
            onPress={confirm}
            disabled={!reason}
            busy={busy}
            testID="release-confirm"
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
  grow: { flex: 1 },
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
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  buttons: { gap: 10 },
});

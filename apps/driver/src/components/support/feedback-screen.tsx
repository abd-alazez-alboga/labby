import { useRouter } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import { ApiError, isAccountSuspendedError } from "../../api/client";
import { submitFeedback } from "../../api/support";
import type { FeedbackCategory } from "../../api/support-types";
import { FEEDBACK_BODY_MAX, FEEDBACK_CATEGORIES } from "../../api/support-types";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  FieldLabel,
  Icon,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextField,
  useDirection,
} from "../ui";

type SendError = "invalid" | "network" | "server" | "accountSuspended";

function sendErrorOf(caught: unknown): SendError {
  if (isAccountSuspendedError(caught)) return "accountSuspended";
  if (!(caught instanceof ApiError)) return "network";
  if (caught.status === 400) return "invalid";
  return "server";
}

/**
 * UC-S-22 (board S14Feedback): the fixed category catalog (ruling 5, named
 * in i18n), a free text ≤ 2000, `submittedAs: driver` — recorded with no
 * per-item reply promised, so the screen says so up front and thanks after.
 */
export function FeedbackScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { flipRows } = useDirection();
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<SendError | null>(null);

  const send = async () => {
    if (!category || sending || body.trim().length === 0) return;
    setSending(true);
    setError(null);
    try {
      await submitFeedback(category, body.trim());
      setSent(true);
    } catch (caught) {
      setError(sendErrorOf(caught));
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Screen
        title={t("support.feedback.sentTitle")}
        testID="feedback-sent-screen"
        footer={
          <SecondaryButton
            title={t("support.feedback.done")}
            onPress={() => router.back()}
            testID="feedback-done"
          />
        }
      >
        <View style={[styles.sent, flipRows && styles.rowReverse]} testID="feedback-sent">
          <View style={styles.sentIcon}>
            <Icon name="checkmark" size={20} color={colors.onAccent} />
          </View>
          <AppText
            variant="body"
            color={colors.textSecondary}
            style={styles.grow}
          >
            {t("support.feedback.sentBody")}
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      title={t("support.feedback.title")}
      testID="feedback-screen"
      keyboardShouldPersistTaps="handled"
      footer={
        <>
          <PrimaryButton
            title={t("support.feedback.send")}
            onPress={() => void send()}
            disabled={!category || body.trim().length === 0}
            busy={sending}
            testID="feedback-send"
          />
          <AppText
            variant="caption"
            weight="400"
            color={colors.textSecondary}
            style={styles.center}
          >
            {t("support.feedback.footnote")}
          </AppText>
        </>
      }
    >
      <AppText variant="secondary" color={colors.textMuted}>
        {t("support.feedback.intro")}
      </AppText>

      <View style={styles.group}>
        <FieldLabel>{t("support.feedback.categoryLabel")}</FieldLabel>
        <View style={[styles.chips, flipRows && styles.rowReverse]}>
          {FEEDBACK_CATEGORIES.map((option) => {
            const selected = category === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  if (sending) return;
                  setCategory(option);
                  setError(null);
                }}
                style={[styles.chip, selected && styles.chipSelected]}
                hitSlop={CHIP_HIT_SLOP}
                testID={`feedback-category-${option}`}
              >
                <AppText
                  variant="label"
                  weight="700"
                  color={selected ? colors.onAccent : colors.text}
                >
                  {t(`support.feedback.categories.${option}`)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <TextField
        label={t("support.feedback.bodyLabel")}
        value={body}
        onChangeText={setBody}
        maxLength={FEEDBACK_BODY_MAX}
        multiline
        textAlignVertical="top"
        testID="feedback-body"
      />

      {error ? (
        <Banner
          tone={error === "accountSuspended" ? "neutral" : "danger"}
          message={t(
            error === "accountSuspended"
              ? "trust.errors.accountSuspended"
              : `support.feedback.errors.${error}`,
          )}
          testID={`feedback-error-${error}`}
        />
      ) : null}
    </Screen>
  );
}

/** The 40 px chip (board size) reaches the 48 px touch target. */
const CHIP_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rowReverse: { flexDirection: "row-reverse" },
  chip: {
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  sent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    backgroundColor: colors.accentTint,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  sentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1 },
  center: { textAlign: "center" },
});

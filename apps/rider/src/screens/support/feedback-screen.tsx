/**
 * Share feedback (UC-S-22, FDBK-01) — approved artboard S14Feedback: the
 * fixed category catalog as chips, the text, and the honest note that no
 * per-item reply is promised. Submitting shows the sent state in place.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_CATEGORIES,
  submitFeedback,
  type FeedbackCategory,
} from "../../api/support";
import {
  AppText,
  Banner,
  ChoiceChip,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  SecondaryButton,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { colors, spacing } from "../../theme/tokens";

export default function FeedbackScreen() {
  const { t } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const [category, setCategory] = useState<FeedbackCategory>("app_experience");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const text = body.trim();
    if (busy) return;
    if (!text) {
      setError(t("feedback.errors.body_required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitFeedback(category, text);
      setSent(true);
    } catch {
      setError(t("feedback.errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <View style={styles.sentPage} testID="feedback-sent">
        <View style={styles.sentIcon}>
          <Ionicons name="checkmark" size={32} color={colors.onAccent} />
        </View>
        <AppText variant="heading" align="center">
          {t("feedback.sentTitle")}
        </AppText>
        <AppText variant="secondary" tone="muted" align="center">
          {t("feedback.sentBody")}
        </AppText>
        <SecondaryButton
          label={t("common.back")}
          onPress={() => router.back()}
          testID="feedback-sent-back"
        />
      </View>
    );
  }

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      keyboardShouldPersistTaps="handled"
      testID="feedback-screen"
    >
      <AppText variant="secondary" tone="secondary" weight={400}>
        {t("feedback.intro")}
      </AppText>

      <View style={styles.group}>
        <AppText variant="label" weight={700} tone="secondary">
          {t("feedback.categoryLabel")}
        </AppText>
        <View style={[styles.chips, { flexDirection: row }]}>
          {FEEDBACK_CATEGORIES.map((value) => (
            <ChoiceChip
              key={value}
              label={t(`feedback.categories.${value}`)}
              selected={value === category}
              onPress={() => setCategory(value)}
              testID={`feedback-category-${value}`}
            />
          ))}
        </View>
      </View>

      <TextField
        label={t("feedback.bodyLabel")}
        value={body}
        onChangeText={setBody}
        maxLength={FEEDBACK_BODY_MAX}
        multiline
        style={styles.body}
        testID="feedback-body"
      />

      <View style={styles.footer}>
        {error ? (
          <Banner tone="danger" message={error} testID="feedback-error" />
        ) : null}
        <PrimaryButton
          label={t("feedback.submit")}
          onPress={() => void send()}
          loading={busy}
          testID="feedback-send"
        />
        <AppText variant="caption" tone="muted" weight={400} align="center">
          {t("feedback.thanks")}
        </AppText>
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  chips: {
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  body: {
    minHeight: 160,
    textAlignVertical: "top",
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  sentPage: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    gap: spacing.md,
  },
  sentIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
});

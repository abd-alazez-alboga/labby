/**
 * Support home (UC-S-19 step 1, UC-S-21) — approved artboard S14Support:
 * the help center FIRST (search entry + published categories), then "Your
 * tickets" with the unread-support-replies badge, and at the bottom the
 * "create ticket" / "share feedback" paths.
 */
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import {
  listHelpCategories,
  listMyTickets,
  localized,
  type HelpCategory,
} from "../../api/support";
import {
  AppText,
  ErrorView,
  ListRow,
  LoadingView,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  SecondaryButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { UnreadBadge } from "../../notifications/unread-badge";
import { colors, radius, spacing } from "../../theme/tokens";

const TOPIC_ICONS = [
  "car-outline",
  "card-outline",
  "person-outline",
  "shield-outline",
  "help-circle-outline",
] as const;

export default function SupportHomeScreen() {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const [categories, setCategories] = useState<HelpCategory[]>([]);
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [failure, setFailure] = useState<FailureKind>("network");

  const load = useCallback(async () => {
    try {
      const [topics, tickets] = await Promise.all([
        listHelpCategories(),
        listMyTickets(0),
      ]);
      setCategories(topics);
      setUnread(
        tickets.items.reduce(
          (sum, ticket) => sum + ticket.unreadSupportMessages,
          0,
        ),
      );
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, []);

  // Reload on focus so the unread badge follows replies read in a thread.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (status === "loading") return <LoadingView testID="support-loading" />;
  if (status === "error") {
    return (
      <ErrorView
        kind={failure}
        onRetry={() => {
          setStatus("loading");
          void load();
        }}
      />
    );
  }

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="support-home"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("support.searchPlaceholder")}
        onPress={() => router.push("/help-search" as never)}
        style={[styles.search, { flexDirection: row }]}
        testID="support-search"
      >
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <AppText variant="secondary" tone="muted" weight={600}>
          {t("support.searchPlaceholder")}
        </AppText>
      </Pressable>

      <AppText variant="heading">{t("support.helpTopics")}</AppText>
      <View>
        {categories.map((category, index) => (
          <ListRow
            key={category.helpCategoryId}
            testID={`support-topic-${category.helpCategoryId}`}
            title={localized(category.name, locale)}
            subtitle={
              category.articleCount === 1
                ? t("support.articleCountOne")
                : t("support.articleCount", {
                    count: category.articleCount,
                  })
            }
            icon={TOPIC_ICONS[index % TOPIC_ICONS.length]}
            chevron
            last={index === categories.length - 1}
            onPress={() =>
              router.push(
                `/help/${encodeURIComponent(category.helpCategoryId)}?name=${encodeURIComponent(localized(category.name, locale))}` as never,
              )
            }
          />
        ))}
      </View>

      <View style={styles.divider} />

      <ListRow
        testID="support-tickets-row"
        title={t("support.yourTickets")}
        subtitle={t("support.yourTicketsHint")}
        icon="chatbubble-ellipses-outline"
        trailing={<UnreadBadge count={unread} testID="support-unread" />}
        chevron
        last
        onPress={() => router.push("/tickets" as never)}
      />

      <View style={styles.bottom}>
        <AppText variant="caption" tone="muted" weight={400} align="center">
          {t("support.createHint")}
        </AppText>
        <PrimaryButton
          label={t("support.createTicket")}
          onPress={() => router.push("/new-ticket" as never)}
          testID="support-create-ticket"
        />
        <SecondaryButton
          label={t("support.shareFeedback")}
          onPress={() => router.push("/feedback" as never)}
          testID="support-feedback"
        />
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
  },
  bottom: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
});

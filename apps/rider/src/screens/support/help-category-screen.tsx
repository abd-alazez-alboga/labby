/**
 * Help category (UC-S-21) — approved artboard S14HelpCategory: the
 * category's published articles in order, each row opening the article;
 * the "create ticket" fallback at the bottom (A1).
 */
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import {
  listHelpArticles,
  localized,
  type HelpArticleSummary,
} from "../../api/support";
import {
  AppText,
  ErrorView,
  ListRow,
  LoadingView,
  ScreenScrollView,
  screenStyles,
  SecondaryButton,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { spacing } from "../../theme/tokens";

export default function HelpCategoryScreen({
  helpCategoryId,
}: {
  helpCategoryId: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [articles, setArticles] = useState<HelpArticleSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [failure, setFailure] = useState<FailureKind>("network");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setArticles(await listHelpArticles(helpCategoryId));
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, [helpCategoryId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (status === "loading") return <LoadingView testID="help-category-loading" />;
  if (status === "error") {
    return <ErrorView kind={failure} onRetry={() => void load()} />;
  }

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="help-category"
    >
      {articles.length === 0 ? (
        <AppText
          variant="secondary"
          tone="muted"
          weight={400}
          testID="help-category-empty"
        >
          {t("help.categoryEmpty")}
        </AppText>
      ) : null}
      <View>
        {articles.map((article, index) => (
          <ListRow
            key={article.helpArticleId}
            testID={`help-article-${article.helpArticleId}`}
            title={localized(article.title, locale)}
            chevron
            last={index === articles.length - 1}
            onPress={() =>
              router.push(
                `/help-article/${encodeURIComponent(article.helpArticleId)}` as never,
              )
            }
          />
        ))}
      </View>
      <View style={styles.bottom}>
        <AppText variant="caption" tone="muted" weight={400} align="center">
          {t("help.categoryHint")}
        </AppText>
        <SecondaryButton
          label={t("support.createTicket")}
          onPress={() => router.push("/new-ticket" as never)}
          testID="help-category-create-ticket"
        />
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  bottom: {
    gap: spacing.sm,
    paddingTop: spacing.xl,
  },
});

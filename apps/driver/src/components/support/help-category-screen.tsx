import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { ApiError } from "../../api/client";
import { getHelpArticles } from "../../api/support";
import type { HelpArticleSummary } from "../../api/support-types";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors } from "../../theme/tokens";
import { countCopy } from "../../trust/format";
import {
  AppText,
  FailureState,
  ListRow,
  LoadingState,
  Muted,
  Screen,
  SecondaryButton,
  useDirection,
} from "../ui";

type Load =
  | { status: "loading" }
  | { status: "loaded"; articles: HelpArticleSummary[] }
  | { status: "gone" }
  | { status: "error"; kind: FailureKind };

/**
 * UC-S-21 step 2 (board S14HelpCategory): a category's published articles in
 * order, with the create-ticket fallback pinned last. The category's
 * localized names ride in as params so the header renders before the fetch.
 */
export function HelpCategoryScreen({
  helpCategoryId,
  nameEn,
  nameAr,
  count,
}: {
  helpCategoryId: string;
  nameEn: string;
  nameAr: string;
  count: number | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useDirection();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchArticles = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const articles = await getHelpArticles(helpCategoryId);
      if (mounted.current) setLoad({ status: "loaded", articles });
    } catch (caught) {
      if (!mounted.current) return;
      // 404: unknown category, or none of its articles is published any more.
      if (caught instanceof ApiError && caught.status === 404) {
        setLoad({ status: "gone" });
      } else {
        setLoad({ status: "error", kind: failureKindOf(caught) });
      }
    }
  }, [helpCategoryId]);

  useEffect(() => {
    void fetchArticles();
  }, [fetchArticles]);

  return (
    <Screen
      title={language === "ar" ? nameAr : nameEn}
      testID="help-category-screen"
      footer={
        <>
          <AppText
            variant="caption"
            weight="400"
            color={colors.textSecondary}
            style={styles.center}
          >
            {t("support.help.cantFindHere")}
          </AppText>
          <SecondaryButton
            title={t("support.createTicket")}
            onPress={() => router.push("/ticket-create")}
            testID="help-category-create-ticket"
          />
        </>
      }
    >
      {count !== null ? (
        <Muted testID="help-category-count">
          {countCopy(t, "support.articleCount", count, language)}
        </Muted>
      ) : null}

      {load.status === "loading" ? <LoadingState testID="help-category-loading" /> : null}
      {load.status === "error" ? (
        <FailureState
          kind={load.kind}
          onRetry={() => void fetchArticles()}
          testID="help-category-error"
        />
      ) : null}
      {load.status === "gone" ? (
        <Muted testID="help-category-gone">{t("support.help.categoryNotFound")}</Muted>
      ) : null}
      {load.status === "loaded" ? (
        <View testID="help-category-articles">
          {load.articles.map((article, index) => (
            <ListRow
              key={article.helpArticleId}
              title={article.title[language === "ar" ? "ar" : "en"]}
              chevron
              onPress={() =>
                router.push({
                  pathname: "/help-article",
                  params: {
                    helpArticleId: article.helpArticleId,
                    categoryName: language === "ar" ? nameAr : nameEn,
                  },
                })
              }
              last={index === load.articles.length - 1}
              testID={`help-article-${article.helpArticleId}`}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
});

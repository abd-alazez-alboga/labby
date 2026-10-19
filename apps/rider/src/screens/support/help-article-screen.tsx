/**
 * Help article (UC-S-21, SUP-04) — approved artboard S14HelpArticle: the
 * published article in the active language (both come in one payload,
 * NFR-I1, so the in-screen language toggle switches instantly), paragraphs
 * from the plain-text body, and the "create ticket" fallback (A1).
 */
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import { getHelpArticle, localized, type HelpArticle } from "../../api/support";
import {
  AppText,
  ErrorView,
  LoadingView,
  ScreenScrollView,
  screenStyles,
  SecondaryButton,
  TextButton,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { spacing } from "../../theme/tokens";

export default function HelpArticleScreen({
  helpArticleId,
}: {
  helpArticleId: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [article, setArticle] = useState<HelpArticle | null>(null);
  // NFR-I1: both languages arrive together — the toggle is local state.
  const [lang, setLang] = useState<"en" | "ar">(locale);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [failure, setFailure] = useState<FailureKind>("network");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setArticle(await getHelpArticle(helpArticleId));
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, [helpArticleId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (status === "error") {
    return <ErrorView kind={failure} onRetry={() => void load()} />;
  }
  if (status === "loading" || !article) {
    return <LoadingView testID="help-article-loading" />;
  }

  const paragraphs = localized(article.body, lang)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  // Viewing the other language than the app's: align that text its own way.
  const textDirStyle =
    lang === "ar"
      ? ({ textAlign: "right", writingDirection: "rtl" } as const)
      : ({ textAlign: "left", writingDirection: "ltr" } as const);

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="help-article"
    >
      <View style={styles.header}>
        <AppText
          variant="title"
          style={textDirStyle}
          testID="help-article-title"
        >
          {localized(article.title, lang)}
        </AppText>
        <TextButton
          label={lang === "en" ? "عربي" : "English"}
          onPress={() => setLang(lang === "en" ? "ar" : "en")}
          testID="help-article-lang"
        />
      </View>
      <View style={styles.body}>
        {paragraphs.map((paragraph, index) => (
          <AppText
            key={index}
            variant="secondary"
            tone="secondary"
            weight={400}
            style={[styles.paragraph, textDirStyle]}
          >
            {paragraph}
          </AppText>
        ))}
      </View>
      <View style={styles.bottom}>
        <AppText variant="caption" tone="muted" weight={400} align="center">
          {t("help.articleHint")}
        </AppText>
        <SecondaryButton
          label={t("support.createTicket")}
          onPress={() => router.push("/new-ticket" as never)}
          testID="help-article-create-ticket"
        />
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
  },
  body: {
    gap: spacing.lg,
  },
  paragraph: {
    lineHeight: 24,
  },
  bottom: {
    gap: spacing.sm,
    paddingTop: spacing.xl,
  },
});

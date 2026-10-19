import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import { ApiError } from "../../api/client";
import { getHelpArticle } from "../../api/support";
import type { HelpArticle } from "../../api/support-types";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors, radius } from "../../theme/tokens";
import {
  AppText,
  FailureState,
  LoadingState,
  Muted,
  Screen,
  ScreenHeader,
  SecondaryButton,
  useDirection,
} from "../ui";

type Load =
  | { status: "loading" }
  | { status: "loaded"; article: HelpArticle }
  | { status: "gone" }
  | { status: "error"; kind: FailureKind };

/**
 * UC-S-21 article view (board S14HelpArticle): BOTH languages arrive in one
 * payload (NFR-I1), the active app locale renders, and the header toggle
 * flips the ARTICLE's language instantly without refetching or changing the
 * app language. Plain text; paragraphs split on blank lines.
 */
export function HelpArticleScreen({
  helpArticleId,
  categoryName,
}: {
  helpArticleId: string;
  categoryName: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useDirection();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [shownLanguage, setShownLanguage] = useState<"en" | "ar">(
    language === "ar" ? "ar" : "en",
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchArticle = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const article = await getHelpArticle(helpArticleId);
      if (mounted.current) setLoad({ status: "loaded", article });
    } catch (caught) {
      if (!mounted.current) return;
      if (caught instanceof ApiError && caught.status === 404) {
        setLoad({ status: "gone" });
      } else {
        setLoad({ status: "error", kind: failureKindOf(caught) });
      }
    }
  }, [helpArticleId]);

  useEffect(() => {
    void fetchArticle();
  }, [fetchArticle]);

  const other: "en" | "ar" = shownLanguage === "ar" ? "en" : "ar";

  return (
    <Screen
      testID="help-article-screen"
      header={
        <View>
          <View style={styles.headerRow}>
            <ScreenHeader />
            {load.status === "loaded" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(`support.help.languageToggle.${other}`)}
                onPress={() => setShownLanguage(other)}
                style={styles.toggle}
                hitSlop={TOGGLE_HIT_SLOP}
                testID="help-article-language-toggle"
              >
                <AppText variant="caption" weight="800">
                  {t(`support.help.languageToggle.${other}`)}
                </AppText>
              </Pressable>
            ) : null}
          </View>
          {categoryName ? (
            <AppText variant="caption" weight="700" color={colors.textMuted}>
              {categoryName}
            </AppText>
          ) : null}
          {load.status === "loaded" ? (
            <AppText
              variant="title"
              accessibilityRole="header"
              testID="help-article-title"
            >
              {load.article.title[shownLanguage]}
            </AppText>
          ) : null}
        </View>
      }
      footer={
        <>
          <AppText
            variant="caption"
            weight="400"
            color={colors.textSecondary}
            style={styles.center}
          >
            {t("support.help.articleFallback")}
          </AppText>
          <SecondaryButton
            title={t("support.createTicket")}
            onPress={() => router.push("/ticket-create")}
            testID="help-article-create-ticket"
          />
        </>
      }
    >
      {load.status === "loading" ? <LoadingState testID="help-article-loading" /> : null}
      {load.status === "error" ? (
        <FailureState
          kind={load.kind}
          onRetry={() => void fetchArticle()}
          testID="help-article-error"
        />
      ) : null}
      {load.status === "gone" ? (
        <Muted testID="help-article-gone">{t("support.help.notFound")}</Muted>
      ) : null}
      {load.status === "loaded" ? (
        <View style={styles.body} testID="help-article-body">
          {load.article.body[shownLanguage]
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter((paragraph) => paragraph.length > 0)
            .map((paragraph, index) => (
              <AppText
                key={index}
                variant="body"
                color={colors.textSecondary}
                // The toggled language may differ from the app's layout
                // direction — align the text to ITS reading side.
                style={shownLanguage === "ar" ? styles.rtlText : styles.ltrText}
              >
                {paragraph}
              </AppText>
            ))}
        </View>
      ) : null}
    </Screen>
  );
}

/** The 38 px toggle (board size) reaches the 48 px touch target. */
const TOGGLE_HIT_SLOP = { top: 5, bottom: 5, left: 5, right: 5 };

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  toggle: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { gap: 14 },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
  ltrText: { textAlign: "left", writingDirection: "ltr" },
  center: { textAlign: "center" },
});

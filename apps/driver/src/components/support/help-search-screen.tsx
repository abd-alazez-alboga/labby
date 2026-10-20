import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { getHelpCategories, searchHelp } from "../../api/support";
import type {
  HelpArticleSummary,
  HelpCategory,
} from "../../api/support-types";
import { HELP_QUERY_MAX, HELP_QUERY_MIN } from "../../api/support-types";
import { pluralCategory } from "../../money/format";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors } from "../../theme/tokens";
import { formatCount } from "../../trust/format";
import {
  AppText,
  FailureState,
  ListRow,
  LoadingState,
  Muted,
  Screen,
  SecondaryButton,
  TextField,
  useDirection,
} from "../ui";

const DEBOUNCE_MS = 300;

type Results =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; q: string; items: HelpArticleSummary[] }
  | { status: "error"; kind: FailureKind };

/**
 * UC-S-21 step 3 (board S14HelpSearch): debounced substring search of the
 * published articles in the app's language (2..80 chars, ruling 7); an empty
 * result steers to "create a ticket" (UC-S-21 A1 — the footer fallback).
 */
export function HelpSearchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useDirection();
  const [query, setQuery] = useState("");
  const [retryTick, setRetryTick] = useState(0);
  const [results, setResults] = useState<Results>({ status: "idle" });
  // I55 (board S14HelpSearch): each result names its category.
  const [categories, setCategories] = useState<HelpCategory[]>([]);
  const mounted = useRef(true);
  const requestSeq = useRef(0);
  useEffect(() => {
    mounted.current = true;
    getHelpCategories()
      .then((found) => {
        if (mounted.current) setCategories(found);
      })
      .catch(() => {
        // Best-effort: results still show without their category.
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const lang: "en" | "ar" = language === "ar" ? "ar" : "en";
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < HELP_QUERY_MIN) {
      setResults({ status: "idle" });
      return undefined;
    }
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      setResults({ status: "loading" });
      try {
        const items = await searchHelp(trimmed, lang);
        if (mounted.current && requestSeq.current === seq) {
          setResults({ status: "loaded", q: trimmed, items });
        }
      } catch (caught) {
        if (mounted.current && requestSeq.current === seq) {
          setResults({ status: "error", kind: failureKindOf(caught) });
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, lang, retryTick]);

  return (
    <Screen
      title={t("support.searchEntry")}
      testID="help-search-screen"
      keyboardShouldPersistTaps="handled"
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
            testID="help-search-create-ticket"
          />
        </>
      }
    >
      <TextField
        label={t("support.searchEntry")}
        value={query}
        onChangeText={setQuery}
        maxLength={HELP_QUERY_MAX}
        autoFocus
        testID="help-search-input"
      />

      {results.status === "idle" ? (
        <Muted testID="help-search-hint">{t("support.help.searchMin")}</Muted>
      ) : null}
      {results.status === "loading" ? <LoadingState testID="help-search-loading" /> : null}
      {results.status === "error" ? (
        <FailureState
          kind={results.kind}
          onRetry={() => setRetryTick((tick) => tick + 1)}
          testID="help-search-error"
        />
      ) : null}
      {results.status === "loaded" ? (
        results.items.length === 0 ? (
          <Muted testID="help-search-empty">
            {t("support.help.noResults", { q: results.q })}
          </Muted>
        ) : (
          <>
            <Muted testID="help-search-count">
              {t(
                `support.help.results.${pluralCategory(results.items.length, language)}`,
                {
                  value: formatCount(results.items.length, language),
                  q: results.q,
                },
              )}
            </Muted>
            <View testID="help-search-results">
              {results.items.map((article, index) => (
                <ListRow
                  key={article.helpArticleId}
                  title={article.title[lang]}
                  subtitle={
                    categories.find(
                      (category) =>
                        category.helpCategoryId === article.helpCategoryId,
                    )?.name[lang] ?? null
                  }
                  chevron
                  onPress={() =>
                    router.push({
                      pathname: "/help-article",
                      params: { helpArticleId: article.helpArticleId },
                    })
                  }
                  last={index === results.items.length - 1}
                  testID={`help-search-result-${article.helpArticleId}`}
                />
              ))}
            </View>
          </>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
});

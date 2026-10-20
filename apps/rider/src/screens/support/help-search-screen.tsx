/**
 * Help search (UC-S-21 step 3, ruling 7) — approved artboard
 * S14HelpSearch: debounced substring search in the active language
 * (`GET /help/search?q=&lang=`), results grouped as the API orders them
 * (title matches first) under their category name (read once from the
 * category list; best effort — a failed read just drops the eyebrow),
 * empty state and the "create ticket" fallback.
 * A failed search shows the shared error view with retry, not "No results".
 */
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import {
  HELP_SEARCH_MAX,
  HELP_SEARCH_MIN,
  listHelpCategories,
  localized,
  searchHelp,
  type HelpArticleSummary,
  type HelpCategory,
} from "../../api/support";
import {
  AppText,
  ErrorView,
  ListRow,
  LoadingView,
  ScreenScrollView,
  screenStyles,
  SecondaryButton,
  useDirection,
  useFontFamily,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { countKey } from "../../i18n/plural";
import { colors, radius, spacing } from "../../theme/tokens";

const DEBOUNCE_MS = 300;

export default function HelpSearchScreen() {
  const { t, locale } = useLocale();
  const { isRTL } = useDirection();
  const router = useRouter();
  const fontFamily = useFontFamily(600);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HelpArticleSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  // Bumped by the error view's retry to re-run the same search.
  const [attempt, setAttempt] = useState(0);
  const requestSeq = useRef(0);
  const [categories, setCategories] = useState<HelpCategory[]>([]);

  useEffect(() => {
    let cancelled = false;
    listHelpCategories()
      .then((found) => {
        if (!cancelled) setCategories(found);
      })
      .catch(() => {
        // The eyebrow is optional; results still show without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = query.trim();

  useEffect(() => {
    const seq = ++requestSeq.current;
    if (trimmed.length < HELP_SEARCH_MIN) {
      // Deferred (timer) so the reset is not a synchronous effect update.
      const reset = setTimeout(() => {
        setResults([]);
        setSearched(false);
        setSearching(false);
        setFailure(null);
      }, 0);
      return () => clearTimeout(reset);
    }
    const arm = setTimeout(() => setSearching(true), 0);
    const timer = setTimeout(async () => {
      try {
        const found = await searchHelp(trimmed.slice(0, HELP_SEARCH_MAX), locale);
        if (requestSeq.current !== seq) return;
        setResults(found);
        setFailure(null);
        setSearched(true);
      } catch (error) {
        if (requestSeq.current !== seq) return;
        setResults([]);
        setFailure(failureKind(error));
        setSearched(true);
      } finally {
        if (requestSeq.current === seq) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(arm);
      clearTimeout(timer);
    };
  }, [trimmed, locale, attempt]);

  const categoryName = (id: string): string | undefined => {
    const category = categories.find((item) => item.helpCategoryId === id);
    return category ? localized(category.name, locale) : undefined;
  };

  const countLine = t(
    countKey(
      {
        one: "help.searchResultsOne",
        two: "help.searchResultsTwo",
        few: "help.searchResults",
        many: "help.searchResultsElevenPlus",
      },
      results.length,
    ),
    { count: results.length, query: trimmed },
  );

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      keyboardShouldPersistTaps="handled"
      testID="help-search"
    >
      <TextInput
        style={[styles.input, { fontFamily }, isRTL && styles.inputRtl]}
        value={query}
        onChangeText={setQuery}
        placeholder={t("support.searchPlaceholder")}
        placeholderTextColor={colors.textMuted}
        autoFocus
        maxLength={HELP_SEARCH_MAX}
        accessibilityLabel={t("support.searchPlaceholder")}
        testID="help-search-input"
      />

      {trimmed.length > 0 && trimmed.length < HELP_SEARCH_MIN ? (
        <AppText variant="caption" tone="muted" weight={400}>
          {t("help.searchMin")}
        </AppText>
      ) : null}

      {searching ? <LoadingView testID="help-search-loading" /> : null}

      {!searching && searched && failure ? (
        <ErrorView
          kind={failure}
          onRetry={() => setAttempt((n) => n + 1)}
          testID="help-search-error"
        />
      ) : null}

      {!searching && searched && !failure ? (
        <>
          <AppText
            variant="caption"
            tone="muted"
            weight={400}
            testID="help-search-count"
          >
            {results.length === 0
              ? t("help.searchEmpty", { query: trimmed })
              : countLine}
          </AppText>
          <View>
            {results.map((article, index) => (
              <ListRow
                key={article.helpArticleId}
                testID={`help-search-result-${article.helpArticleId}`}
                eyebrow={categoryName(article.helpCategoryId)}
                title={localized(article.title, locale)}
                chevron
                last={index === results.length - 1}
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
              {t("help.searchHint")}
            </AppText>
            <SecondaryButton
              label={t("support.createTicket")}
              onPress={() => router.push("/new-ticket" as never)}
              testID="help-search-create-ticket"
            />
          </View>
        </>
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    paddingHorizontal: spacing.lg,
    fontSize: 15,
    color: colors.text,
  },
  inputRtl: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  bottom: {
    gap: spacing.sm,
    paddingTop: spacing.xl,
  },
});

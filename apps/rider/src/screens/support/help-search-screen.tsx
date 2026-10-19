/**
 * Help search (UC-S-21 step 3, ruling 7) — approved artboard
 * S14HelpSearch: debounced substring search in the active language
 * (`GET /help/search?q=&lang=`), results grouped as the API orders them
 * (title matches first), empty state and the "create ticket" fallback.
 */
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import {
  HELP_SEARCH_MAX,
  HELP_SEARCH_MIN,
  localized,
  searchHelp,
  type HelpArticleSummary,
} from "../../api/support";
import {
  AppText,
  ListRow,
  LoadingView,
  ScreenScrollView,
  screenStyles,
  SecondaryButton,
  useDirection,
  useFontFamily,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
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
  const requestSeq = useRef(0);

  const trimmed = query.trim();

  useEffect(() => {
    const seq = ++requestSeq.current;
    if (trimmed.length < HELP_SEARCH_MIN) {
      // Deferred (timer) so the reset is not a synchronous effect update.
      const reset = setTimeout(() => {
        setResults([]);
        setSearched(false);
        setSearching(false);
      }, 0);
      return () => clearTimeout(reset);
    }
    const arm = setTimeout(() => setSearching(true), 0);
    const timer = setTimeout(async () => {
      try {
        const found = await searchHelp(trimmed.slice(0, HELP_SEARCH_MAX), locale);
        if (requestSeq.current !== seq) return;
        setResults(found);
        setSearched(true);
      } catch {
        if (requestSeq.current !== seq) return;
        setResults([]);
        setSearched(true);
      } finally {
        if (requestSeq.current === seq) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(arm);
      clearTimeout(timer);
    };
  }, [trimmed, locale]);

  const countLine =
    results.length === 1
      ? t("help.searchResultsOne", { query: trimmed })
      : t("help.searchResults", {
          count: results.length,
          query: trimmed,
        });

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

      {!searching && searched ? (
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

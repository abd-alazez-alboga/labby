/**
 * Ride history (UC-R-07 step 4) — approved artboard RiderHistory: newest
 * first, every state; a completed ride shows its stored total and opens its
 * receipt, a cancelled one its recorded fee, the rest a dash.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import { listRides, type RideSummary } from "../../api/rides";
import {
  AppText,
  EmptyView,
  ErrorView,
  LoadingView,
  TextButton,
  useDirection,
  useInsetContentStyle,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import {
  formatDateTime,
  formatMoney,
  placeLabel,
  serviceName,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

function HistoryRow({ item }: { item: RideSummary }) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const currency = item.currency ?? "";
  const completed = item.state === "completed";
  const service = serviceName(
    { nameEn: item.serviceTypeNameEn, nameAr: item.serviceTypeNameAr },
    locale,
  );
  const date = formatDateTime(item.requestedAt, locale);
  const subtitle = completed
    ? t("history.line", { date, service })
    : t("history.line", { date, service: t(`history.states.${item.state}`) });
  const fee =
    item.cancellationFee != null && item.cancellationFee > 0
      ? item.cancellationFee
      : null;

  const content = (
    <>
      <View style={styles.iconWell}>
        <Ionicons
          name={completed ? "car-outline" : "close-circle-outline"}
          size={22}
          color={colors.text}
        />
      </View>
      <View style={styles.text}>
        <AppText variant="bodyStrong" weight={800}>
          {placeLabel(item.destination)}
        </AppText>
        <AppText variant="caption" tone="secondary" weight={400}>
          {subtitle}
        </AppText>
      </View>
      <View style={styles.trailing}>
        {completed && item.total != null ? (
          <AppText variant="body" weight={800} testID={`history-amount-${item.id}`}>
            {formatMoney(item.total, currency, locale, t)}
          </AppText>
        ) : fee !== null ? (
          <>
            <AppText variant="body" weight={800} testID={`history-amount-${item.id}`}>
              {formatMoney(fee, currency, locale, t)}
            </AppText>
            <AppText variant="caption" tone="muted" weight={400}>
              {t("history.cancellationFee")}
            </AppText>
          </>
        ) : (
          <AppText variant="body" tone="muted" weight={700}>
            —
          </AppText>
        )}
      </View>
    </>
  );

  if (!completed) {
    return (
      <View style={[styles.row, { flexDirection: row }]} testID={`history-${item.id}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/receipt/${item.id}` as never)}
      style={({ pressed }) => [
        styles.row,
        { flexDirection: row },
        pressed && styles.pressed,
      ]}
      testID={`history-${item.id}`}
    >
      {content}
    </Pressable>
  );
}

export default function RideHistoryScreen() {
  const { t } = useLocale();
  const [items, setItems] = useState<RideSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [failure, setFailure] = useState<FailureKind>("network");
  const [loadingMore, setLoadingMore] = useState(false);
  const contentStyle = useInsetContentStyle(styles.content);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const first = await listRides(0);
      setItems(first.items);
      setTotal(first.totalItems);
      setPage(0);
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await listRides(page + 1);
      setItems((list) => [...list, ...next.items]);
      setTotal(next.totalItems);
      setPage(page + 1);
    } catch {
      // the button stays for another try
    } finally {
      setLoadingMore(false);
    }
  };

  if (status === "loading") return <LoadingView testID="history-loading" />;
  if (status === "error")
    return <ErrorView kind={failure} onRetry={() => void load()} />;
  if (items.length === 0) {
    return (
      <EmptyView
        icon="car-outline"
        title={t("history.emptyTitle")}
        body={t("history.emptyBody")}
        testID="history-empty"
      />
    );
  }
  return (
    <FlatList
      style={styles.page}
      contentContainerStyle={contentStyle}
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <HistoryRow item={item} />}
      testID="history-list"
      ListFooterComponent={
        items.length < total ? (
          <TextButton
            label={t("history.loadMore")}
            onPress={() => void loadMore()}
            loading={loadingMore}
            testID="history-load-more"
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  row: {
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    alignItems: "center",
    minHeight: 76,
  },
  pressed: {
    opacity: 0.6,
  },
  iconWell: {
    width: 48,
    height: 48,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    gap: 3,
  },
  trailing: {
    alignItems: "flex-end",
    gap: 3,
  },
});

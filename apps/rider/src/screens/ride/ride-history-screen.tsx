/**
 * Ride history (UC-R-07 step 4) — approved artboard RiderHistory: newest
 * first, every state; a completed ride shows its stored total and opens its
 * receipt, a cancelled one its recorded fee, the rest a dash.
 *
 * M11 (RATE-01) — approved artboard RiderHistoryRate: under each completed
 * ride its own rating state from `Ride.myRating` — "Rate Samer · N days
 * left" (opens the rating screen; the newest is the filled pill, the rest
 * outlined), "You rated N", or "Rating window closed" — all from the
 * history page itself (`RideSummary.myRating` + `counterpartFirstName`).
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import { listRides, type RideSummary } from "../../api/rides";
import { type MyRating, ratingDaysLeft } from "../../api/trust";
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
import { addRatingSubmittedListener } from "../../trust/rating-events";
import { useAccountSuspended } from "../../trust/suspension";

/** What a completed row knows about its own rating (from the summary). */
interface RatingInfo {
  myRating: MyRating | null;
  driverName: string | null;
}

function ratingInfo(item: RideSummary): RatingInfo | null {
  if (item.state !== "completed") return null;
  return {
    myRating: item.myRating ?? null,
    driverName: item.counterpartFirstName ?? null,
  };
}

/** "Rate Samer · 3 days left" with the Arabic dual / plural forms. */
function rateLabel(
  name: string,
  days: number,
  t: (key: string, options?: object) => string,
): string {
  if (days === 1) return t("rateHistory.rateOneDay", { name });
  if (days === 2) return t("rateHistory.rateTwoDays", { name });
  return t("rateHistory.rateDays", { name, count: days });
}

function RatingLine({
  rideId,
  info,
  primary,
}: {
  rideId: string;
  info: RatingInfo;
  primary: boolean;
}) {
  const { t } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const accountSuspended = useAccountSuspended();
  const rating = info.myRating;
  if (!rating) return null;
  if (rating.state === "pending") {
    // A suspended account cannot rate (403): no "Rate" pill then.
    if (accountSuspended) return null;
    const days = ratingDaysLeft(rating.windowEndsAt);
    if (days === null || !info.driverName) return null;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/rate/${encodeURIComponent(rideId)}` as never)}
        style={({ pressed }) => [
          styles.ratePill,
          { flexDirection: row },
          primary ? styles.ratePillPrimary : styles.ratePillOutline,
          pressed && styles.pressed,
        ]}
        testID={`history-rate-${rideId}`}
      >
        {primary ? (
          <Ionicons name="star" size={16} color={colors.onAccent} />
        ) : null}
        <AppText
          variant="secondary"
          weight={800}
          tone={primary ? "onAccent" : "accent"}
        >
          {rateLabel(info.driverName, days, t)}
        </AppText>
      </Pressable>
    );
  }
  if (rating.state === "submitted" && rating.score != null) {
    return (
      <View
        style={[styles.rated, { flexDirection: row }]}
        testID={`history-rated-${rideId}`}
      >
        <Ionicons name="star" size={14} color={colors.textSecondary} />
        <AppText variant="caption" weight={700} tone="secondary">
          {t("rateHistory.youRated", { score: rating.score })}
        </AppText>
      </View>
    );
  }
  if (rating.state === "expired") {
    return (
      <AppText
        variant="caption"
        tone="muted"
        weight={400}
        testID={`history-rating-closed-${rideId}`}
      >
        {t("rateHistory.windowClosed")}
      </AppText>
    );
  }
  return null;
}

function HistoryRow({
  item,
  rating,
  primaryRate,
}: {
  item: RideSummary;
  rating: RatingInfo | null;
  primaryRate: boolean;
}) {
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
    ? rating?.driverName
      ? t("rateHistory.lineWithDriver", {
          date,
          driver: rating.driverName,
          service,
        })
      : t("history.line", { date, service })
    : t("history.line", {
        date,
        service:
          item.cancellationReason === "account_suspended"
            ? t("suspended.historyCancelled")
            : t(`history.states.${item.state}`),
      });
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
    <View style={styles.completedRow}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/receipt/${item.id}` as never)}
        style={({ pressed }) => [
          styles.row,
          styles.rowInGroup,
          { flexDirection: row },
          pressed && styles.pressed,
        ]}
        testID={`history-${item.id}`}
      >
        {content}
      </Pressable>
      {rating ? (
        <View style={[styles.ratingSlot, { flexDirection: row }]}>
          <RatingLine rideId={item.id} info={rating} primary={primaryRate} />
        </View>
      ) : null}
    </View>
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
  // Ratings stored since the page was read (rating screen), by ride id.
  const [ratings, setRatings] = useState<Record<string, MyRating>>({});
  const contentStyle = useInsetContentStyle(styles.content);

  // A rating stored from this list (rating screen) shows at once.
  useEffect(
    () =>
      addRatingSubmittedListener((rideId, score) => {
        setRatings((current) => ({
          ...current,
          [rideId]: { state: "submitted", score },
        }));
      }),
    [],
  );

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
  const infoOf = (item: RideSummary): RatingInfo | null => {
    const info = ratingInfo(item);
    return info && ratings[item.id]
      ? { ...info, myRating: ratings[item.id] }
      : info;
  };
  // One dominant action: only the newest ride still to rate gets the filled pill.
  const firstPending =
    items.find((item) => {
      const rating = infoOf(item)?.myRating;
      return (
        rating?.state === "pending" &&
        ratingDaysLeft(rating.windowEndsAt) !== null
      );
    })?.id ?? null;
  return (
    <FlatList
      style={styles.page}
      contentContainerStyle={contentStyle}
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <HistoryRow
          item={item}
          rating={infoOf(item)}
          primaryRate={item.id === firstPending}
        />
      )}
      extraData={ratings}
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
  completedRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowInGroup: {
    borderBottomWidth: 0,
  },
  ratingSlot: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 14,
    marginTop: -6,
  },
  ratePill: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    alignItems: "center",
    gap: spacing.sm,
  },
  ratePillPrimary: {
    backgroundColor: colors.accent,
  },
  ratePillOutline: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  rated: {
    alignItems: "center",
    gap: 6,
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

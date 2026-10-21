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
 *
 * V1 audit W41 (UC-R-16 "list with filters") — approved artboards
 * V1FRiderHistoryFilters (+Ar), V1FRiderHistoryDates, V1FRiderHistoryEmpty:
 * one filter chip at a time (All / Completed / Cancelled / Scheduled /
 * Shared) and a "Dates" range in the header, both sent to `GET /rides`
 * (`state` / `kind` / `from` / `to`); a summary line names what is shown,
 * rows carry their kind ("Shared · 1 seat", "Scheduled · Economy", an
 * upcoming scheduled ride's badge), and a filtered page with no rides
 * says so with "Clear filters".
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import { listRides, type RideSummary } from "../../api/rides";
import { type MyRating, ratingDaysLeft } from "../../api/trust";
import {
  AppText,
  ChoiceChip,
  EmptyView,
  ErrorView,
  LoadingView,
  ScreenHeader,
  SecondaryButton,
  StatusChip,
  TextButton,
  useDirection,
  useInsetContentStyle,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { countKey } from "../../i18n/plural";
import {
  type DayRange,
  formatRange,
  hasRange,
  HISTORY_FILTERS,
  type HistoryFilter,
  historyParams,
  NO_RANGE,
  rangePhrase,
} from "../../ride/history-filters";
import {
  formatDateTime,
  formatMoney,
  placeLabel,
  serviceName,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { addRatingSubmittedListener } from "../../trust/rating-events";
import { useAccountSuspended } from "../../trust/suspension";
import { HistoryDatesSheet } from "./history-dates-sheet";

type T = (key: string, options?: object) => string;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** "1 seat" / "2 seats" with the Arabic dual and 11+ forms. */
function seatsLabel(count: number, t: T): string {
  return t(
    countKey(
      {
        one: "history.seatOne",
        two: "history.seatTwo",
        few: "history.seatMany",
        many: "history.seatElevenPlus",
      },
      count,
    ),
    { count },
  );
}

/** The service part of a row's line, with its kind (W41). */
function kindLine(item: RideSummary, service: string, t: T): string {
  if (item.kind === "shared") {
    return item.partySize
      ? t("history.kindSharedSeats", { seats: seatsLabel(item.partySize, t) })
      : t("history.kindShared");
  }
  if (item.kind === "scheduled") return t("history.kindScheduled", { service });
  return service;
}

/** The row icon (approved artboards RiderHistory, V1FRiderHistoryFiltersAr). */
function rowIcon(item: RideSummary): { name: IconName; muted: boolean } {
  switch (item.state) {
    case "cancelled_by_rider":
    case "cancelled_by_driver":
      return { name: "close", muted: true };
    case "no_driver_found":
      return { name: "search", muted: true };
    case "scheduled":
      return { name: "time-outline", muted: false };
    case "gathering":
      return { name: "people-outline", muted: false };
    default:
      if (item.kind === "shared") return { name: "people-outline", muted: false };
      if (item.kind === "scheduled") return { name: "time-outline", muted: false };
      return { name: "car-outline", muted: false };
  }
}

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
  const upcoming = item.state === "scheduled";
  const service = kindLine(
    item,
    serviceName(
      { nameEn: item.serviceTypeNameEn, nameAr: item.serviceTypeNameAr },
      locale,
    ),
    t,
  );
  const date = formatDateTime(item.requestedAt, locale);
  const icon = rowIcon(item);
  const subtitle = upcoming
    ? t("history.line", { date, service })
    : completed
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
          name={icon.name}
          size={22}
          color={icon.muted ? colors.textMuted : colors.text}
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
        {upcoming ? (
          <StatusChip
            label={t("history.states.scheduled")}
            tone="accent"
            testID={`history-badge-${item.id}`}
          />
        ) : completed && item.total != null ? (
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

/** The header's "Dates" pill — the applied range with a clear button once set. */
function DatesButton({
  range,
  onOpen,
  onClear,
}: {
  range: DayRange;
  onOpen: () => void;
  onClear: () => void;
}) {
  const { t, locale } = useLocale();
  const { row, flipRows } = useDirection();
  const label = formatRange(range, locale, t);
  if (!label) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [
          styles.datesButton,
          { flexDirection: row },
          pressed && styles.pressed,
        ]}
        testID="history-dates"
      >
        <Ionicons name="calendar-outline" size={18} color={colors.text} />
        <AppText variant="label" weight={800}>
          {t("history.dates.button")}
        </AppText>
      </Pressable>
    );
  }
  return (
    <View
      style={[
        styles.datesSet,
        // Wider padding on the reading-start side, the clear button at the end.
        { flexDirection: row },
        flipRows ? styles.datesSetFlipped : styles.datesSetPadding,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [
          styles.datesSetLabel,
          { flexDirection: row },
          pressed && styles.pressed,
        ]}
        testID="history-dates"
      >
        <Ionicons name="calendar-outline" size={18} color={colors.accent} />
        <AppText variant="label" weight={800} tone="accent">
          {label}
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("history.dates.clear")}
        onPress={onClear}
        hitSlop={4}
        style={({ pressed }) => [styles.datesClear, pressed && styles.pressed]}
        testID="history-dates-clear"
      >
        <Ionicons name="close" size={16} color={colors.accent} />
      </Pressable>
    </View>
  );
}

/** "No cancelled rides" — a filtered page without rides (V1FRiderHistoryEmpty). */
function NoMatch({
  filter,
  range,
  onClear,
}: {
  filter: HistoryFilter;
  range: DayRange;
  onClear: () => void;
}) {
  const { t, locale } = useLocale();
  const phrase = rangePhrase(range, locale, t);
  const what = t(`history.nouns.${filter}`);
  return (
    <View style={styles.noMatch} testID="history-no-match">
      <View style={styles.noMatchIcon}>
        <Ionicons name="search" size={28} color={colors.textSecondary} />
      </View>
      <AppText variant="heading" align="center">
        {t(`history.noMatch.titles.${filter}`)}
      </AppText>
      <AppText
        variant="body"
        tone="secondary"
        align="center"
        style={styles.lines}
      >
        {phrase
          ? t("history.noMatch.bodyRange", { what, range: phrase })
          : t("history.noMatch.body", { what })}
      </AppText>
      <SecondaryButton
        label={t("history.noMatch.clear")}
        onPress={onClear}
        style={styles.noMatchButton}
        testID="history-clear-filters"
      />
    </View>
  );
}

export default function RideHistoryScreen() {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [range, setRange] = useState<DayRange>(NO_RANGE);
  const [datesOpen, setDatesOpen] = useState(false);
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
  // Only the latest filter's answer lands (a slower earlier one is dropped).
  const request = useRef(0);
  const contentStyle = useInsetContentStyle(styles.content);
  const filtered = filter !== "all" || hasRange(range);

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
    const id = ++request.current;
    setStatus("loading");
    try {
      const first = await listRides(0, historyParams(filter, range));
      if (id !== request.current) return;
      setItems(first.items);
      setTotal(first.totalItems);
      setPage(0);
      setStatus("ready");
    } catch (error) {
      if (id !== request.current) return;
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, [filter, range]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const loadMore = async () => {
    const id = request.current;
    setLoadingMore(true);
    try {
      const next = await listRides(page + 1, historyParams(filter, range));
      if (id !== request.current) return;
      setItems((list) => [...list, ...next.items]);
      setTotal(next.totalItems);
      setPage(page + 1);
    } catch {
      // the button stays for another try
    } finally {
      setLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setFilter("all");
    setRange(NO_RANGE);
  };

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

  let body: React.ReactNode;
  if (status === "loading") {
    body = <LoadingView testID="history-loading" />;
  } else if (status === "error") {
    body = <ErrorView kind={failure} onRetry={() => void load()} />;
  } else if (items.length === 0) {
    body = filtered ? (
      <NoMatch filter={filter} range={range} onClear={clearFilters} />
    ) : (
      <EmptyView
        icon="car-outline"
        title={t("history.emptyTitle")}
        body={t("history.emptyBody")}
        testID="history-empty"
      />
    );
  } else {
    body = (
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
        ListHeaderComponent={
          <AppText
            variant="caption"
            tone="muted"
            weight={400}
            style={styles.summary}
            testID="history-summary"
          >
            {t("history.summary", {
              what: t(`history.what.${filter}`),
              when: formatRange(range, locale, t) ?? t("history.anyDate"),
            })}
          </AppText>
        }
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

  return (
    <View style={styles.page}>
      <ScreenHeader
        title={t("history.title")}
        onBack={() => router.back()}
        action={
          <DatesButton
            range={range}
            onOpen={() => setDatesOpen(true)}
            onClear={() => setRange(NO_RANGE)}
          />
        }
        testID="history-header"
      />
      <View
        accessibilityLabel={t("history.filters.label")}
        style={styles.filterBar}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filters, { flexDirection: row }]}
        >
          {HISTORY_FILTERS.map((value) => (
            <ChoiceChip
              key={value}
              label={t(`history.filters.${value}`)}
              selected={filter === value}
              onPress={() => setFilter(value)}
              style={styles.filterChip}
              testID={`history-filter-${value}`}
            />
          ))}
        </ScrollView>
      </View>
      {body}
      <HistoryDatesSheet
        visible={datesOpen}
        initial={range}
        onApply={(next) => {
          setDatesOpen(false);
          setRange(next);
        }}
        onClose={() => setDatesOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  filterBar: {
    flexGrow: 0,
  },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xs,
  },
  filterChip: {
    height: 48,
    paddingHorizontal: 18,
  },
  summary: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  datesButton: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: spacing.sm,
  },
  datesSet: {
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    gap: spacing.xs,
  },
  datesSetPadding: {
    paddingStart: 14,
    paddingEnd: spacing.xs,
  },
  datesSetFlipped: {
    paddingStart: spacing.xs,
    paddingEnd: 14,
  },
  datesSetLabel: {
    height: 48,
    alignItems: "center",
    gap: spacing.xs,
  },
  datesClear: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  noMatch: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xxxl,
    paddingBottom: 80,
  },
  noMatchIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  noMatchButton: {
    alignSelf: "stretch",
    marginTop: spacing.sm,
  },
  lines: {
    lineHeight: 22,
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

import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../api/notifications";
import { NOTIFICATION_CATEGORIES } from "../../api/realtime-types";
import type {
  AppNotification,
  NotificationCategory,
} from "../../api/realtime-types";
import { useAuth } from "../../auth/AuthProvider";
import { useLocale } from "../../i18n/LocaleProvider";
import {
  hrefForLink,
  NOTIFICATIONS_HREF,
} from "../../notifications/deep-links";
import {
  getUnread,
  setUnread,
  useUnreadCount,
} from "../../notifications/unread-store";
import { formatDateTime } from "../../onboarding/dates";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  FailureState,
  Icon,
  LoadingState,
  SafeFlatList,
  ScreenHeader,
  TextButton,
  useDirection,
} from "../ui";

type Filter = NotificationCategory | "all";

type CenterState =
  | { status: "loading" }
  | { status: "error"; kind: FailureKind }
  | {
      status: "loaded";
      items: AppNotification[];
      nextCursor: string | null;
      loadingMore: boolean;
      moreError: FailureKind | null;
    };

function mergeById(
  current: AppNotification[],
  next: AppNotification[],
): AppNotification[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

function NotificationRow({
  item,
  onOpen,
}: {
  item: AppNotification;
  onOpen: (item: AppNotification) => void;
}) {
  const { t } = useTranslation();
  const { language } = useLocale();
  const { flipRows } = useDirection();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !item.read }}
      accessibilityHint={item.read ? undefined : t("notifications.unreadLabel")}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`notification-${item.id}`}
    >
      <View style={[styles.rowLine, flipRows && styles.rowReverse]}>
        <AppText
          variant="caption"
          weight="700"
          color={colors.textMuted}
          style={styles.flex}
        >
          {t(`notifications.categories.${item.category}`)}
        </AppText>
        <AppText variant="caption" weight="400" color={colors.textMuted}>
          {formatDateTime(item.createdAt, language)}
        </AppText>
      </View>
      <View style={[styles.rowLine, flipRows && styles.rowReverse]}>
        {!item.read ? (
          <View
            style={styles.unreadDot}
            testID={`notification-${item.id}-unread`}
          />
        ) : null}
        <AppText
          variant="bodyStrong"
          weight={item.read ? "600" : "800"}
          style={styles.flex}
        >
          {item.title}
        </AppText>
      </View>
      <AppText variant="secondary" color={colors.textSecondary}>
        {item.body}
      </AppText>
    </Pressable>
  );
}

/**
 * UC-S-11 — the server-stored notification center (`app=driver`): newest
 * first with cursor pagination, a category filter, read/unread state,
 * mark-read on open, mark-all-read, and deep links into the app.
 */
export function NotificationCenterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isDriver } = useAuth();
  const { flipRows } = useDirection();
  const unread = useUnreadCount();
  const [filter, setFilter] = useState<Filter>("all");
  const [state, setState] = useState<CenterState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  /** Ignores answers to superseded requests (filter switched mid-flight). */
  const requestId = useRef(0);

  const loadFirstPage = useCallback(
    async (category: Filter, quiet: boolean) => {
      const id = ++requestId.current;
      if (!quiet) setState({ status: "loading" });
      try {
        const page = await getNotifications({
          category: category === "all" ? null : category,
        });
        if (id !== requestId.current) return;
        setUnread(page.unread);
        setState({
          status: "loaded",
          items: page.items,
          nextCursor: page.nextCursor ?? null,
          loadingMore: false,
          moreError: null,
        });
      } catch (error) {
        if (id !== requestId.current) return;
        setState({ status: "error", kind: failureKindOf(error) });
      }
    },
    [],
  );

  useEffect(() => {
    void loadFirstPage(filter, false);
  }, [filter, loadFirstPage]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setActionError(null);
    await loadFirstPage(filter, true);
    setRefreshing(false);
  }, [filter, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (state.status !== "loaded" || !state.nextCursor || state.loadingMore)
      return;
    const cursor = state.nextCursor;
    const id = requestId.current;
    setState({ ...state, loadingMore: true, moreError: null });
    try {
      const page = await getNotifications({
        category: filter === "all" ? null : filter,
        before: cursor,
      });
      if (id !== requestId.current) return;
      setUnread(page.unread);
      setState((current) =>
        current.status === "loaded"
          ? {
              status: "loaded",
              items: mergeById(current.items, page.items),
              nextCursor: page.nextCursor ?? null,
              loadingMore: false,
              moreError: null,
            }
          : current,
      );
    } catch (error) {
      if (id !== requestId.current) return;
      setState((current) =>
        current.status === "loaded"
          ? { ...current, loadingMore: false, moreError: failureKindOf(error) }
          : current,
      );
    }
  }, [state, filter]);

  const setRead = useCallback((ids: Set<string> | "all", read: boolean) => {
    setState((current) =>
      current.status === "loaded"
        ? {
            ...current,
            items: current.items.map((item) =>
              ids === "all" || ids.has(item.id) ? { ...item, read } : item,
            ),
          }
        : current,
    );
  }, []);

  const open = useCallback(
    (item: AppNotification) => {
      setActionError(null);
      if (!item.read) {
        // Optimistic; rolled back if the server refuses.
        setRead(new Set([item.id]), true);
        setUnread(getUnread() - 1);
        markNotificationRead(item.id).catch(() => {
          setRead(new Set([item.id]), false);
          setUnread(getUnread() + 1);
          setActionError("notifications.markReadFailed");
        });
      }
      const href = hrefForLink(item.link, { isDriver });
      if (href !== NOTIFICATIONS_HREF) router.navigate(href);
    },
    [isDriver, router, setRead],
  );

  const markAll = useCallback(async () => {
    setActionError(null);
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setRead("all", true);
      setUnread(0);
    } catch {
      setActionError("notifications.markAllFailed");
    } finally {
      setMarkingAll(false);
    }
  }, [setRead]);

  const filters: Filter[] = ["all", ...NOTIFICATION_CATEGORIES];

  const header = (
    <View style={styles.header}>
      <ScreenHeader title={t("notifications.title")} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.filters, flipRows && styles.rowReverse]}
        accessibilityLabel={t("notifications.filterLabel")}
      >
        {filters.map((option) => {
          const selected = option === filter;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setFilter(option)}
              style={[styles.filterChip, selected && styles.filterChipSelected]}
              testID={`notifications-filter-${option}`}
            >
              <AppText
                variant="secondary"
                weight="700"
                color={selected ? colors.surface : colors.text}
                align="center"
              >
                {option === "all"
                  ? t("notifications.filterAll")
                  : t(`notifications.categories.${option}`)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={[styles.actions, flipRows && styles.rowReverse]}>
        <TextButton
          title={t("notifications.markAllRead")}
          onPress={() => void markAll()}
          disabled={unread === 0}
          busy={markingAll}
          testID="notifications-read-all"
        />
        <TextButton
          title={t("notifications.settings")}
          icon="settings-outline"
          onPress={() => router.push("/notification-preferences")}
          testID="notifications-settings"
        />
      </View>
      {actionError ? (
        <Banner
          tone="danger"
          message={t(actionError)}
          testID="notifications-action-error"
        />
      ) : null}
    </View>
  );

  const empty =
    state.status === "loading" ? (
      <LoadingState testID="notifications-loading" />
    ) : state.status === "error" ? (
      <FailureState
        kind={state.kind}
        onRetry={() => void loadFirstPage(filter, false)}
      />
    ) : (
      <View style={styles.empty} testID="notifications-empty">
        <View style={styles.emptyWell}>
          <Icon name="notifications-off-outline" size={28} />
        </View>
        <AppText variant="heading" align="center">
          {t(
            filter === "all"
              ? "notifications.emptyTitle"
              : "notifications.emptyFilteredTitle",
          )}
        </AppText>
        <AppText variant="secondary" color={colors.textMuted} align="center">
          {t(
            filter === "all"
              ? "notifications.emptyBody"
              : "notifications.emptyFilteredBody",
          )}
        </AppText>
      </View>
    );

  const footer =
    state.status === "loaded" && state.loadingMore ? (
      <ActivityIndicator
        color={colors.accent}
        style={styles.footer}
        testID="notifications-loading-more"
      />
    ) : state.status === "loaded" && state.moreError ? (
      <View style={styles.footer} testID="notifications-more-error">
        <AppText variant="secondary" color={colors.textMuted} align="center">
          {t("notifications.loadMoreFailed")}
        </AppText>
        <TextButton
          title={t("notifications.retry")}
          onPress={() => void loadMore()}
          testID="notifications-more-retry"
        />
      </View>
    ) : null;

  return (
    <SafeFlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={state.status === "loaded" ? state.items : []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <NotificationRow item={item} onOpen={open} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      ItemSeparatorComponent={Separator}
      safeTop
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
        />
      }
      testID="notification-center"
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: {
    paddingHorizontal: spacing.ml,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  header: { gap: spacing.ms, marginBottom: spacing.xs },
  filters: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rowReverse: { flexDirection: "row-reverse" },
  filterChip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.round,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  filterChipSelected: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  row: { paddingVertical: spacing.md, gap: spacing.xs },
  rowPressed: { opacity: 0.6 },
  rowLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1 },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  separator: { height: 1, backgroundColor: colors.line },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  emptyWell: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  footer: {
    alignItems: "center",
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
});

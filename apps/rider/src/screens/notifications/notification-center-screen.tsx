/**
 * Notification center (UC-S-11, NTF-03): the server-stored history of the
 * rider center, newest first, with a category filter, read/unread state,
 * read-all and deep links. Because it is server-side it survives reinstalls
 * and device changes (UC-S-11 A1).
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import {
  type AppNotification,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "../../api/notifications";
import {
  AppText,
  Banner,
  ChoiceChip,
  EmptyView,
  ErrorView,
  LoadingView,
  TextButton,
  useDirection,
  useInsetContentStyle,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import {
  opensNotificationCenter,
  resolveDeepLink,
} from "../../notifications/deep-links";
import { formatNotificationTime } from "../../notifications/format-time";
import { useNotificationCenter } from "../../notifications/use-notification-center";
import { colors, radius, spacing } from "../../theme/tokens";

type Filter = NotificationCategory | null;
const FILTERS: Filter[] = [null, ...NOTIFICATION_CATEGORIES];

export default function NotificationCenterScreen() {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(null);
  const center = useNotificationCenter(filter);
  const listStyle = useInsetContentStyle(styles.list);

  const open = (notification: AppNotification) => {
    center.markRead(notification);
    if (!opensNotificationCenter(notification.link)) {
      router.push(resolveDeepLink(notification.link));
    }
  };

  const renderItem = ({ item }: { item: AppNotification }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !item.read }}
      accessibilityHint={item.read ? undefined : t("notifications.unreadHint")}
      onPress={() => open(item)}
      style={({ pressed }) => [
        styles.item,
        { flexDirection: row },
        pressed && styles.itemPressed,
      ]}
      testID={`notification-${item.id}`}
    >
      <View
        style={[styles.dot, item.read && styles.dotRead]}
        testID={
          item.read
            ? `notification-${item.id}-read`
            : `notification-${item.id}-unread`
        }
      />
      <View style={styles.itemText}>
        <View style={[styles.itemHeader, { flexDirection: row }]}>
          <AppText variant="caption" weight={700} tone="accent">
            {t(`notifications.categories.${item.category}`)}
          </AppText>
          <AppText variant="caption" weight={400} tone="muted">
            {formatNotificationTime(item.createdAt, locale)}
          </AppText>
        </View>
        <AppText variant={item.read ? "body" : "bodyStrong"}>
          {item.title}
        </AppText>
        <AppText variant="secondary" tone="secondary" style={styles.body}>
          {item.body}
        </AppText>
      </View>
    </Pressable>
  );

  const footer = () => {
    if (center.loadingMore) {
      return (
        <View style={styles.footer} testID="notifications-loading-more">
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }
    if (center.loadMoreError) {
      return (
        <View style={styles.footer} testID="notifications-load-more-error">
          <AppText variant="secondary" tone="muted" align="center">
            {t(
              `notifications.loadMore${center.loadMoreError === "network" ? "Network" : "Server"}Error`,
            )}
          </AppText>
          <TextButton
            label={t("common.retry")}
            onPress={center.loadMore}
            testID="notifications-load-more-retry"
          />
        </View>
      );
    }
    if (!center.hasMore && center.items.length > 0) {
      return (
        <View style={styles.footer} testID="notifications-end">
          <AppText variant="secondary" tone="muted" align="center">
            {t("notifications.endOfList")}
          </AppText>
        </View>
      );
    }
    return null;
  };

  let content: React.ReactNode;
  if (center.status.kind === "loading") {
    content = <LoadingView testID="notifications-loading" />;
  } else if (center.status.kind === "error") {
    content = (
      <ErrorView
        kind={center.status.failure}
        onRetry={center.reload}
        testID={`notifications-error-${center.status.failure}`}
      />
    );
  } else if (center.items.length === 0) {
    content = (
      <EmptyView
        title={t(
          filter
            ? "notifications.emptyFilteredTitle"
            : "notifications.emptyTitle",
        )}
        body={t(
          filter
            ? "notifications.emptyFilteredBody"
            : "notifications.emptyBody",
        )}
        testID="notifications-empty"
      />
    );
  } else {
    content = (
      <FlatList
        data={center.items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onEndReached={() => {
          if (center.hasMore && !center.loadMoreError) center.loadMore();
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={footer}
        contentContainerStyle={listStyle}
        refreshControl={
          <RefreshControl
            refreshing={center.refreshing}
            onRefresh={center.refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        testID="notification-list"
      />
    );
  }

  const readAllDisabled = center.unread === 0 || center.markingAll;

  return (
    <View style={styles.container} testID="notification-center-screen">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={[styles.filters, { flexDirection: row }]}
      >
        {FILTERS.map((candidate) => {
          const key = candidate ?? "all";
          return (
            <ChoiceChip
              key={key}
              label={t(
                candidate
                  ? `notifications.categories.${candidate}`
                  : "notifications.filterAll",
              )}
              selected={candidate === filter}
              onPress={() => setFilter(candidate)}
              testID={`notification-filter-${key}`}
            />
          );
        })}
      </ScrollView>

      <View style={[styles.toolbar, { flexDirection: row }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: readAllDisabled }}
          disabled={readAllDisabled}
          onPress={center.markAllRead}
          style={({ pressed }) => [
            styles.toolbarButton,
            { flexDirection: row },
            pressed && styles.itemPressed,
          ]}
          testID="notifications-read-all"
        >
          {center.markingAll ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons
              name="checkmark-done-outline"
              size={18}
              color={center.unread === 0 ? colors.textMuted : colors.accent}
            />
          )}
          <AppText
            variant="label"
            weight={700}
            tone={center.unread === 0 ? "muted" : "accent"}
          >
            {t("notifications.markAllRead")}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/notification-preferences")}
          style={({ pressed }) => [
            styles.toolbarButton,
            { flexDirection: row },
            pressed && styles.itemPressed,
          ]}
          testID="notifications-open-preferences"
        >
          <Ionicons name="options-outline" size={18} color={colors.accent} />
          <AppText variant="label" weight={700} tone="accent">
            {t("notifications.preferences")}
          </AppText>
        </Pressable>
      </View>

      {center.markAllError ? (
        <View style={styles.banner}>
          <Banner
            tone="danger"
            message={t(
              center.markAllError === "network"
                ? "common.networkErrorBody"
                : "notifications.markAllFailed",
            )}
            testID="notifications-read-all-error"
          />
        </View>
      ) : null}

      <View style={styles.content}>{content}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  filterBar: {
    flexGrow: 0,
  },
  filters: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  toolbar: {
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
  },
  toolbarButton: {
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 48,
  },
  banner: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  content: {
    flex: 1,
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  item: {
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  itemPressed: {
    opacity: 0.6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.round,
    marginTop: 4,
    backgroundColor: colors.accent,
  },
  dotRead: {
    backgroundColor: "transparent",
  },
  itemText: {
    flex: 1,
    gap: spacing.xs,
  },
  itemHeader: {
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  body: {
    lineHeight: 20,
  },
  footer: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
});

/**
 * Notification center (UC-S-11, NTF-03): the server-stored history of the
 * rider center, newest first, with a category filter, read/unread state,
 * read-all and deep links. Because it is server-side it survives reinstalls
 * and device changes (UC-S-11 A1).
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  type AppNotification,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from '../../api/notifications';
import { Button, ErrorBanner } from '../../components/form';
import { EmptyView, ErrorView, LoadingView } from '../../components/status-view';
import { useLocale } from '../../i18n/locale-context';
import { opensNotificationCenter, resolveDeepLink } from '../../notifications/deep-links';
import { formatNotificationTime } from '../../notifications/format-time';
import { useNotificationCenter } from '../../notifications/use-notification-center';
import { colors, fontSize, radius, spacing } from '../../theme/tokens';

type Filter = NotificationCategory | null;
const FILTERS: Filter[] = [null, ...NOTIFICATION_CATEGORIES];

export default function NotificationCenterScreen() {
  const { t, locale, isRTL, flipRows } = useLocale();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(null);
  const center = useNotificationCenter(filter);

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
      accessibilityHint={item.read ? undefined : t('notifications.unreadHint')}
      onPress={() => open(item)}
      style={({ pressed }) => [
        styles.item,
        flipRows && styles.rowRtl,
        !item.read && styles.itemUnread,
        pressed && styles.itemPressed,
      ]}
      testID={`notification-${item.id}`}
    >
      <View
        style={[styles.dot, item.read && styles.dotRead]}
        testID={item.read ? `notification-${item.id}-read` : `notification-${item.id}-unread`}
      />
      <View style={styles.itemText}>
        <View style={[styles.itemHeader, flipRows && styles.rowRtl]}>
          <Text style={[styles.category, isRTL && styles.textRtl]}>
            {t(`notifications.categories.${item.category}`)}
          </Text>
          <Text style={styles.time}>{formatNotificationTime(item.createdAt, locale)}</Text>
        </View>
        <Text style={[styles.title, !item.read && styles.titleUnread, isRTL && styles.textRtl]}>
          {item.title}
        </Text>
        <Text style={[styles.body, isRTL && styles.textRtl]}>{item.body}</Text>
      </View>
    </Pressable>
  );

  const footer = () => {
    if (center.loadingMore) {
      return (
        <View style={styles.footer} testID="notifications-loading-more">
          <ActivityIndicator color={colors.purple700} />
        </View>
      );
    }
    if (center.loadMoreError) {
      return (
        <View style={styles.footer} testID="notifications-load-more-error">
          <Text style={[styles.footerText, isRTL && styles.textRtl]}>
            {t(`notifications.loadMore${center.loadMoreError === 'network' ? 'Network' : 'Server'}Error`)}
          </Text>
          <Button
            variant="link"
            label={t('common.retry')}
            onPress={center.loadMore}
            testID="notifications-load-more-retry"
          />
        </View>
      );
    }
    if (!center.hasMore && center.items.length > 0) {
      return (
        <View style={styles.footer} testID="notifications-end">
          <Text style={styles.footerText}>{t('notifications.endOfList')}</Text>
        </View>
      );
    }
    return null;
  };

  let content: React.ReactNode;
  if (center.status.kind === 'loading') {
    content = <LoadingView testID="notifications-loading" />;
  } else if (center.status.kind === 'error') {
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
        title={t(filter ? 'notifications.emptyFilteredTitle' : 'notifications.emptyTitle')}
        body={t(filter ? 'notifications.emptyFilteredBody' : 'notifications.emptyBody')}
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
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={center.refreshing}
            onRefresh={center.refresh}
            tintColor={colors.purple700}
            colors={[colors.purple700]}
          />
        }
        testID="notification-list"
      />
    );
  }

  return (
    <View style={styles.container} testID="notification-center-screen">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={[styles.filters, flipRows && styles.rowRtl]}
      >
        {FILTERS.map((candidate) => {
          const selected = candidate === filter;
          const key = candidate ?? 'all';
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setFilter(candidate)}
              style={[styles.chip, selected && styles.chipSelected]}
              testID={`notification-filter-${key}`}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                {t(candidate ? `notifications.categories.${candidate}` : 'notifications.filterAll')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.toolbar, flipRows && styles.rowRtl]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: center.unread === 0 || center.markingAll }}
          disabled={center.unread === 0 || center.markingAll}
          onPress={center.markAllRead}
          style={[styles.toolbarButton, flipRows && styles.rowRtl]}
          testID="notifications-read-all"
        >
          {center.markingAll ? (
            <ActivityIndicator size="small" color={colors.purple700} />
          ) : (
            <Ionicons
              name="checkmark-done-outline"
              size={18}
              color={center.unread === 0 ? colors.textSubtle : colors.purple700}
            />
          )}
          <Text style={[styles.toolbarLabel, center.unread === 0 && styles.toolbarLabelDisabled]}>
            {t('notifications.markAllRead')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/notification-preferences')}
          style={[styles.toolbarButton, flipRows && styles.rowRtl]}
          testID="notifications-open-preferences"
        >
          <Ionicons name="options-outline" size={18} color={colors.purple700} />
          <Text style={styles.toolbarLabel}>{t('notifications.preferences')}</Text>
        </Pressable>
      </View>

      {center.markAllError ? (
        <View style={styles.banner}>
          <ErrorBanner
            message={t(
              center.markAllError === 'network'
                ? 'common.networkErrorBody'
                : 'notifications.markAllFailed',
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
    backgroundColor: colors.bgLight,
  },
  filterBar: {
    flexGrow: 0,
  },
  filters: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  chip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lavender200,
    backgroundColor: colors.white,
  },
  chipSelected: {
    backgroundColor: colors.purple700,
    borderColor: colors.purple700,
  },
  chipLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  chipLabelSelected: {
    color: colors.white,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  toolbarLabel: {
    color: colors.purple700,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  toolbarLabelDisabled: {
    color: colors.textSubtle,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  banner: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  content: {
    flex: 1,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  item: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  itemUnread: {
    backgroundColor: colors.lavender100,
  },
  itemPressed: {
    opacity: 0.7,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
    backgroundColor: colors.purple500,
  },
  dotRead: {
    backgroundColor: 'transparent',
  },
  itemText: {
    flex: 1,
    gap: spacing.xs,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  category: {
    color: colors.purple700,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  time: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  titleUnread: {
    fontWeight: '700',
  },
  body: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
});

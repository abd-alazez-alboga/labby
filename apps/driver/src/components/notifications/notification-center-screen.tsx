import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications';
import { NOTIFICATION_CATEGORIES } from '../../api/realtime-types';
import type { AppNotification, NotificationCategory } from '../../api/realtime-types';
import { useAuth } from '../../auth/AuthProvider';
import { useLocale } from '../../i18n/LocaleProvider';
import { hrefForLink, NOTIFICATIONS_HREF } from '../../notifications/deep-links';
import {
  getUnread,
  setUnread,
  useUnreadCount,
} from '../../notifications/unread-store';
import { formatDateTime } from '../../onboarding/dates';
import { failureKindOf } from '../../onboarding/server-errors';
import type { FailureKind } from '../../onboarding/server-errors';
import { colors, radius, spacing } from '../../theme/tokens';
import { ErrorBanner } from '../auth/ui';
import { FailureState, LoadingState, useRowStyle, useTextAlign } from '../onboarding/ui';
import { SafeFlatList } from '../safe-area';

type Filter = NotificationCategory | 'all';

type CenterState =
  | { status: 'loading' }
  | { status: 'error'; kind: FailureKind }
  | {
      status: 'loaded';
      items: AppNotification[];
      nextCursor: string | null;
      loadingMore: boolean;
      moreError: FailureKind | null;
    };

function mergeById(current: AppNotification[], next: AppNotification[]): AppNotification[] {
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
  const textAlign = useTextAlign();
  const rowStyle = useRowStyle();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !item.read }}
      accessibilityHint={item.read ? undefined : t('notifications.unreadLabel')}
      onPress={() => onOpen(item)}
      style={[styles.row, !item.read && styles.rowUnread]}
      testID={`notification-${item.id}`}
    >
      <View style={[rowStyle, styles.rowHeader]}>
        <Text style={styles.category}>{t(`notifications.categories.${item.category}`)}</Text>
        <Text style={styles.time}>{formatDateTime(item.createdAt, language)}</Text>
      </View>
      <View style={[rowStyle, styles.titleRow]}>
        {!item.read ? (
          <View style={styles.unreadDot} testID={`notification-${item.id}-unread`} />
        ) : null}
        <Text style={[styles.title, !item.read && styles.titleUnread, { textAlign }]}>
          {item.title}
        </Text>
      </View>
      <Text style={[styles.body, { textAlign }]}>{item.body}</Text>
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
  const rowStyle = useRowStyle();
  const unread = useUnreadCount();
  const [filter, setFilter] = useState<Filter>('all');
  const [state, setState] = useState<CenterState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  /** Ignores answers to superseded requests (filter switched mid-flight). */
  const requestId = useRef(0);

  const loadFirstPage = useCallback(async (category: Filter, quiet: boolean) => {
    const id = ++requestId.current;
    if (!quiet) setState({ status: 'loading' });
    try {
      const page = await getNotifications({
        category: category === 'all' ? null : category,
      });
      if (id !== requestId.current) return;
      setUnread(page.unread);
      setState({
        status: 'loaded',
        items: page.items,
        nextCursor: page.nextCursor ?? null,
        loadingMore: false,
        moreError: null,
      });
    } catch (error) {
      if (id !== requestId.current) return;
      setState({ status: 'error', kind: failureKindOf(error) });
    }
  }, []);

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
    if (state.status !== 'loaded' || !state.nextCursor || state.loadingMore) return;
    const cursor = state.nextCursor;
    const id = requestId.current;
    setState({ ...state, loadingMore: true, moreError: null });
    try {
      const page = await getNotifications({
        category: filter === 'all' ? null : filter,
        before: cursor,
      });
      if (id !== requestId.current) return;
      setUnread(page.unread);
      setState((current) =>
        current.status === 'loaded'
          ? {
              status: 'loaded',
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
        current.status === 'loaded'
          ? { ...current, loadingMore: false, moreError: failureKindOf(error) }
          : current,
      );
    }
  }, [state, filter]);

  const setRead = useCallback((ids: Set<string> | 'all', read: boolean) => {
    setState((current) =>
      current.status === 'loaded'
        ? {
            ...current,
            items: current.items.map((item) =>
              ids === 'all' || ids.has(item.id) ? { ...item, read } : item,
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
          setActionError('notifications.markReadFailed');
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
      setRead('all', true);
      setUnread(0);
    } catch {
      setActionError('notifications.markAllFailed');
    } finally {
      setMarkingAll(false);
    }
  }, [setRead]);

  const filters: Filter[] = ['all', ...NOTIFICATION_CATEGORIES];

  const header = (
    <View style={styles.header}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[rowStyle, styles.filters]}
        accessibilityLabel={t('notifications.filterLabel')}
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
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                {option === 'all'
                  ? t('notifications.filterAll')
                  : t(`notifications.categories.${option}`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={[rowStyle, styles.actions]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: unread === 0 || markingAll }}
          onPress={() => {
            if (unread > 0 && !markingAll) void markAll();
          }}
          style={styles.actionButton}
          testID="notifications-read-all"
        >
          {markingAll ? (
            <ActivityIndicator color={colors.purple700} />
          ) : (
            <Text style={[styles.actionText, unread === 0 && styles.actionDisabled]}>
              {t('notifications.markAllRead')}
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/notification-preferences')}
          style={[rowStyle, styles.actionButton, styles.settingsButton]}
          testID="notifications-settings"
        >
          <Ionicons name="settings-outline" size={20} color={colors.purple700} />
          <Text style={styles.actionText}>{t('notifications.settings')}</Text>
        </Pressable>
      </View>
      {actionError ? <ErrorBanner testID="notifications-action-error">{t(actionError)}</ErrorBanner> : null}
    </View>
  );

  const empty =
    state.status === 'loading' ? (
      <LoadingState testID="notifications-loading" />
    ) : state.status === 'error' ? (
      <FailureState kind={state.kind} onRetry={() => void loadFirstPage(filter, false)} />
    ) : (
      <View style={styles.empty} testID="notifications-empty">
        <Ionicons name="notifications-off-outline" size={40} color={colors.textSubtle} />
        <Text style={styles.emptyTitle}>
          {t(filter === 'all' ? 'notifications.emptyTitle' : 'notifications.emptyFilteredTitle')}
        </Text>
        <Text style={styles.emptyBody}>
          {t(filter === 'all' ? 'notifications.emptyBody' : 'notifications.emptyFilteredBody')}
        </Text>
      </View>
    );

  const footer =
    state.status === 'loaded' && state.loadingMore ? (
      <ActivityIndicator
        color={colors.purple700}
        style={styles.footer}
        testID="notifications-loading-more"
      />
    ) : state.status === 'loaded' && state.moreError ? (
      <View style={styles.footer} testID="notifications-more-error">
        <Text style={styles.emptyBody}>{t('notifications.loadMoreFailed')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void loadMore()}
          style={styles.actionButton}
          testID="notifications-more-retry"
        >
          <Text style={styles.actionText}>{t('notifications.retry')}</Text>
        </Pressable>
      </View>
    ) : null;

  return (
    <SafeFlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={state.status === 'loaded' ? state.items : []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <NotificationRow item={item} onOpen={open} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
      }
      testID="notification-center"
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgLight },
  content: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  header: { gap: spacing.sm, marginBottom: spacing.xs },
  filters: { gap: spacing.sm, paddingVertical: spacing.xs },
  filterChip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lilac200,
    backgroundColor: colors.white,
  },
  filterChipSelected: { backgroundColor: colors.purple700, borderColor: colors.purple700 },
  filterText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  filterTextSelected: { color: colors.white },
  actions: { justifyContent: 'space-between', gap: spacing.sm },
  actionButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  settingsButton: { gap: spacing.xs },
  actionText: { color: colors.purple700, fontSize: 15, fontWeight: '600' },
  actionDisabled: { color: colors.textSubtle },
  row: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.lilac200,
  },
  rowUnread: { borderColor: colors.purple400, backgroundColor: colors.bgTint },
  rowHeader: { justifyContent: 'space-between', gap: spacing.sm },
  category: { color: colors.purple700, fontSize: 12, fontWeight: '700' },
  time: { color: colors.textMuted, fontSize: 12 },
  titleRow: { gap: spacing.sm },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.purple700 },
  title: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '500' },
  titleUnread: { fontWeight: '700' },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  footer: { alignItems: 'center', paddingVertical: spacing.md, gap: spacing.xs },
});

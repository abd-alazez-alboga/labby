/**
 * Component-scoped store of the notification center screen (UC-S-11):
 * cursor pagination per category filter, pull-to-refresh, mark one read
 * (optimistic, reverted on failure) and read-all. Every page answer carries
 * the center-wide unread count, which is mirrored into the app badge.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { type FailureKind, failureKind } from "../api/http-client";
import {
  type AppNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationCategory,
} from "../api/notifications";
import { useOptionalNotifications } from "./notifications-context";

export type CenterStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; failure: FailureKind };

export interface NotificationCenter {
  status: CenterStatus;
  items: AppNotification[];
  unread: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: FailureKind | null;
  refreshing: boolean;
  markingAll: boolean;
  markAllError: FailureKind | null;
  reload: () => void;
  refresh: () => void;
  loadMore: () => void;
  markRead: (notification: AppNotification) => void;
  markAllRead: () => void;
}

export function useNotificationCenter(
  category: NotificationCategory | null,
): NotificationCenter {
  const badge = useOptionalNotifications();
  const setBadge = badge?.setUnread;
  const [status, setStatus] = useState<CenterStatus>({ kind: "loading" });
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnreadState] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<FailureKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllError, setMarkAllError] = useState<FailureKind | null>(null);
  /** Bumped per first-page request so stale answers (old filter) are dropped. */
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Mirrors `unread` so optimistic updates never read a stale closure. */
  const unreadRef = useRef(0);
  const setUnread = useCallback(
    (count: number) => {
      const next = Math.max(0, count);
      unreadRef.current = next;
      setUnreadState(next);
      setBadge?.(next);
    },
    [setBadge],
  );

  const loadFirstPage = useCallback(
    async (mode: "initial" | "refresh") => {
      const current = ++generation.current;
      if (mode === "initial") {
        setStatus({ kind: "loading" });
        setItems([]);
        setNextCursor(null);
      } else {
        setRefreshing(true);
      }
      setLoadMoreError(null);
      setMarkAllError(null);
      try {
        const page = await listNotifications({ category });
        if (!mounted.current || current !== generation.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor ?? null);
        setUnread(page.unread);
        setStatus({ kind: "ready" });
      } catch (error) {
        if (!mounted.current || current !== generation.current) return;
        // A failed pull-to-refresh keeps the list that is already shown.
        if (mode === "initial")
          setStatus({ kind: "error", failure: failureKind(error) });
      } finally {
        if (mounted.current && current === generation.current)
          setRefreshing(false);
      }
    },
    [category, setUnread],
  );

  // (Re)load from the first page whenever the category filter changes.
  useEffect(() => {
    (async () => {
      await loadFirstPage("initial");
    })();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || status.kind !== "ready") return;
    const current = generation.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await listNotifications({ category, before: nextCursor });
      if (!mounted.current || current !== generation.current) return;
      setItems((previous) => {
        const known = new Set(previous.map((item) => item.id));
        return [
          ...previous,
          ...page.items.filter((item) => !known.has(item.id)),
        ];
      });
      setNextCursor(page.nextCursor ?? null);
      setUnread(page.unread);
    } catch (error) {
      if (mounted.current && current === generation.current) {
        setLoadMoreError(failureKind(error));
      }
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }, [category, loadingMore, nextCursor, setUnread, status.kind]);

  const markRead = useCallback(
    (notification: AppNotification) => {
      if (notification.read) return;
      const setRead = (read: boolean) =>
        setItems((previous) =>
          previous.map((item) =>
            item.id === notification.id ? { ...item, read } : item,
          ),
        );
      setRead(true);
      setUnread(unreadRef.current - 1);
      markNotificationRead(notification.id).catch(() => {
        if (!mounted.current) return;
        setRead(false);
        setUnread(unreadRef.current + 1);
      });
    },
    [setUnread],
  );

  const markAllRead = useCallback(async () => {
    setMarkingAll(true);
    setMarkAllError(null);
    try {
      await markAllNotificationsRead();
      if (!mounted.current) return;
      setItems((previous) =>
        previous.map((item) => (item.read ? item : { ...item, read: true })),
      );
      setUnread(0);
    } catch (error) {
      if (mounted.current) setMarkAllError(failureKind(error));
    } finally {
      if (mounted.current) setMarkingAll(false);
    }
  }, [setUnread]);

  return {
    status,
    items,
    unread,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMoreError,
    refreshing,
    markingAll,
    markAllError,
    reload: () => void loadFirstPage("initial"),
    refresh: () => void loadFirstPage("refresh"),
    loadMore: () => void loadMore(),
    markRead,
    markAllRead: () => void markAllRead(),
  };
}

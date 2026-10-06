import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_CATEGORIES,
  type AppNotification,
  type NotificationCategory,
} from '../api/notifications';
import { useAuth } from '../auth/AuthContext';
import {
  deepLinkToPath,
  NOTIFICATION_CENTER_PATH,
  NOTIFICATION_PREFERENCES_PATH,
} from '../notifications/deep-links';
import { useNotifications } from '../notifications/NotificationsProvider';
import { useToast } from '../toast/ToastProvider';
import { classifyError, formatDateTime, type FailureKind } from './onboarding/review-utils';

const PAGE_SIZE = 20;

function failureKey(kind: FailureKind): string {
  return kind === 'network' ? 'notifications.errors.network' : 'notifications.errors.server';
}

/**
 * UC-S-11 / NTF-03: the admin's notification center — server-stored, so
 * it survives a new browser or device. Newest first with cursor paging
 * ("Load more"), category filter, unread markers. Opening an item marks it
 * read and follows its deep link (unmapped links stay in the center);
 * "Mark all as read" clears the admin center. Every count reported here
 * feeds the top-bar badge.
 */
export default function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { apiClient } = useAuth();
  const { unread, reportUnread, refreshUnread, arrivals } = useNotifications();
  const { show } = useToast();

  const [category, setCategory] = useState<NotificationCategory | null>(null);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<FailureKind | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  // Bumped on every filter change/reload so late pages of an old list are dropped.
  const generation = useRef(0);
  // Arrivals already reflected in the loaded list; more → offer to show them.
  const arrivalsRef = useRef(arrivals);
  arrivalsRef.current = arrivals;
  const [listedArrivals, setListedArrivals] = useState(arrivals);

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    setListedArrivals(arrivalsRef.current);
    setItems(null);
    setNextCursor(null);
    setLoadError(null);
    setMoreError(null);
    listNotifications(apiClient, { category: category ?? undefined, size: PAGE_SIZE })
      .then((page) => {
        if (generation.current !== mine) return;
        setItems(page.items);
        setNextCursor(page.nextCursor ?? null);
        reportUnread(page.unread);
      })
      .catch((error: unknown) => {
        if (generation.current === mine) setLoadError(classifyError(error));
      });
  }, [apiClient, category, attempt, reportUnread]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listNotifications(apiClient, {
        category: category ?? undefined,
        before: nextCursor,
        size: PAGE_SIZE,
      });
      if (generation.current !== mine) return;
      setItems((current) => {
        const seen = new Set((current ?? []).map((item) => item.id));
        return [...(current ?? []), ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor ?? null);
      reportUnread(page.unread);
    } catch (error) {
      if (generation.current === mine) setMoreError(classifyError(error));
    } finally {
      if (generation.current === mine) setLoadingMore(false);
    }
  }, [apiClient, category, nextCursor, reportUnread]);

  function setRead(id: string, read: boolean) {
    setItems((current) =>
      current ? current.map((item) => (item.id === id ? { ...item, read } : item)) : current,
    );
  }

  async function openItem(item: AppNotification) {
    const target = deepLinkToPath(item.link);
    if (!item.read) {
      setRead(item.id, true);
      try {
        await markNotificationRead(apiClient, item.id);
        void refreshUnread();
      } catch {
        setRead(item.id, false);
        show({ tone: 'error', message: t('notifications.errors.markRead') });
        return;
      }
    }
    if (target !== NOTIFICATION_CENTER_PATH) {
      navigate(target);
    }
  }

  async function markAll() {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead(apiClient);
      setItems((current) => (current ? current.map((item) => ({ ...item, read: true })) : current));
      reportUnread(0);
      show({ tone: 'success', message: t('notifications.allMarkedRead') });
    } catch {
      show({ tone: 'error', message: t('notifications.errors.markAllRead') });
    } finally {
      setMarkingAll(false);
    }
  }

  const hasUnread = (unread ?? 0) > 0 || (items ?? []).some((item) => !item.read);

  return (
    <section>
      <div className="section__header">
        <h1 className="page__title">{t('notifications.title')}</h1>
        <div className="table__actions">
          <button
            type="button"
            className="btn"
            onClick={() => void markAll()}
            disabled={markingAll || !hasUnread}
          >
            {markingAll ? t('notifications.markingAll') : t('notifications.markAllRead')}
          </button>
          <Link className="btn" to={NOTIFICATION_PREFERENCES_PATH}>
            {t('notifications.preferencesLink')}
          </Link>
        </div>
      </div>
      <p className="page__subtitle">
        {t('notifications.subtitle')}{' '}
        {unread !== null ? (
          <span className="queue-count">{t('notifications.unreadCount', { count: unread })}</span>
        ) : null}
      </p>

      <div className="filter-chips" role="group" aria-label={t('notifications.filterLabel')}>
        <button
          type="button"
          className={category === null ? 'filter-chip filter-chip--active' : 'filter-chip'}
          aria-pressed={category === null}
          onClick={() => setCategory(null)}
        >
          {t('notifications.allCategories')}
        </button>
        {NOTIFICATION_CATEGORIES.map((code) => (
          <button
            key={code}
            type="button"
            className={category === code ? 'filter-chip filter-chip--active' : 'filter-chip'}
            aria-pressed={category === code}
            onClick={() => setCategory(code)}
          >
            {t(`notifications.category.${code}`)}
          </button>
        ))}
      </div>

      <div className="notification-list-wrap">
        {arrivals !== listedArrivals && items !== null ? (
          <button
            type="button"
            className="btn btn--small notification-list__new"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t('notifications.showNew')}
          </button>
        ) : null}
        {loadError ? (
          <div className="banner banner--error" role="alert">
            <span>{t(failureKey(loadError))}</span>{' '}
            <button
              className="btn btn--small"
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {t('notifications.retry')}
            </button>
          </div>
        ) : items === null ? (
          <div className="loading">{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <p className="banner banner--info">
            {category === null
              ? t('notifications.empty')
              : t('notifications.emptyCategory', {
                  category: t(`notifications.category.${category}`),
                })}
          </p>
        ) : (
          <>
            <ul className="notification-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.read ? 'notification' : 'notification notification--unread'}
                    onClick={() => void openItem(item)}
                  >
                    <span className="notification__header">
                      {item.read ? null : <span className="notification__dot" aria-hidden="true" />}
                      <span className="notification__title" dir="auto">
                        {item.title}
                      </span>
                      {item.read ? null : (
                        <span className="visually-hidden">{t('notifications.unreadMarker')}</span>
                      )}
                    </span>
                    <span className="notification__body" dir="auto">
                      {item.body}
                    </span>
                    <span className="notification__meta">
                      <span className="chip">{t(`notifications.category.${item.category}`)}</span>
                      <time dateTime={item.createdAt}>
                        {formatDateTime(item.createdAt, i18n.language)}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {moreError ? (
              <div className="banner banner--error" role="alert">
                {t(failureKey(moreError))}
              </div>
            ) : null}
            {nextCursor ? (
              <button
                type="button"
                className="btn notification-list__more"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? t('common.loading') : t('notifications.loadMore')}
              </button>
            ) : (
              <p className="queue-count">{t('notifications.endOfList')}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

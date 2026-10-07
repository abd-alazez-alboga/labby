import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { NOTIFICATION_CENTER_PATH } from './deep-links';
import { useNotifications } from './NotificationsProvider';

/** Badge text: exact up to 99, then "99+" so the pill keeps its size. */
function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Top-bar entry to the notification center with the unread badge (NTF-03). */
export function NotificationBell() {
  const { t } = useTranslation();
  const { unread } = useNotifications();
  const label =
    unread && unread > 0
      ? t('notifications.bellLabelUnread', { count: unread })
      : t('notifications.bellLabel');

  return (
    <NavLink
      to={NOTIFICATION_CENTER_PATH}
      end
      className={({ isActive }) => (isActive ? 'bell bell--active' : 'bell')}
      aria-label={label}
      title={label}
    >
      <svg
        className="bell__icon"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {unread && unread > 0 ? (
        <span className="bell__badge" aria-hidden="true">
          {formatBadgeCount(unread)}
        </span>
      ) : null}
    </NavLink>
  );
}

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
      <svg className="bell__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
        />
      </svg>
      {unread && unread > 0 ? (
        <span className="bell__badge" aria-hidden="true">
          {formatBadgeCount(unread)}
        </span>
      ) : null}
    </NavLink>
  );
}

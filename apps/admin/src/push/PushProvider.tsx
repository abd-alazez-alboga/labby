import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { markNotificationRead, registerDevice, unregisterDevice } from '../api/notifications';
import { useAuth } from '../auth/AuthContext';
import { useConfig } from '../config/ConfigContext';
import { deepLinkFromPushData, deepLinkToPath } from '../notifications/deep-links';
import { useNotifications } from '../notifications/NotificationsProvider';
import { useToast } from '../toast/ToastProvider';
import { loadWebPush, type WebPushClient, type WebPushMessage } from './web-push';

/**
 * Browser-push state for this tab:
 * - `unconfigured`: no `firebaseWeb` in config.json — nothing is loaded or shown.
 * - `unsupported`: the browser cannot do web push (no Notification API / FCM support).
 * - `prompt`: the admin has not decided yet — they opt in with an explicit button.
 * - `denied`: blocked in the browser's site settings.
 * - `registering` → `registered` | `failed`.
 */
export type PushStatus =
  'unconfigured' | 'unsupported' | 'prompt' | 'denied' | 'registering' | 'registered' | 'failed';

export interface PushApi {
  status: PushStatus;
  /** Asks for notification permission (call from a user gesture) and registers on grant. */
  enable(): Promise<void>;
}

const PushContext = createContext<PushApi | null>(null);

function initialStatus(configured: boolean): PushStatus {
  if (!configured) {
    return 'unconfigured';
  }
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  switch (Notification.permission) {
    case 'granted':
      return 'registering';
    case 'denied':
      return 'denied';
    default:
      return 'prompt';
  }
}

/**
 * Web push registration (ES-03, UC-S-25) for the signed-in admin:
 * when config.json has a `firebaseWeb` block and permission is granted it
 * obtains this browser's FCM token and `PUT /devices {token, platform:'web',
 * app:'admin'}`; a deliberate logout `DELETE`s the token before the session
 * is revoked; foreground pushes surface as toasts and refresh the badge.
 * Never prompts on load — the admin opts in from the preferences page.
 * Without the config block it does nothing at all (no SDK, no errors).
 */
export function PushProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { apiClient, registerLogoutHandler } = useAuth();
  const { firebaseWeb } = useConfig();
  const { show } = useToast();
  const { refreshUnread, signalArrival } = useNotifications();

  const [status, setStatus] = useState<PushStatus>(() => initialStatus(firebaseWeb !== undefined));
  const [client, setClient] = useState<WebPushClient | null>(null);
  const tokenRef = useRef<string | null>(null);
  const started = useRef(false);

  const register = useCallback(async () => {
    if (!firebaseWeb) {
      return;
    }
    setStatus('registering');
    try {
      const loaded = await loadWebPush(firebaseWeb);
      if (!loaded) {
        setStatus('unsupported');
        return;
      }
      const token = await loaded.getToken();
      await registerDevice(apiClient, token);
      tokenRef.current = token;
      setClient(loaded);
      setStatus('registered');
    } catch (error) {
      console.warn('Browser push registration failed:', error);
      setStatus('failed');
    }
  }, [apiClient, firebaseWeb]);

  // Re-register on every signed-in load when permission is already granted:
  // the PUT is idempotent and covers FCM token rotation (contract).
  useEffect(() => {
    if (started.current || status !== 'registering') {
      return;
    }
    started.current = true;
    void register();
  }, [register, status]);

  const enable = useCallback(async () => {
    if (!firebaseWeb || typeof Notification === 'undefined') {
      return;
    }
    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
    if (permission === 'granted') {
      started.current = true;
      await register();
    } else {
      setStatus(permission === 'denied' ? 'denied' : 'prompt');
    }
  }, [firebaseWeb, register]);

  // A foreground push becomes a toast (the payload is already in the admin's
  // language). `safety` pushes are sticky critical alerts — the category M10
  // SOS alerts use — so they cannot time out unseen. Opening the toast is
  // opening the notification: mark it read, then follow its deep link.
  const handleMessage = useCallback(
    (message: WebPushMessage) => {
      signalArrival();
      const notificationId = message.data.notificationId;
      const target = deepLinkToPath(deepLinkFromPushData(message.data));
      show({
        id: notificationId ? `push-${notificationId}` : undefined,
        tone: message.data.category === 'safety' ? 'critical' : 'info',
        title: message.title || t('push.foregroundTitle'),
        message: message.body ?? '',
        action: {
          label: t('push.open'),
          onClick: () => {
            if (notificationId) {
              markNotificationRead(apiClient, notificationId)
                .then(() => refreshUnread())
                .catch(() => {
                  // Best effort: the item stays unread in the center.
                });
            }
            navigate(target);
          },
        },
      });
    },
    [apiClient, navigate, refreshUnread, show, signalArrival, t],
  );

  useEffect(() => (client ? client.onMessage(handleMessage) : undefined), [client, handleMessage]);

  // Unregister this browser's token while the session is still valid.
  useEffect(
    () =>
      registerLogoutHandler(async () => {
        const token = tokenRef.current;
        if (token) {
          tokenRef.current = null;
          await unregisterDevice(apiClient, token);
        }
      }),
    [apiClient, registerLogoutHandler],
  );

  const value = useMemo<PushApi>(() => ({ status, enable }), [status, enable]);
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

/** Typed access to the browser-push state. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePush(): PushApi {
  const value = useContext(PushContext);
  if (value === null) {
    throw new Error('usePush must be used inside <PushProvider>');
  }
  return value;
}

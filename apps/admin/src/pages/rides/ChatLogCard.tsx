import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../api/client';
import { getAdminChatLog, type AdminChatLog, type ChatMessage } from '../../api/comms';
import { useAuth } from '../../auth/AuthContext';
import { Section } from '../../ui';
import { formatClock } from '../surge';

/**
 * CHAT-03: the ride's full chat log, read-only and audited. Rendered only
 * for admins with `support:view` (the page gates); the backend enforces the
 * same code on GET /admin/rides/{rideId}/chat. 404 = the ride was never
 * accepted, so no thread exists.
 */
export function ChatLogCard({
  rideId,
  riderName,
  driverName,
}: {
  rideId: string;
  riderName: string;
  driverName: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const [log, setLog] = useState<AdminChatLog | null>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'noThread' | 'failed'>('loading');
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setLog(null);
    getAdminChatLog(apiClient, rideId)
      .then((loaded) => {
        if (!cancelled) {
          setLog(loaded);
          setState('loaded');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState(error instanceof ApiError && error.status === 404 ? 'noThread' : 'failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, rideId]);

  async function loadOlder() {
    if (!log?.nextCursor) {
      return;
    }
    setLoadingOlder(true);
    try {
      const older = await getAdminChatLog(apiClient, rideId, log.nextCursor);
      setLog({ ...older, items: [...older.items, ...log.items] });
    } catch {
      // Keep what is shown; the button stays for a retry.
    } finally {
      setLoadingOlder(false);
    }
  }

  function messageText(message: ChatMessage): string {
    if (message.kind === 'quick_reply' && message.quickReply) {
      return i18n.language.startsWith('ar') ? message.quickReply.textAr : message.quickReply.textEn;
    }
    return message.body ?? '';
  }

  return (
    <Section
      title={t('rideDetail.chat.title')}
      actions={<span className="panel__hint">{t('rideDetail.chat.readOnly')}</span>}
    >
      {state === 'loading' ? (
        <div className="loading">{t('common.loading')}</div>
      ) : state === 'noThread' ? (
        <p className="panel__hint">{t('rideDetail.chat.noThread')}</p>
      ) : state === 'failed' ? (
        <p className="banner banner--error" role="alert">
          {t('rideDetail.chat.loadFailed')}
        </p>
      ) : log && log.items.length === 0 ? (
        <p className="panel__hint">{t('rideDetail.chat.empty')}</p>
      ) : log ? (
        <>
          {log.nextCursor ? (
            <button
              className="btn btn--small"
              type="button"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {t('rideDetail.chat.loadEarlier')}
            </button>
          ) : null}
          <ol className="chat-log">
            {log.items.map((message) => (
              <li
                key={message.messageId}
                className={
                  message.senderRole === 'rider'
                    ? 'chat-log__bubble chat-log__bubble--rider'
                    : 'chat-log__bubble chat-log__bubble--driver'
                }
              >
                <span className="chat-log__meta">
                  {message.senderRole === 'rider'
                    ? riderName
                    : (driverName ?? t('rideDetail.chat.driverFallback'))}
                  {' · '}
                  {formatClock(message.sentAt, i18n.language)}
                </span>
                <span className="chat-log__text">{messageText(message)}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </Section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../api/client';
import { getAdminChatLog, type AdminChatLog, type ChatMessage } from '../../api/comms';
import type { AdminSharedMember } from '../../api/rides';
import { useAuth } from '../../auth/AuthContext';
import { Section } from '../../ui';
import { formatClock } from '../surge';

/**
 * CHAT-03: the ride's full chat log, read-only and audited. Rendered only
 * for admins with `support:view` (the page gates); the backend enforces the
 * same code on GET /admin/rides/{rideId}/chat. 404 = the ride was never
 * accepted, so no thread exists. M12 (artboard "shared ride chat log per
 * member"): a shared ride has one private thread per member — given its
 * `members`, the card switches between them (one audited read per opened
 * thread, never a fan-out); without them (the report page) it explains.
 * A lost-item case passes its reporter's single `memberId` instead.
 */
export function ChatLogCard({
  rideId,
  riderName,
  driverName,
  members = null,
  memberId: fixedMemberId = null,
}: {
  rideId: string;
  riderName: string;
  driverName: string | null;
  /** A shared ride's parties after dispatch (no `left`), else null. */
  members?: AdminSharedMember[] | null;
  /**
   * One known member's thread without the switcher (a shared-ride lost-item
   * case reads its reporter's chat, M14 T6 amendment h); ignored with `members`.
   */
  memberId?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const [log, setLog] = useState<AdminChatLog | null>(null);
  const [state, setState] = useState<
    'loading' | 'loaded' | 'noThread' | 'memberRequired' | 'failed'
  >('loading');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const shared = members !== null && members.length > 0;
  const [memberId, setMemberId] = useState<string | null>(
    shared ? members[0].memberId : fixedMemberId,
  );
  const selectedIndex = shared ? members.findIndex((m) => m.memberId === memberId) : -1;
  const selected = selectedIndex >= 0 && members ? members[selectedIndex] : null;

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setLog(null);
    getAdminChatLog(apiClient, rideId, undefined, memberId ?? undefined)
      .then((loaded) => {
        if (!cancelled) {
          setLog(loaded);
          setState('loaded');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState(
            error instanceof ApiError && error.status === 404
              ? 'noThread'
              : error instanceof ApiError && error.code === 'member_required'
                ? 'memberRequired'
                : 'failed',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, rideId, memberId]);

  function memberLabel(member: AdminSharedMember, index: number): string {
    const name = member.firstName?.trim() || t('rideDetail.chat.memberFallback', { n: index + 1 });
    return member.isCreator ? t('rideDetail.chat.creator', { name }) : name;
  }
  const bubbleRider = selected
    ? selected.firstName?.trim() || t('rideDetail.chat.memberFallback', { n: selectedIndex + 1 })
    : riderName;

  // M12 review W11: the thread on screen, for dropping an "earlier messages"
  // answer that lands after the admin switched to another member.
  const shownThread = useRef(memberId);
  shownThread.current = memberId;

  async function loadOlder() {
    if (!log?.nextCursor) {
      return;
    }
    const asked = memberId;
    setLoadingOlder(true);
    try {
      const older = await getAdminChatLog(apiClient, rideId, log.nextCursor, asked ?? undefined);
      if (shownThread.current === asked) {
        setLog((current) =>
          current ? { ...older, items: [...older.items, ...current.items] } : current,
        );
      }
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
      {shared ? (
        <>
          <p className="panel__hint">{t('rideDetail.chat.memberIntro')}</p>
          <div className="segmented" role="group" aria-label={t('rideDetail.chat.memberTabs')}>
            {members.map((member, index) => (
              <button
                key={member.memberId}
                type="button"
                className="segmented__option"
                aria-pressed={member.memberId === memberId}
                onClick={() => setMemberId(member.memberId)}
              >
                {memberLabel(member, index)}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {state === 'loading' ? (
        <div className="loading">{t('common.loading')}</div>
      ) : state === 'noThread' ? (
        <p className="panel__hint">
          {shared ? t('rideDetail.chat.memberNoThread') : t('rideDetail.chat.noThread')}
        </p>
      ) : state === 'memberRequired' ? (
        <p className="panel__hint">{t('rideDetail.chat.memberRequired')}</p>
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
                    ? bubbleRider
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

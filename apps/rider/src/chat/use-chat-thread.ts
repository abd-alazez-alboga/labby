/**
 * The chat screen's state machine (M10, UC-S-13/14 · CHAT-01/02):
 *
 * - loads the thread, the latest history page and the quick-reply catalog
 *   (REST), then follows the live `chat.message` / `chat.read` frames on
 *   the realtime socket through the ride facade;
 * - sends with a client-generated UUID (`clientMsgId`): the echo frame is
 *   the delivery ack; an unacked message stays pending and is RESENT after
 *   every reconnect — the server dedups on `clientMsgId`, so a resend can
 *   never duplicate (UC-S-13 E2);
 * - reconnect backfill: on every socket ready the history after the last
 *   seen message id is fetched and merged (dedup by messageId), and the
 *   thread is re-read (the window may have changed);
 * - read markers both ways: incoming counterpart messages are marked read
 *   while the screen is open (WS frame, REST fallback) and the
 *   counterpart's `chat.read` drives the "Seen" marker;
 * - obeys the window: writes only while `open`/`reopened`; a `chat_closed`
 *   / `chat_not_open` error re-reads the thread and drops the queue.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ChatMessage,
  type ChatThread,
  getChatMessages,
  getChatThread,
  getQuickReplies,
  postChatRead,
  type QuickReply,
} from "../api/comms";
import { ApiError } from "../api/http-client";
import type { ChatClientFrame, ChatServerEvent } from "../realtime/protocol";
import { useActiveRide } from "../ride/ride-context";
import { useOptionalChat } from "./chat-context";

/** RFC 4122 v4 id — `crypto.randomUUID` when the runtime has it. */
export function newClientMsgId(): string {
  const cryptoObj = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  if (typeof cryptoObj?.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  // Fallback (Hermes without the Web Crypto API): a dedup key, not a secret.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export interface PendingMessage {
  clientMsgId: string;
  kind: "text" | "quick_reply";
  body?: string;
  quickReplyCode?: string;
  /** Local clock, display only. */
  sentAtMs: number;
}

export type ChatStatus = "loading" | "ready" | "missing" | "error";

export interface ChatThreadValue {
  status: ChatStatus;
  thread: ChatThread | null;
  /** Oldest → newest. */
  messages: ChatMessage[];
  /** Sent but not yet echoed (rendered after `messages`). */
  pending: PendingMessage[];
  quickReplies: QuickReply[];
  /** Window allows writes (`open` / `reopened`). */
  canWrite: boolean;
  /** The counterpart read up to this message id ("Seen"). */
  counterpartSeenMessageId: string | null;
  /** A message the server refused (`invalid_message`). */
  sendFailed: boolean;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  sendText: (body: string) => void;
  sendQuickReply: (reply: QuickReply) => void;
  loadEarlier: () => void;
  reload: () => void;
}

function isWritable(thread: ChatThread | null): boolean {
  return (
    thread?.windowState === "open" || thread?.windowState === "reopened"
  );
}

export function useChatThread(rideId: string): ChatThreadValue {
  // Only the STABLE facade/badge functions are captured (not the objects):
  // the facade value changes on every ride frame and must not retrigger
  // loads or resubscriptions.
  const { sendChatFrame, subscribeChat } = useActiveRide();
  const badge = useOptionalChat();
  const noteBadgeRead = badge?.noteRead;
  const noteBadgeThread = badge?.noteThread;
  const [status, setStatus] = useState<ChatStatus>("loading");
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [counterpartSeenMessageId, setCounterpartSeen] = useState<
    string | null
  >(null);
  const [sendFailed, setSendFailed] = useState(false);
  const [earlierCursor, setEarlierCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const mounted = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingRef = useRef<PendingMessage[]>([]);
  const threadRef = useRef<ChatThread | null>(null);
  const quickRepliesRef = useRef<QuickReply[]>([]);
  const lastSentReadRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setMessagesSynced = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    if (mounted.current) setMessages(next);
  }, []);

  const setPendingSynced = useCallback((next: PendingMessage[]) => {
    pendingRef.current = next;
    if (mounted.current) setPending(next);
  }, []);

  const adoptThread = useCallback(
    (next: ChatThread) => {
      threadRef.current = next;
      if (!mounted.current) return;
      setThread(next);
      setStatus("ready");
      if (next.counterpartLastReadMessageId) {
        setCounterpartSeen(next.counterpartLastReadMessageId);
      }
      noteBadgeThread?.(next);
    },
    [noteBadgeThread],
  );

  /** Records the read marker: WS frame, REST fallback (idempotent). */
  const markRead = useCallback(
    (messageId: string) => {
      if (!isWritable(threadRef.current)) return;
      if (lastSentReadRef.current === messageId) return;
      lastSentReadRef.current = messageId;
      const frame: ChatClientFrame = {
        type: "chat.read",
        rideId,
        lastReadMessageId: messageId,
      };
      if (!sendChatFrame(frame)) {
        postChatRead(rideId, messageId).catch(() => {
          // Best effort — the next read attempt covers it.
          lastSentReadRef.current = null;
        });
      }
      noteBadgeRead?.(rideId);
    },
    [sendChatFrame, rideId, noteBadgeRead],
  );

  const markLatestCounterpartRead = useCallback(() => {
    const latest = [...messagesRef.current]
      .reverse()
      .find((message) => message.senderRole !== "rider");
    if (latest) markRead(latest.messageId);
  }, [markRead]);

  /** Appends messages that are not already shown (dedup by messageId). */
  const appendMessages = useCallback(
    (incoming: ChatMessage[]) => {
      if (!incoming.length) return;
      const known = new Set(messagesRef.current.map((m) => m.messageId));
      const fresh = incoming.filter((m) => !known.has(m.messageId));
      if (fresh.length) {
        setMessagesSynced([...messagesRef.current, ...fresh]);
      }
    },
    [setMessagesSynced],
  );

  const load = useCallback(
    () =>
      Promise.all([
        getChatThread(rideId),
        getChatMessages(rideId, { size: 50 }),
      ])
        .then(
          ([fetchedThread, page]) => {
            if (!mounted.current) return;
            setMessagesSynced(page.items);
            setEarlierCursor(page.nextCursor);
            adoptThread(fetchedThread);
            // Opening the chat reads everything shown.
            markLatestCounterpartRead();
          },
          (error: unknown) => {
            if (!mounted.current) return;
            if (error instanceof ApiError && error.status === 404) {
              threadRef.current = null;
              setThread(null);
              setStatus("missing");
            } else {
              setStatus("error");
            }
          },
        )
        // The catalog is session-cached and non-fatal: chips just stay hidden.
        .then(() => getQuickReplies())
        .then((catalog) => {
          quickRepliesRef.current = catalog;
          if (mounted.current) setQuickReplies(catalog);
        })
        .catch(() => {}),
    [rideId, adoptThread, markLatestCounterpartRead, setMessagesSynced],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-reads the thread (window changes) without touching the messages. */
  const refreshThread = useCallback(async () => {
    try {
      adoptThread(await getChatThread(rideId));
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.status === 404) {
        threadRef.current = null;
        setThread(null);
        setStatus("missing");
      }
    }
  }, [rideId, adoptThread]);

  /** Reconnect: backfill everything newer than the last shown message. */
  const backfill = useCallback(async () => {
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (!last) return;
    try {
      const page = await getChatMessages(rideId, { after: last.messageId });
      if (!mounted.current) return;
      appendMessages(page.items);
      markLatestCounterpartRead();
    } catch {
      // The next reconnect (or frame) catches up.
    }
  }, [rideId, appendMessages, markLatestCounterpartRead]);

  const toChatMessage = useCallback(
    (event: Extract<ChatServerEvent, { type: "chat.message" }>): ChatMessage => {
      const quickReply =
        event.kind === "quick_reply" && event.quickReplyCode
          ? (quickRepliesRef.current.find(
              (reply) => reply.code === event.quickReplyCode,
            ) ?? {
              code: event.quickReplyCode,
              textEn: event.quickReplyCode,
              textAr: event.quickReplyCode,
            })
          : null;
      return {
        messageId: event.messageId,
        clientMsgId: event.clientMsgId,
        senderRole: event.senderRole,
        kind: event.kind,
        body: event.body,
        quickReply,
        sentAt: event.sentAt,
      };
    },
    [],
  );

  // Live frames + reconnects.
  useEffect(() => {
    return subscribeChat((event) => {
      switch (event.type) {
        case "chat.message": {
          if (event.rideId !== rideId) return;
          if (event.clientMsgId) {
            setPendingSynced(
              pendingRef.current.filter(
                (item) => item.clientMsgId !== event.clientMsgId,
              ),
            );
          }
          appendMessages([toChatMessage(event)]);
          if (event.senderRole !== "rider") markRead(event.messageId);
          break;
        }
        case "chat.read":
          if (event.rideId !== rideId || event.readerRole === "rider") return;
          setCounterpartSeen(event.lastReadMessageId);
          break;
        case "chat.ready": {
          void refreshThread();
          void backfill();
          // Resend the unacked queue — clientMsgId makes this duplicate-free.
          for (const item of pendingRef.current) {
            sendChatFrame({
              type: "chat.send",
              rideId,
              clientMsgId: item.clientMsgId,
              kind: item.kind,
              ...(item.body !== undefined ? { body: item.body } : {}),
              ...(item.quickReplyCode !== undefined
                ? { quickReplyCode: item.quickReplyCode }
                : {}),
            });
          }
          break;
        }
        case "chat.error":
          if (event.code === "chat_closed" || event.code === "chat_not_open") {
            // The window moved under us: drop the queue, re-read the facts.
            setPendingSynced([]);
            void refreshThread();
          } else if (event.code === "invalid_message") {
            // The newest queued message is the refused one.
            setPendingSynced(pendingRef.current.slice(0, -1));
            if (mounted.current) setSendFailed(true);
          }
          break;
      }
    });
  }, [
    subscribeChat,
    sendChatFrame,
    rideId,
    appendMessages,
    markRead,
    refreshThread,
    backfill,
    setPendingSynced,
    toChatMessage,
  ]);

  const enqueue = useCallback(
    (message: Omit<PendingMessage, "clientMsgId" | "sentAtMs">) => {
      if (!isWritable(threadRef.current)) return;
      setSendFailed(false);
      const item: PendingMessage = {
        ...message,
        clientMsgId: newClientMsgId(),
        sentAtMs: Date.now(),
      };
      setPendingSynced([...pendingRef.current, item]);
      // A failed send stays queued; the next ready resends it.
      sendChatFrame({
        type: "chat.send",
        rideId,
        clientMsgId: item.clientMsgId,
        kind: item.kind,
        ...(item.body !== undefined ? { body: item.body } : {}),
        ...(item.quickReplyCode !== undefined
          ? { quickReplyCode: item.quickReplyCode }
          : {}),
      });
    },
    [sendChatFrame, rideId, setPendingSynced],
  );

  const sendText = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      enqueue({ kind: "text", body: trimmed });
    },
    [enqueue],
  );

  const sendQuickReply = useCallback(
    (reply: QuickReply) => {
      enqueue({ kind: "quick_reply", quickReplyCode: reply.code });
    },
    [enqueue],
  );

  const loadEarlier = useCallback(() => {
    if (!earlierCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    getChatMessages(rideId, { before: earlierCursor, size: 50 })
      .then((page) => {
        if (!mounted.current) return;
        const known = new Set(messagesRef.current.map((m) => m.messageId));
        const fresh = page.items.filter((m) => !known.has(m.messageId));
        setMessagesSynced([...fresh, ...messagesRef.current]);
        setEarlierCursor(page.nextCursor);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted.current) setLoadingEarlier(false);
      });
  }, [rideId, earlierCursor, loadingEarlier, setMessagesSynced]);

  return {
    status,
    thread,
    messages,
    pending,
    quickReplies,
    canWrite: isWritable(thread),
    counterpartSeenMessageId,
    sendFailed,
    hasEarlier: earlierCursor !== null,
    loadingEarlier,
    sendText,
    sendQuickReply,
    loadEarlier,
    reload: () => {
      setStatus("loading");
      void load();
    },
  };
}

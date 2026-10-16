/**
 * The driver chat facade (UC-S-13/14, CHAT-01/02, comms-v1.yaml) — the
 * single source of truth for the ride's chat thread that the chat screen
 * and the ride screens' Chat badge render from. Mounted at the root inside
 * the DriverRideProvider; active only for a signed-in driver.
 *
 * Transport, exactly as the contract splits it:
 * - WS (`sendRealtime` on the one realtime socket): `chat.send` with a
 *   client-generated `clientMsgId`, `chat.read` for the read marker.
 * - Server `chat.message` frames append to the thread; the sender's own
 *   echo (matched by `clientMsgId`) is the delivery ack and replaces the
 *   optimistic pending bubble — never a duplicate (V15 dedup).
 * - REST: `GET /rides/{id}/chat` (window state, counterpart, unread),
 *   `GET .../messages` for the first page (`before` pages older history,
 *   `after` is the reconnect backfill), `POST .../read` as the read-marker
 *   fallback when the socket is down.
 * - While the socket is down, sends queue and are resent after the next
 *   `connected` event — the `clientMsgId` dedup makes resending lossless.
 * - WS `error` frames: `chat_closed` flips the window to read_only (and the
 *   thread is re-read); `chat_not_open` / `not_in_ride` drop the thread;
 *   `invalid_message` drops the rejected pending sends.
 *
 * The thread follows the ACTIVE ride, except while the chat screen holds
 * a focus: a chat deep link (push `chat` {rideId}, UC-S-13) focuses that
 * ride's thread via `focusThread` — even while ANOTHER ride is active (an
 * ended ride's 24 h tail) — and opening the chat screen pins the thread it
 * shows, so the ride leaving the active set (the rider cancels) keeps the
 * thread on screen. Leaving the screen releases the focus. Clients never
 * compute the window themselves: `windowState` is read from the server
 * and WS errors are obeyed (CHAT-01).
 *
 * M12 (ruling 2026-10-16): a shared ride has ONE private thread per member
 * with the driver. Those threads are addressed by ride + `memberId`
 * (`focusThread(rideId, memberId)` from the per-member chat list); a shared
 * active ride has no default thread. Internally a thread is keyed
 * `rideId` or `rideId/memberId`: `?memberId=` on the comms-v1 endpoints and
 * `memberId` on the WS frames (scheduled-shared-v1 "Shared rides in the
 * other contracts" → Chat).
 *
 * Resilience: a failed first load is retried with a backoff (and when a
 * live frame for the ride lands), so a flaky moment at acceptance never
 * hides Chat / Call for the ride; the quick-reply catalog is re-fetched
 * after a failure on the next thread load / reconnect (NFR-U2).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { ApiError } from "../api/client";
import {
  getChatMessages,
  getChatThread,
  getQuickReplies,
  newClientMsgId,
  postChatRead,
} from "../api/comms";
import type {
  ChatMessage,
  ChatMessageKind,
  ChatThread,
  QuickReply,
} from "../api/comms-types";
import { useAuth } from "../auth/AuthProvider";
import { useOptionalAvailability } from "../realtime/AvailabilityProvider";
import { parseChatFrame } from "../realtime/chat-frames";
import { useOptionalDriverRide } from "../rides/DriverRideProvider";

/** A rendered message: a stored server row, or an optimistic pending send. */
export interface UiChatMessage {
  /** Server id, or `pending:<clientMsgId>` until the echo lands. */
  messageId: string;
  clientMsgId?: string;
  senderRole: "rider" | "driver";
  kind: ChatMessageKind;
  body?: string | null;
  quickReply?: QuickReply | null;
  quickReplyCode?: string | null;
  sentAt: string;
  /** Sent (or queued) but not yet echoed back. */
  pending?: boolean;
}

export type ChatStatus = "idle" | "loading" | "loaded" | "none" | "error";

export interface ChatContextValue {
  /** The thread being shown (the active ride's, or a focused one). */
  rideId: string | null;
  /** M12: the shared-ride member of the shown thread (null = the ride's one thread). */
  memberId: string | null;
  status: ChatStatus;
  thread: ChatThread | null;
  /** Ascending by time; pending sends at the tail. */
  messages: UiChatMessage[];
  /** Older history available (`nextCursor` of the last page). */
  hasOlder: boolean;
  /** Unread counterpart messages — the ride screens' Chat badge. */
  unread: number;
  quickReplies: QuickReply[];
  sendText: (body: string) => void;
  sendQuickReply: (code: string) => void;
  loadOlder: () => Promise<void>;
  /**
   * Chat screen focus: true marks incoming messages read immediately and
   * pins the shown thread; false releases the focus.
   */
  setScreenOpen: (open: boolean) => void;
  /**
   * Deep link (push `chat` {rideId}) or the per-member list (M12, with
   * `memberId`): show this thread (wins over the active ride).
   */
  focusThread: (rideId: string, memberId?: string | null) => void;
  /** Retry after an error / re-read the thread. */
  refresh: () => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** Backoff for a failed thread load: 2 s, 4 s, 8 s … capped at 30 s. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

interface PendingSend {
  clientMsgId: string;
  kind: ChatMessageKind;
  body?: string;
  quickReplyCode?: string;
  sentAt: string;
}

/** Writes are allowed (and the composer / call shown) in these states. */
export function chatWritable(thread: ChatThread | null): boolean {
  return thread?.windowState === "open" || thread?.windowState === "reopened";
}

/** The internal thread key: `rideId`, or `rideId/memberId` (M12 shared). */
function threadKey(rideId: string, memberId?: string | null): string {
  return memberId ? `${rideId}/${memberId}` : rideId;
}

function rideOf(key: string): string {
  return key.split("/")[0];
}

function memberOf(key: string): string | undefined {
  return key.split("/")[1] || undefined;
}

/** The WS target of a thread: `rideId` (+ `memberId` on a shared ride). */
function wsTarget(key: string): { rideId: string; memberId?: string } {
  const memberId = memberOf(key);
  return memberId ? { rideId: rideOf(key), memberId } : { rideId: rideOf(key) };
}

function toUiMessage(message: ChatMessage): UiChatMessage {
  return {
    messageId: message.messageId,
    clientMsgId: message.clientMsgId,
    senderRole: message.senderRole,
    kind: message.kind,
    body: message.body ?? null,
    quickReply: message.quickReply ?? null,
    quickReplyCode: message.quickReply?.code ?? null,
    sentAt: message.sentAt,
  };
}

/** Appends server rows, skipping ids already present (lossless backfill). */
function mergeServer(
  current: UiChatMessage[],
  incoming: ChatMessage[],
): UiChatMessage[] {
  const known = new Set(current.map((m) => m.messageId));
  const fresh = incoming.filter((m) => !known.has(m.messageId));
  if (fresh.length === 0) return current;
  return [...current, ...fresh.map(toUiMessage)];
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, isDriver } = useAuth();
  const active = authStatus === "signedIn" && isDriver;
  const availability = useOptionalAvailability();
  const subscribeRealtime = availability?.subscribeRealtime;
  const sendRealtime = availability?.sendRealtime;
  const ride = useOptionalDriverRide()?.ride ?? null;
  // M12: a shared ride has no ride-level thread — only per-member ones.
  const activeRideId = ride && ride.kind !== "shared" ? ride.id : null;

  const [focusedRideId, setFocusedRideId] = useState<string | null>(null);
  // A focus (deep link / the open chat screen) wins over the active ride.
  // `rideId` below is the internal thread KEY (`rideId[/memberId]`).
  const rideId = focusedRideId ?? activeRideId;

  const [status, setStatus] = useState<ChatStatus>("idle");
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [serverMessages, setServerMessages] = useState<UiChatMessage[]>([]);
  const [pendingSends, setPendingSends] = useState<PendingSend[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  /** Failed-load retries so far (drives the backoff). */
  const [retryCount, setRetryCount] = useState(0);

  const mounted = useRef(true);
  const rideIdRef = useRef<string | null>(null);
  rideIdRef.current = rideId;
  const threadRef = useRef<ChatThread | null>(null);
  threadRef.current = thread;
  const statusRef = useRef<ChatStatus>(status);
  statusRef.current = status;
  const serverMessagesRef = useRef<UiChatMessage[]>([]);
  serverMessagesRef.current = serverMessages;
  const pendingRef = useRef<PendingSend[]>([]);
  pendingRef.current = pendingSends;
  const screenOpenRef = useRef(false);
  /** The newest read marker we told the server about. */
  const sentReadRef = useRef<string | null>(null);
  const sendRealtimeRef = useRef(sendRealtime);
  sendRealtimeRef.current = sendRealtime;
  const activeRef = useRef(active);
  activeRef.current = active;
  /** The catalog for this session: fetched once it succeeds, retried until. */
  const catalogRef = useRef<{ session: number; state: "idle" | "loading" | "loaded" }>(
    { session: 0, state: "idle" },
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const live = useCallback(
    (forRideId: string | null) =>
      mounted.current && rideIdRef.current === forRideId,
    [],
  );

  // ----------------------------------------------------------- quick replies

  /** Fetches the catalog unless this session already has it (or is fetching). */
  const fetchQuickReplies = useCallback(() => {
    const catalog = catalogRef.current;
    if (!activeRef.current || catalog.state !== "idle") return;
    const session = catalog.session;
    catalog.state = "loading";
    getQuickReplies()
      .then((items) => {
        if (catalogRef.current.session !== session) return;
        catalogRef.current.state = "loaded";
        if (mounted.current) setQuickReplies(items);
      })
      .catch(() => {
        // The composer still works; the next thread load / reconnect retries.
        if (catalogRef.current.session === session)
          catalogRef.current.state = "idle";
      });
  }, []);

  // ------------------------------------------------------------- read marker

  /** Tells the server everything up to `messageId` is read (WS, REST fallback). */
  const markReadTo = useCallback((forRideId: string, messageId: string) => {
    setUnread(0);
    if (sentReadRef.current === messageId) return;
    sentReadRef.current = messageId;
    const sent = sendRealtimeRef.current?.({
      type: "chat.read",
      ...wsTarget(forRideId),
      lastReadMessageId: messageId,
    });
    if (!sent) {
      postChatRead(rideOf(forRideId), messageId, memberOf(forRideId)).catch(() => {
        // Idempotent marker — the next read attempt repeats it.
      });
    }
  }, []);

  // ------------------------------------------------------------- loading

  /** Full (re)load: thread + first history page. */
  const loadThread = useCallback(
    async (forRideId: string, quiet: boolean) => {
      if (!quiet) setStatus("loading");
      try {
        const [threadResult, page] = await Promise.all([
          getChatThread(rideOf(forRideId), memberOf(forRideId)),
          getChatMessages(rideOf(forRideId), { memberId: memberOf(forRideId) }),
        ]);
        if (!live(forRideId)) return;
        setThread(threadResult);
        setUnread(threadResult.unreadCount);
        sentReadRef.current = threadResult.lastReadMessageId ?? null;
        setServerMessages(page.items.map(toUiMessage));
        setOlderCursor(page.nextCursor);
        setStatus("loaded");
        fetchQuickReplies();
        // The chat screen was already open while loading: read on arrival
        // (read_only threads record no marker — nothing new can arrive).
        const newest = page.items[page.items.length - 1];
        if (screenOpenRef.current && newest && chatWritable(threadResult)) {
          markReadTo(forRideId, newest.messageId);
        }
      } catch (error) {
        if (!live(forRideId)) return;
        if (error instanceof ApiError && error.status === 404) {
          // Window state `none` — no thread, no entry point (CHAT-01).
          setThread(null);
          setServerMessages([]);
          setUnread(0);
          setStatus("none");
          return;
        }
        if (!quiet || threadRef.current === null) setStatus("error");
      }
    },
    [live, markReadTo, fetchQuickReplies],
  );

  /** Reconnect / foreground: re-read the thread and backfill newer rows. */
  const resync = useCallback(
    async (forRideId: string) => {
      const newest =
        serverMessagesRef.current[serverMessagesRef.current.length - 1];
      if (!newest) {
        await loadThread(forRideId, threadRef.current !== null);
        return;
      }
      try {
        const [threadResult, page] = await Promise.all([
          getChatThread(rideOf(forRideId), memberOf(forRideId)),
          getChatMessages(rideOf(forRideId), {
            after: newest.messageId,
            memberId: memberOf(forRideId),
          }),
        ]);
        if (!live(forRideId)) return;
        setThread(threadResult);
        setUnread(threadResult.unreadCount);
        setServerMessages((current) => mergeServer(current, page.items));
        setStatus("loaded");
        fetchQuickReplies();
      } catch (error) {
        if (!live(forRideId)) return;
        if (error instanceof ApiError && error.status === 404) {
          setThread(null);
          setServerMessages([]);
          setUnread(0);
          setStatus("none");
        }
        // Transient trouble: keep what we have — the next resync catches up.
      }
    },
    [live, loadThread, fetchQuickReplies],
  );

  const refresh = useCallback(async () => {
    const forRideId = rideIdRef.current;
    if (forRideId) await loadThread(forRideId, false);
  }, [loadThread]);

  const loadOlder = useCallback(async () => {
    const forRideId = rideIdRef.current;
    if (!forRideId || !olderCursor) return;
    try {
      const page = await getChatMessages(rideOf(forRideId), {
        before: olderCursor,
        memberId: memberOf(forRideId),
      });
      if (!live(forRideId)) return;
      setServerMessages((current) => {
        const known = new Set(current.map((m) => m.messageId));
        const older = page.items
          .filter((m) => !known.has(m.messageId))
          .map(toUiMessage);
        return [...older, ...current];
      });
      setOlderCursor(page.nextCursor);
    } catch {
      // Scroll-back is a courtesy; the next attempt retries.
    }
  }, [live, olderCursor]);

  // Thread follows the ride (reset + load on every ride change).
  useEffect(() => {
    setThread(null);
    setServerMessages([]);
    setPendingSends([]);
    setOlderCursor(null);
    setUnread(0);
    setRetryCount(0);
    sentReadRef.current = null;
    if (!active || !rideId) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    void loadThread(rideId, false);
  }, [active, rideId, loadThread]);

  // A failed load retries with a backoff (D-W4): one flaky request at ride
  // start must not hide Chat / Call for the rest of the ride.
  useEffect(() => {
    if (status !== "error") {
      setRetryCount(0);
      return undefined;
    }
    if (!active || !rideId) return undefined;
    const delay = Math.min(
      RETRY_MAX_MS,
      RETRY_BASE_MS * 2 ** Math.min(retryCount, 8),
    );
    const timer = setTimeout(() => {
      void loadThread(rideId, true).finally(() => {
        if (mounted.current) setRetryCount((count) => count + 1);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [active, rideId, status, retryCount, loadThread]);

  // Signed out: drop a stale focus.
  useEffect(() => {
    if (!active) setFocusedRideId(null);
  }, [active]);

  // Quick replies: one cacheable catalog per session (CHAT-02, NFR-U2) —
  // fetched on sign-in and retried on later loads until it succeeds.
  useEffect(() => {
    catalogRef.current = {
      session: catalogRef.current.session + 1,
      state: "idle",
    };
    setQuickReplies([]);
    if (active) fetchQuickReplies();
  }, [active, fetchQuickReplies]);

  /** Marks everything currently loaded as read — the chat screen is open. */
  const markRead = useCallback(() => {
    const forRideId = rideIdRef.current;
    const rows = serverMessagesRef.current;
    const newest = rows[rows.length - 1];
    if (forRideId && newest && chatWritable(threadRef.current)) {
      markReadTo(forRideId, newest.messageId);
    }
  }, [markReadTo]);

  const setScreenOpen = useCallback(
    (open: boolean) => {
      screenOpenRef.current = open;
      if (open) {
        // Pin the thread on screen (unless a deep link already focused
        // one): the ride leaving the active set keeps it here (D-W2).
        const shown = rideIdRef.current;
        setFocusedRideId((current) => current ?? shown);
        markRead();
      } else {
        // Leaving the chat: the ride screens follow the active ride again.
        setFocusedRideId(null);
      }
    },
    [markRead],
  );

  // ---------------------------------------------------------------- sending

  const dispatchSend = useCallback((send: PendingSend) => {
    const forRideId = rideIdRef.current;
    if (!forRideId) return;
    sendRealtimeRef.current?.({
      type: "chat.send",
      ...wsTarget(forRideId),
      clientMsgId: send.clientMsgId,
      kind: send.kind,
      ...(send.body !== undefined ? { body: send.body } : {}),
      ...(send.quickReplyCode !== undefined
        ? { quickReplyCode: send.quickReplyCode }
        : {}),
    });
    // false (socket down) needs nothing extra: the send stays pending and
    // the next `connected` event resends it (dedup by clientMsgId).
  }, []);

  const enqueueSend = useCallback(
    (send: Omit<PendingSend, "clientMsgId" | "sentAt">) => {
      if (!rideIdRef.current || !chatWritable(threadRef.current)) return;
      const pending: PendingSend = {
        ...send,
        clientMsgId: newClientMsgId(),
        sentAt: new Date().toISOString(),
      };
      setPendingSends((current) => [...current, pending]);
      dispatchSend(pending);
    },
    [dispatchSend],
  );

  const sendText = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      enqueueSend({ kind: "text", body: trimmed });
    },
    [enqueueSend],
  );

  /** NFR-U2: one tap sends immediately — no confirm step. */
  const sendQuickReply = useCallback(
    (code: string) => {
      enqueueSend({ kind: "quick_reply", quickReplyCode: code });
    },
    [enqueueSend],
  );

  // ----------------------------------------------------------------- frames

  useEffect(() => {
    if (!active || !subscribeRealtime) return undefined;
    return subscribeRealtime((event) => {
      if (!mounted.current) return;
      const forRideId = rideIdRef.current;
      if (event.kind === "connected") {
        // Events are not replayed: backfill, then resend what never left.
        fetchQuickReplies();
        if (forRideId) {
          void resync(forRideId).then(() => {
            if (!live(forRideId)) return;
            for (const send of pendingRef.current) dispatchSend(send);
          });
        }
        return;
      }
      const frame = parseChatFrame(event.frame);
      if (!frame) return;
      switch (frame.type) {
        case "chat.message": {
          if (threadKey(frame.rideId, frame.memberId) !== forRideId) return;
          // A frame for a thread we failed to load (or had none yet): the
          // thread exists now — load it so Chat / Call appear (D-W4).
          if (
            forRideId &&
            threadRef.current === null &&
            (statusRef.current === "error" || statusRef.current === "none")
          ) {
            void loadThread(forRideId, true);
          }
          if (frame.clientMsgId) {
            // Our own echo — the delivery ack replaces the pending bubble.
            setPendingSends((current) =>
              current.filter((p) => p.clientMsgId !== frame.clientMsgId),
            );
          }
          setServerMessages((current) => {
            if (current.some((m) => m.messageId === frame.messageId))
              return current;
            return [
              ...current,
              {
                messageId: frame.messageId,
                clientMsgId: frame.clientMsgId,
                senderRole: frame.senderRole,
                kind: frame.kind,
                body: frame.body ?? null,
                quickReply: frame.quickReply ?? null,
                quickReplyCode: frame.quickReplyCode ?? null,
                sentAt: frame.sentAt,
              },
            ];
          });
          if (frame.senderRole === "rider") {
            if (
              screenOpenRef.current &&
              forRideId &&
              chatWritable(threadRef.current)
            ) {
              // On screen: read as it lands (the marker follows at once).
              markReadTo(forRideId, frame.messageId);
            } else {
              setUnread((count) => count + 1);
            }
          }
          return;
        }
        case "chat.read":
          if (
            threadKey(frame.rideId, frame.memberId) !== forRideId ||
            frame.readerRole !== "rider"
          )
            return;
          setThread((current) =>
            current
              ? {
                  ...current,
                  counterpartLastReadMessageId: frame.lastReadMessageId,
                }
              : current,
          );
          return;
        case "chat.error":
          switch (frame.code) {
            case "chat_closed":
              // The window just turned read_only: obey, then re-read.
              setPendingSends([]);
              setThread((current) =>
                current
                  ? {
                      ...current,
                      windowState: "read_only",
                      counterpart: { ...current.counterpart, phone: null },
                    }
                  : current,
              );
              if (forRideId) void resync(forRideId);
              return;
            case "chat_not_open":
            case "not_in_ride":
              setPendingSends([]);
              if (forRideId) void loadThread(forRideId, true);
              return;
            case "invalid_message":
              // The server rejected a send; drop what never stored.
              setPendingSends([]);
              return;
          }
      }
    });
  }, [
    active,
    subscribeRealtime,
    dispatchSend,
    fetchQuickReplies,
    live,
    loadThread,
    markReadTo,
    resync,
  ]);

  // Foreground re-entry: frames may have been missed in the background.
  useEffect(() => {
    if (!active || !rideId) return undefined;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") void resync(rideId);
      previous = next;
    });
    return () => subscription.remove();
  }, [active, rideId, resync]);

  // ------------------------------------------------------------------ value

  const messages = useMemo<UiChatMessage[]>(
    () => [
      ...serverMessages,
      ...pendingSends.map((send) => ({
        messageId: `pending:${send.clientMsgId}`,
        clientMsgId: send.clientMsgId,
        senderRole: "driver" as const,
        kind: send.kind,
        body: send.body ?? null,
        quickReplyCode: send.quickReplyCode ?? null,
        sentAt: send.sentAt,
        pending: true,
      })),
    ],
    [serverMessages, pendingSends],
  );

  const focusThread = useCallback(
    (nextRideId: string, memberId?: string | null) => {
      setFocusedRideId(threadKey(nextRideId, memberId));
    },
    [],
  );

  const shownRideId = rideId ? rideOf(rideId) : null;
  const shownMemberId = rideId ? (memberOf(rideId) ?? null) : null;

  const value = useMemo<ChatContextValue>(
    () => ({
      rideId: shownRideId,
      memberId: shownMemberId,
      status,
      thread,
      messages,
      hasOlder: olderCursor !== null,
      unread,
      quickReplies,
      sendText,
      sendQuickReply,
      loadOlder,
      setScreenOpen,
      focusThread,
      refresh,
    }),
    [
      shownRideId,
      shownMemberId,
      status,
      thread,
      messages,
      olderCursor,
      unread,
      quickReplies,
      sendText,
      sendQuickReply,
      loadOlder,
      setScreenOpen,
      focusThread,
      refresh,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/** Null without the provider (provider-less unit tests of screens). */
export function useOptionalChat(): ChatContextValue | null {
  return useContext(ChatContext);
}

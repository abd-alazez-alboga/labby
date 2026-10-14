/**
 * The active ride's chat thread facts for the on-ride screens (M10,
 * UC-S-13/14): whether a thread exists (404 ⇒ no chat entry point), the
 * counterpart's phone (CALL-01 — non-null only while the window allows
 * writes) and the live unread count for the Chat badge.
 *
 * Mounted inside RideProvider. The thread is fetched once the ride on
 * screen is accepted (the backend creates it lazily at acceptance),
 * re-fetched on every socket ready (reconnect) and the unread count follows
 * incoming `chat.message` frames. The chat screen reports reads
 * (`noteRead`) and fresher thread facts (`noteThread`) so the badge and the
 * call gating never lag behind.
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

import { type ChatThread, getChatThread } from "../api/comms";
import { ApiError } from "../api/http-client";
import { useActiveRide } from "../ride/ride-context";

/** Ride states whose screens carry the safety actions (chat/call/share/SOS). */
export const SAFETY_ACTION_STATES = [
  "accepted",
  "driver_arrived",
  "in_progress",
] as const;

export interface ChatBadgeValue {
  /** The active ride's thread; null = none (404) or not fetched yet. */
  thread: ChatThread | null;
  /** Live unread count for the badge. */
  unreadCount: number;
  /** The chat screen read up to date for this ride: clear the badge. */
  noteRead: (rideId: string) => void;
  /** The chat screen holds fresher thread facts: adopt them. */
  noteThread: (thread: ChatThread) => void;
}

const ChatContext = createContext<ChatBadgeValue | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const facade = useActiveRide();
  const { subscribeChat } = facade;
  // Keyed by ride: facts fetched for another ride are never shown.
  const [entry, setEntry] = useState<{
    rideId: string;
    thread: ChatThread | null;
    unreadCount: number;
  } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const ride = facade.ride;
  const activeRideId =
    ride && (SAFETY_ACTION_STATES as readonly string[]).includes(ride.state)
      ? ride.id
      : null;
  const current = entry?.rideId === activeRideId ? entry : null;
  const thread = current?.thread ?? null;
  const unreadCount = current?.unreadCount ?? 0;

  const activeRideIdRef = useRef<string | null>(null);
  const hasThreadRef = useRef(false);
  useEffect(() => {
    activeRideIdRef.current = activeRideId;
    hasThreadRef.current = thread !== null;
  }, [activeRideId, thread]);

  const fetchThread = useCallback(
    (rideId: string) =>
      getChatThread(rideId).then(
        (fetched) => {
          if (!mounted.current || activeRideIdRef.current !== rideId) return;
          setEntry({
            rideId,
            thread: fetched,
            unreadCount: fetched.unreadCount,
          });
        },
        (error: unknown) => {
          if (!mounted.current || activeRideIdRef.current !== rideId) return;
          if (error instanceof ApiError && error.status === 404) {
            // No thread yet — no chat entry point (UC-S-13 window `none`).
            setEntry({ rideId, thread: null, unreadCount: 0 });
          }
          // Other failures keep what is shown; the next ready re-fetches.
        },
      ),
    [],
  );

  // Fetch when a ride becomes active (or the active ride changes).
  useEffect(() => {
    activeRideIdRef.current = activeRideId;
    if (activeRideId) void fetchThread(activeRideId);
  }, [activeRideId, fetchThread]);

  // Live updates: unread from chat.message frames, re-fetch on reconnect.
  useEffect(() => {
    return subscribeChat((event) => {
      const rideId = activeRideIdRef.current;
      if (!rideId) return;
      switch (event.type) {
        case "chat.ready":
          void fetchThread(rideId);
          break;
        case "chat.message":
          if (event.rideId !== rideId) return;
          if (event.senderRole !== "rider") {
            setEntry((prev) =>
              prev?.rideId === rideId
                ? { ...prev, unreadCount: prev.unreadCount + 1 }
                : prev,
            );
          }
          // A message for a ride we saw no thread for yet: it exists now.
          if (!hasThreadRef.current) void fetchThread(rideId);
          break;
        case "chat.read":
        case "chat.error":
          break;
      }
    });
  }, [subscribeChat, fetchThread]);

  const noteRead = useCallback((rideId: string) => {
    setEntry((prev) =>
      prev?.rideId === rideId ? { ...prev, unreadCount: 0 } : prev,
    );
  }, []);

  const noteThread = useCallback((next: ChatThread) => {
    setEntry((prev) =>
      prev?.rideId === next.rideId ? { ...prev, thread: next } : prev,
    );
  }, []);

  const value = useMemo<ChatBadgeValue>(
    () => ({ thread, unreadCount, noteRead, noteThread }),
    [thread, unreadCount, noteRead, noteThread],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/** The chat badge state, or null outside the provider (provider-less tests). */
export function useOptionalChat(): ChatBadgeValue | null {
  return useContext(ChatContext) ?? null;
}

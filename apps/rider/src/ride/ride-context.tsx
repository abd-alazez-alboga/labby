/**
 * The rider's ride facade (M7-T3): the SINGLE source of the current ride the
 * screens render from (rides-v1.yaml state machine — requested, offering,
 * accepted, driver_arrived, in_progress, completed, cancelled_by_rider,
 * cancelled_by_driver, no_driver_found).
 *
 * Mounted inside the signed-in (app) layout, it owns:
 * - the realtime socket (realtime/rider-socket.ts) — `ride.state`,
 *   `ride.updated`, `ride.driver_position` and `ride.connection` frames for
 *   the rider update the state; frames for the driver app are filtered out
 *   in the protocol layer;
 * - resync from `GET /rides/active` on mount and on EVERY socket (re)connect
 *   (events are not replayed). When the active ride is gone (204) while a
 *   live ride is shown, `GET /rides/{id}` tells how it ended;
 * - the actions screens call: book, retry, cancel, change route, track
 *   (push deep link `ride`), dismiss (Done after an ended ride);
 * - the driver-cancel re-dispatch (owner decision 2026-10-07): a
 *   `cancelled_by_driver` ride that was re-dispatched is replaced by its new
 *   ride (`redispatchedAsRideId`, or the active ride whose
 *   `redispatchOfRideId` points at it) without any rider action. A
 *   `rider_no_show` cancellation is not re-dispatched and stays shown with
 *   its recorded fee.
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

import { refreshAccessToken } from "../api/http-client";
import {
  bookRide,
  type BookRideRequest,
  cancelRide,
  changeRideRoute,
  getActiveRide,
  getRide,
  isLiveRide,
  type Place,
  type Ride,
  type RiderCancelReason,
  retryRide,
} from "../api/rides";
import {
  addTokensChangedListener,
  getStoredTokens,
} from "../auth/session-store";
import { getAppConfig } from "../config/app-config";
import type { LatLng } from "../map/geo";
import {
  type ChatClientFrame,
  type ChatServerEvent,
  realtimeUrl,
  type RideEvent,
} from "../realtime/protocol";
import {
  RiderSocket,
  type SocketFactory,
  type SocketLike,
  type SocketStatus,
} from "../realtime/rider-socket";

/**
 * What chat consumers (M10) see of the socket: the server chat frames, the
 * non-closing error frames (window refusals) and every (re)connect `ready`
 * — the moment to backfill history and resend pending messages.
 */
export type ChatFeedEvent =
  | ChatServerEvent
  | { type: "chat.error"; code: string }
  | { type: "chat.ready" };

export interface ActiveRideValue {
  /** The ride on screen: live, or just ended (until dismissed). */
  ride: Ride | null;
  /** True until the first resync answered (or failed). */
  loading: boolean;
  /** Latest relayed driver position (accepted..in_progress). */
  driverPosition: LatLng | null;
  /** Seconds to pickup before start, to destination after (TRK-02). */
  etaSeconds: number | null;
  /** TRK-04: `lost` while the driver's stream is stale. */
  driverStream: "ok" | "lost" | null;
  socketStatus: SocketStatus;
  book: (request: BookRideRequest) => Promise<Ride>;
  /**
   * A new ride for the `no_driver_found` one, expecting
   * `expectedSurgeMultiplier` (default: the shown ride's locked multiplier).
   */
  retry: (expectedSurgeMultiplier?: number) => Promise<Ride>;
  cancel: (reason: RiderCancelReason, note?: string) => Promise<Ride>;
  changeRoute: (route: { destination: Place; stops: Place[] }) => Promise<Ride>;
  /** Opens a ride by id (push tap) — becomes the ride on screen. */
  track: (rideId: string) => Promise<void>;
  /** Forgets an ended ride (Done / close). */
  dismiss: () => void;
  resync: () => Promise<void>;
  /** Sends a chat frame on the live socket; false ⇒ resend after `chat.ready`. */
  sendChatFrame: (frame: ChatClientFrame) => boolean;
  /** Chat frames + socket readiness for the chat slice (M10). */
  subscribeChat: (listener: (event: ChatFeedEvent) => void) => () => void;
}

const RideContext = createContext<ActiveRideValue | undefined>(undefined);

function defaultSocketFactory(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike;
}

async function storedAccessToken(): Promise<string | null> {
  return (await getStoredTokens())?.accessToken ?? null;
}

/** Driver-cancelled and re-dispatched (everything but a rider no-show). */
function wasRedispatched(ride: Ride): boolean {
  return (
    ride.state === "cancelled_by_driver" &&
    ride.cancellationReason !== "rider_no_show"
  );
}

export function RideProvider({
  children,
  socketFactory = defaultSocketFactory,
}: {
  children: React.ReactNode;
  /** Tests inject a fake socket. */
  socketFactory?: SocketFactory;
}) {
  const [ride, setRideState] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [driverPosition, setDriverPosition] = useState<LatLng | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [driverStream, setDriverStream] = useState<"ok" | "lost" | null>(
    null,
  );
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("idle");
  const current = useRef<Ride | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Replaces the ride on screen and its live extras. */
  const show = useCallback((next: Ride | null) => {
    if (!mounted.current) return;
    const previous = current.current;
    current.current = next;
    setRideState(next);
    if (!next) {
      setDriverPosition(null);
      setEtaSeconds(null);
      setDriverStream(null);
      return;
    }
    const sameRide = previous?.id === next.id;
    // A ride view without a position/ETA keeps the last relayed one.
    if (next.driverPosition || !sameRide) {
      setDriverPosition(next.driverPosition ?? null);
    }
    if (next.etaSeconds != null || !sameRide) {
      setEtaSeconds(next.etaSeconds ?? null);
    }
    setDriverStream(next.driverStream ?? null);
  }, []);

  const followRedispatch = useRef<(cancelled: Ride) => void>(() => {});

  /**
   * Decides whether an incoming ride replaces the one on screen: the same
   * ride, its re-dispatch, or any ride while nothing live is shown. A frame
   * about some other (older) ride while a live one is tracked is ignored.
   */
  const apply = useCallback(
    (incoming: Ride, force = false) => {
      const shown = current.current;
      const accept =
        force ||
        !shown ||
        incoming.id === shown.id ||
        incoming.redispatchOfRideId === shown.id ||
        incoming.retryOfRideId === shown.id ||
        (!isLiveRide(shown.state) && isLiveRide(incoming.state));
      if (!accept) return;
      show(incoming);
      if (wasRedispatched(incoming)) followRedispatch.current(incoming);
    },
    [show],
  );

  const resync = useCallback(async () => {
    try {
      const active = await getActiveRide();
      if (active) {
        apply(active, true);
        return;
      }
      const shown = current.current;
      if (shown && isLiveRide(shown.state)) {
        // It ended while we were not listening: learn how.
        apply(await getRide(shown.id), true);
      }
    } catch {
      // Offline / server trouble: keep what is shown; the next (re)connect
      // resyncs again.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    followRedispatch.current = (cancelled: Ride) => {
      if (cancelled.redispatchedAsRideId) {
        getRide(cancelled.redispatchedAsRideId)
          .then((next) => apply(next))
          .catch(() => void resync());
      } else {
        // The new ride is announced in its own frame; the active ride is
        // the fallback when that frame is missed.
        void resync();
      }
    };
  }, [apply, resync]);

  const onEvent = useCallback(
    (event: RideEvent) => {
      switch (event.type) {
        case "ride.state":
        case "ride.updated":
          apply(event.ride);
          break;
        case "ride.driver_position":
          if (event.rideId !== current.current?.id) return;
          setDriverPosition({ lat: event.lat, lng: event.lng });
          if (event.etaSeconds !== null) setEtaSeconds(event.etaSeconds);
          break;
        case "ride.connection":
          if (event.rideId !== current.current?.id) return;
          setDriverStream(event.driverStream);
          break;
      }
    },
    [apply],
  );

  // M10 chat: the socket's chat feed, relayed to the chat slice.
  const chatListeners = useRef(new Set<(event: ChatFeedEvent) => void>());
  const socketRef = useRef<RiderSocket | null>(null);

  const emitChat = useCallback((event: ChatFeedEvent) => {
    for (const listener of chatListeners.current) listener(event);
  }, []);

  const subscribeChat = useCallback(
    (listener: (event: ChatFeedEvent) => void) => {
      chatListeners.current.add(listener);
      return () => {
        chatListeners.current.delete(listener);
      };
    },
    [],
  );

  const sendChatFrame = useCallback((frame: ChatClientFrame): boolean => {
    return socketRef.current?.sendChatFrame(frame) ?? false;
  }, []);

  // Socket + first resync for the signed-in lifetime of the provider.
  useEffect(() => {
    const socket = new RiderSocket({
      url: realtimeUrl(getAppConfig().apiBaseUrl),
      createSocket: socketFactory,
      getAccessToken: storedAccessToken,
      subscribeTokens: addTokensChangedListener,
      refreshSession: refreshAccessToken,
      onReady: () => {
        void resync();
        emitChat({ type: "chat.ready" });
      },
      onEvent,
      onChatEvent: emitChat,
      onError: (code) => emitChat({ type: "chat.error", code }),
      onStatus: (status) => {
        if (mounted.current) setSocketStatus(status);
      },
    });
    socketRef.current = socket;
    void resync();
    socket.start();
    return () => {
      socketRef.current = null;
      socket.stop();
    };
  }, [socketFactory, resync, onEvent, emitChat]);

  const book = useCallback<ActiveRideValue["book"]>(
    async (request) => {
      const booked = await bookRide(request);
      apply(booked, true);
      return booked;
    },
    [apply],
  );

  const retry = useCallback<ActiveRideValue["retry"]>(
    async (expectedSurgeMultiplier) => {
      const shown = current.current;
      if (!shown) throw new Error("No ride to retry");
      const next = await retryRide(
        shown.id,
        expectedSurgeMultiplier ?? shown.surgeMultiplier,
      );
      apply(next, true);
      return next;
    },
    [apply],
  );

  const cancel = useCallback<ActiveRideValue["cancel"]>(
    async (reason, note) => {
      const shown = current.current;
      if (!shown) throw new Error("No ride to cancel");
      const cancelled = await cancelRide(shown.id, reason, note);
      apply(cancelled, true);
      return cancelled;
    },
    [apply],
  );

  const changeRoute = useCallback<ActiveRideValue["changeRoute"]>(
    async (route) => {
      const shown = current.current;
      if (!shown) throw new Error("No ride to change");
      const changed = await changeRideRoute(shown.id, route);
      apply(changed);
      return changed;
    },
    [apply],
  );

  const track = useCallback(
    async (rideId: string) => {
      if (current.current?.id === rideId) return;
      try {
        apply(await getRide(rideId), true);
      } catch {
        await resync();
      }
    },
    [apply, resync],
  );

  const dismiss = useCallback(() => {
    const shown = current.current;
    if (shown && !isLiveRide(shown.state)) show(null);
  }, [show]);

  const value = useMemo<ActiveRideValue>(
    () => ({
      ride,
      loading,
      driverPosition,
      etaSeconds,
      driverStream,
      socketStatus,
      book,
      retry,
      cancel,
      changeRoute,
      track,
      dismiss,
      resync,
      sendChatFrame,
      subscribeChat,
    }),
    [
      ride,
      loading,
      driverPosition,
      etaSeconds,
      driverStream,
      socketStatus,
      book,
      retry,
      cancel,
      changeRoute,
      track,
      dismiss,
      resync,
      sendChatFrame,
      subscribeChat,
    ],
  );

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

/** The ride facade; throws outside the signed-in layout. */
export function useActiveRide(): ActiveRideValue {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error("useActiveRide must be used within a RideProvider");
  return ctx;
}

/** The ride facade, or null outside the provider (provider-less tests). */
export function useOptionalActiveRide(): ActiveRideValue | null {
  return useContext(RideContext) ?? null;
}

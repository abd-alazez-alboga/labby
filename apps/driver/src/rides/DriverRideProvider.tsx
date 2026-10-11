/**
 * The driver ride facade (UC-D-06..10) — the single source of truth for the
 * open OFFER and the ACTIVE RIDE that the home / ride screens render from.
 * Mounted at the root inside the AvailabilityProvider; active only for a
 * signed-in driver with an ACTIVE role.
 *
 * Inputs, all funnelled through one reducer-like set of state updates:
 * - Realtime frames from the availability socket (`subscribeRealtime`):
 *   `offer.new`, `offer.withdrawn`, `ride.state`, `ride.updated`,
 *   `ride.connection` — only frames with `as: "driver"` (ride-frames.ts).
 * - Resync (`GET /driver/offers/open` + `GET /driver/rides/active`) on
 *   activation, on every socket (re)connect, on foreground re-entry, on a
 *   push / notification tap and after a 409 on going offline (rides-v1:
 *   events are not replayed). A frame that lands while a resync is in
 *   flight wins over the resync's (older) answer.
 * - The driver's own actions (accept, decline, arrive, start, complete,
 *   cash-confirm, mark-unpaid, cancel) — each answered with the ride, which
 *   replaces the local copy (the server's state is never guessed).
 *
 * The offer is dismissed with a short notice on expiry (`expiresAt`), on
 * `offer.withdrawn` (timeout / the rider cancelled — UC-D-06 E1) and on an
 * accept answered 409 `offer_closed`.
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
import type { DeepLink } from "../api/realtime-types";
import { isActiveForDriver } from "../api/ride-types";
import type {
  DriverCancelReason,
  Ride,
  RideFrame,
  RideOffer,
} from "../api/ride-types";
import {
  acceptOffer,
  arriveAtPickup,
  cancelDriverRide,
  completeRide,
  confirmCash,
  declineOffer,
  getActiveRide,
  getDriverRide,
  getOpenOffer,
  markUnpaid,
  rideErrorOf,
  startRide,
} from "../api/rides";
import { useAuth } from "../auth/AuthProvider";
import { useOptionalAvailability } from "../realtime/AvailabilityProvider";
import { parseDriverRideFrame } from "../realtime/ride-frames";

/** Short notices shown on the home screen after the offer / ride went away. */
export type RideNotice =
  /** The 15 s window ran out (locally or `offer.withdrawn` timeout). */
  | "offerExpired"
  /** `offer.withdrawn` ride_ended — the rider cancelled (UC-D-06 E1). */
  | "offerCancelled"
  /** Accept answered 409 `offer_closed`. */
  | "offerClosed"
  /** A `ride_offer` push was tapped but the offer is gone. */
  | "offerGone"
  /** The rider cancelled the accepted ride. */
  | "riderCancelled"
  /** The driver's own cancellation went through. */
  | "rideCancelled"
  | "cashConfirmed"
  | "markedUnpaid"
  /** cash-confirm / mark-unpaid answered 409 `payment_not_pending`. */
  | "paymentSettled";

export type RideAction =
  | "accept"
  | "decline"
  | "arrive"
  | "start"
  | "complete"
  | "cashConfirm"
  | "markUnpaid"
  | "cancel";

export type RideActionError =
  /** UC-D-07 E1 — 422 with the distance hint. */
  | {
      action: RideAction;
      kind: "outsideGeofence";
      distanceMeters: number | null;
      geofenceMeters: number;
    }
  /** 422 no fresh server-side position. */
  | { action: RideAction; kind: "noPosition"; geofenceMeters: number | null }
  /** 422 rider_no_show before the wait grace. */
  | { action: RideAction; kind: "noShowTooEarly"; availableAt: string | null }
  | { action: RideAction; kind: "network" | "server" };

export interface OfferWithDeadline {
  offer: RideOffer;
  /** Device-clock epoch ms when the offer closes (see `offerDeadline`). */
  deadline: number;
  /** Device-clock epoch ms of the countdown's full window. */
  windowMs: number;
}

export interface DriverRideContextValue {
  /** The open offer, or null. */
  offer: OfferWithDeadline | null;
  /** The current job (accepted..in_progress, or completed with payment pending). */
  ride: Ride | null;
  /** `ride.updated` route_changed arrived for the current ride. */
  routeChanged: boolean;
  notice: RideNotice | null;
  pending: RideAction | null;
  error: RideActionError | null;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  arrive: () => Promise<void>;
  start: () => Promise<void>;
  complete: () => Promise<void>;
  confirmCash: () => Promise<void>;
  markUnpaid: () => Promise<void>;
  /** Resolves true when the ride was cancelled. */
  cancel: (reason: DriverCancelReason, note?: string) => Promise<boolean>;
  clearError: () => void;
  dismissNotice: () => void;
  resync: () => Promise<void>;
  /** Push / notification-center tap on a `ride_offer` or `ride` link. */
  openLink: (link: DeepLink | null) => void;
}

const DriverRideContext = createContext<DriverRideContextValue | null>(null);

/** Offer window when the payload has no `offeredAt` (DISPATCH_OFFER_SECONDS). */
export const OFFER_WINDOW_MS = 15000;
/** Notices clear themselves after this long. */
export const NOTICE_MS = 8000;

/**
 * The countdown deadline on the DEVICE clock. `expiresAt` is server time;
 * a device clock that is off would make the offer vanish at once (or run
 * long), so when `expiresAt` lies outside [now, now + window] the deadline
 * falls back to "the full window from now". The server stays the judge: a
 * late accept is answered 409 `offer_closed`.
 */
export function offerDeadline(
  offer: RideOffer,
  now: number = Date.now(),
): { deadline: number; windowMs: number } {
  const expiresAt = Date.parse(offer.expiresAt);
  const offeredAt = offer.offeredAt ? Date.parse(offer.offeredAt) : NaN;
  const windowMs =
    Number.isFinite(offeredAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt > offeredAt
      ? expiresAt - offeredAt
      : OFFER_WINDOW_MS;
  if (
    Number.isFinite(expiresAt) &&
    expiresAt >= now &&
    expiresAt <= now + windowMs
  ) {
    return { deadline: expiresAt, windowMs };
  }
  return { deadline: now + windowMs, windowMs };
}

function withDeadline(offer: RideOffer): OfferWithDeadline {
  return { offer, ...offerDeadline(offer) };
}

function noticeForEndedRide(ride: Ride): RideNotice | null {
  switch (ride.state) {
    case "cancelled_by_rider":
      return "riderCancelled";
    case "cancelled_by_driver":
      return "rideCancelled";
    case "completed":
      if (ride.paymentStatus === "paid_cash") return "cashConfirmed";
      if (ride.paymentStatus === "unpaid") return "markedUnpaid";
      return null;
    default:
      return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function DriverRideProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status: authStatus, isDriver } = useAuth();
  const active = authStatus === "signedIn" && isDriver;
  const availability = useOptionalAvailability();
  const subscribeRealtime = availability?.subscribeRealtime;
  const offlineConflict = availability?.actionError === "offlineConflict";

  const [offer, setOffer] = useState<OfferWithDeadline | null>(null);
  const [ride, setRide] = useState<Ride | null>(null);
  const [routeChangedFor, setRouteChangedFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<RideNotice | null>(null);
  const [pending, setPending] = useState<RideAction | null>(null);
  const [error, setError] = useState<RideActionError | null>(null);

  const mounted = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const offerRef = useRef<OfferWithDeadline | null>(null);
  offerRef.current = offer;
  const rideRef = useRef<Ride | null>(null);
  rideRef.current = ride;
  /** Bumped by every frame — a resync started before it is stale. */
  const eventSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const live = useCallback(
    () => mounted.current && activeRef.current,
    [],
  );

  const replaceOffer = useCallback((next: OfferWithDeadline | null) => {
    offerRef.current = next;
    setOffer(next);
  }, []);

  /** Adopt a server copy of a ride: active → current job; ended → cleared. */
  const applyRide = useCallback(
    (next: Ride, options: { noticeOnEnd?: boolean } = {}) => {
      const current = rideRef.current;
      if (isActiveForDriver(next)) {
        if (!current || current.id !== next.id || current.state !== next.state)
          setError(null);
        if (current && current.id !== next.id) setRouteChangedFor(null);
        rideRef.current = next;
        setRide(next);
        if (offerRef.current?.offer.rideId === next.id) replaceOffer(null);
        return;
      }
      if (current && current.id === next.id) {
        rideRef.current = null;
        setRide(null);
        setRouteChangedFor(null);
        setError(null);
        if (options.noticeOnEnd !== false) {
          const endNotice = noticeForEndedRide(next);
          if (endNotice) setNotice(endNotice);
        }
      }
      if (offerRef.current?.offer.rideId === next.id) replaceOffer(null);
    },
    [replaceOffer],
  );

  const clearAll = useCallback(() => {
    replaceOffer(null);
    rideRef.current = null;
    setRide(null);
    setRouteChangedFor(null);
    setNotice(null);
    setPending(null);
    setError(null);
  }, [replaceOffer]);

  /**
   * Refetch the open offer and the active ride. `expectOffer` (push tap on
   * `ride_offer`): a missing offer says so with a notice.
   */
  const resyncWith = useCallback(
    async (options: { expectOffer?: boolean } = {}) => {
      if (!activeRef.current) return;
      const seq = eventSeq.current;
      const previousRide = rideRef.current;
      const [offerResult, rideResult] = await Promise.allSettled([
        getOpenOffer(),
        getActiveRide(),
      ]);
      if (!live() || seq !== eventSeq.current) return;

      if (rideResult.status === "fulfilled") {
        const activeRide = rideResult.value;
        if (activeRide && isActiveForDriver(activeRide)) {
          applyRide(activeRide);
        } else if (previousRide && rideRef.current?.id === previousRide.id) {
          // It ended while we were not listening: learn how, for the notice.
          rideRef.current = null;
          setRide(null);
          setRouteChangedFor(null);
          setError(null);
          try {
            const ended = await getDriverRide(previousRide.id);
            const endNotice = live() ? noticeForEndedRide(ended) : null;
            if (endNotice) setNotice(endNotice);
          } catch {
            // The notice is a courtesy; the ride is gone either way.
          }
        }
      }
      if (offerResult.status === "fulfilled") {
        const open = offerResult.value;
        if (open) {
          if (offerRef.current?.offer.id !== open.id)
            replaceOffer(withDeadline(open));
        } else {
          if (!open && options.expectOffer) setNotice("offerGone");
          replaceOffer(null);
        }
      }
    },
    [applyRide, live, replaceOffer],
  );

  const resync = useCallback(() => resyncWith(), [resyncWith]);

  // ------------------------------------------------------------ frames

  const onFrame = useCallback(
    (frame: RideFrame) => {
      eventSeq.current += 1;
      switch (frame.type) {
        case "offer.new":
          setNotice(null);
          setError(null);
          replaceOffer(withDeadline(frame.offer));
          return;
        case "offer.withdrawn":
          if (offerRef.current?.offer.id === frame.offerId) {
            replaceOffer(null);
            setError(null);
            setNotice(
              frame.reason === "ride_ended" ? "offerCancelled" : "offerExpired",
            );
          }
          return;
        case "ride.state":
          applyRide(frame.ride);
          return;
        case "ride.updated":
          applyRide(frame.ride);
          if (
            frame.reason === "route_changed" &&
            isActiveForDriver(frame.ride)
          ) {
            setRouteChangedFor(frame.ride.id);
          }
          return;
        case "ride.connection": {
          const current = rideRef.current;
          if (current && current.id === frame.rideId) {
            const next = { ...current, driverStream: frame.driverStream };
            rideRef.current = next;
            setRide(next);
          }
          return;
        }
      }
    },
    [applyRide, replaceOffer],
  );

  useEffect(() => {
    if (!active || !subscribeRealtime) return undefined;
    return subscribeRealtime((event) => {
      if (!live()) return;
      if (event.kind === "connected") {
        void resyncWith();
        return;
      }
      const frame = parseDriverRideFrame(event.frame);
      if (frame) onFrame(frame);
    });
  }, [active, subscribeRealtime, live, onFrame, resyncWith]);

  // Activation / sign-out.
  useEffect(() => {
    if (!active) {
      clearAll();
      return;
    }
    void resyncWith();
  }, [active, clearAll, resyncWith]);

  // Foreground re-entry: frames may have been missed in the background.
  useEffect(() => {
    if (!active) return undefined;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") void resyncWith();
      previous = next;
    });
    return () => subscription.remove();
  }, [active, resyncWith]);

  // Going offline was refused (409, active ride): show the ride we missed.
  useEffect(() => {
    if (active && offlineConflict) void resyncWith();
  }, [active, offlineConflict, resyncWith]);

  // Offer countdown ran out.
  const offerId = offer?.offer.id ?? null;
  const offerDeadlineMs = offer?.deadline ?? null;
  useEffect(() => {
    if (!offerId || offerDeadlineMs === null) return undefined;
    const timer = setTimeout(
      () => {
        if (offerRef.current?.offer.id !== offerId) return;
        replaceOffer(null);
        setError(null);
        setNotice("offerExpired");
      },
      Math.max(0, offerDeadlineMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [offerId, offerDeadlineMs, replaceOffer]);

  // Notices clear themselves.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // ----------------------------------------------------------- actions

  const run = useCallback(
    async (
      action: RideAction,
      body: () => Promise<void>,
      onError: (error: unknown) => boolean,
    ): Promise<boolean> => {
      if (!activeRef.current) return false;
      setPending(action);
      setError(null);
      try {
        await body();
        // Our own answer is newer than any resync already in flight.
        eventSeq.current += 1;
        return true;
      } catch (caught) {
        if (!live()) return false;
        if (!onError(caught)) {
          setError({
            action,
            kind: caught instanceof ApiError ? "server" : "network",
          });
        }
        return false;
      } finally {
        if (mounted.current) setPending(null);
      }
    },
    [live],
  );

  /** A 409 (illegal_state …) means our copy is stale: resync. */
  const resyncOnConflict = useCallback(
    (caught: unknown): boolean => {
      if (caught instanceof ApiError && caught.status === 409) {
        void resyncWith();
        return true;
      }
      return false;
    },
    [resyncWith],
  );

  const accept = useCallback(async () => {
    const current = offerRef.current;
    if (!current) return;
    await run(
      "accept",
      async () => {
        const accepted = await acceptOffer(current.offer.id);
        if (!live()) return;
        replaceOffer(null);
        setNotice(null);
        applyRide(accepted);
      },
      (caught) => {
        const status = caught instanceof ApiError ? caught.status : 0;
        if (status === 409 || status === 404) {
          if (offerRef.current?.offer.id === current.offer.id)
            replaceOffer(null);
          setNotice("offerClosed");
          return true;
        }
        return false;
      },
    );
  }, [applyRide, live, replaceOffer, run]);

  const decline = useCallback(async () => {
    const current = offerRef.current;
    if (!current) return;
    await run(
      "decline",
      async () => {
        await declineOffer(current.offer.id);
        if (live() && offerRef.current?.offer.id === current.offer.id)
          replaceOffer(null);
      },
      (caught) => {
        const status = caught instanceof ApiError ? caught.status : 0;
        if (status === 409 || status === 404) {
          // Already closed — gone either way.
          if (offerRef.current?.offer.id === current.offer.id)
            replaceOffer(null);
          return true;
        }
        return false;
      },
    );
  }, [live, replaceOffer, run]);

  const rideStep = useCallback(
    (
      action: RideAction,
      call: (rideId: string) => Promise<Ride>,
      onError?: (caught: unknown) => boolean,
    ) =>
      async () => {
        const current = rideRef.current;
        if (!current) return;
        await run(
          action,
          async () => {
            const next = await call(current.id);
            if (live()) applyRide(next);
          },
          (caught) => (onError?.(caught) ?? false) || resyncOnConflict(caught),
        );
      },
    [applyRide, live, resyncOnConflict, run],
  );

  const arrive = useMemo(
    () =>
      rideStep("arrive", arriveAtPickup, (caught) => {
        const coded = rideErrorOf(caught);
        if (coded?.status !== 422) return false;
        const geofenceMeters = numberOrNull(coded.details.geofenceMeters);
        if (coded.code === "outside_geofence") {
          setError({
            action: "arrive",
            kind: "outsideGeofence",
            distanceMeters: numberOrNull(coded.details.distanceMeters),
            geofenceMeters: geofenceMeters ?? 100,
          });
          return true;
        }
        if (coded.code === "no_position") {
          setError({ action: "arrive", kind: "noPosition", geofenceMeters });
          return true;
        }
        return false;
      }),
    [rideStep],
  );
  const start = useMemo(() => rideStep("start", startRide), [rideStep]);
  const complete = useMemo(
    () => rideStep("complete", completeRide),
    [rideStep],
  );

  const settle = useCallback(
    (action: "cashConfirm" | "markUnpaid") =>
      rideStep(
        action,
        action === "cashConfirm" ? confirmCash : markUnpaid,
        (caught) => {
          const coded = rideErrorOf(caught);
          if (coded?.status === 409) {
            // Already settled elsewhere: refetch, then say so.
            void resyncWith().then(() => {
              if (live()) setNotice("paymentSettled");
            });
            return true;
          }
          return false;
        },
      ),
    [live, resyncWith, rideStep],
  );
  const confirmCashAction = useMemo(() => settle("cashConfirm"), [settle]);
  const markUnpaidAction = useMemo(() => settle("markUnpaid"), [settle]);

  const cancel = useCallback(
    async (reason: DriverCancelReason, note?: string) => {
      const current = rideRef.current;
      if (!current) return false;
      return run(
        "cancel",
        async () => {
          const cancelled = await cancelDriverRide(
            current.id,
            reason,
            note?.trim() || undefined,
          );
          if (live()) applyRide(cancelled);
        },
        (caught) => {
          const coded = rideErrorOf(caught);
          if (coded?.status === 422 && coded.code === "no_show_too_early") {
            const availableAt = coded.details.availableAt;
            setError({
              action: "cancel",
              kind: "noShowTooEarly",
              availableAt: typeof availableAt === "string" ? availableAt : null,
            });
            return true;
          }
          return resyncOnConflict(caught);
        },
      );
    },
    [applyRide, live, resyncOnConflict, run],
  );

  const clearError = useCallback(() => setError(null), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const openLink = useCallback(
    (link: DeepLink | null) => {
      if (link?.screen === "ride_offer") void resyncWith({ expectOffer: true });
      else if (link?.screen === "ride") void resyncWith();
    },
    [resyncWith],
  );

  const value = useMemo<DriverRideContextValue>(
    () => ({
      offer,
      ride,
      routeChanged: !!ride && routeChangedFor === ride.id,
      notice,
      pending,
      error,
      accept,
      decline,
      arrive,
      start,
      complete,
      confirmCash: confirmCashAction,
      markUnpaid: markUnpaidAction,
      cancel,
      clearError,
      dismissNotice,
      resync,
      openLink,
    }),
    [
      offer,
      ride,
      routeChangedFor,
      notice,
      pending,
      error,
      accept,
      decline,
      arrive,
      start,
      complete,
      confirmCashAction,
      markUnpaidAction,
      cancel,
      clearError,
      dismissNotice,
      resync,
      openLink,
    ],
  );

  return (
    <DriverRideContext.Provider value={value}>
      {children}
    </DriverRideContext.Provider>
  );
}

/** Null without the provider (provider-less unit tests of the home screen). */
export function useOptionalDriverRide(): DriverRideContextValue | null {
  return useContext(DriverRideContext);
}

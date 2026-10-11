/**
 * Driver availability facade (DRV-05, UC-D-04, TRK-01) — mounted at the
 * root so streaming survives navigation; active only for a signed-in
 * driver with an ACTIVE role.
 *
 * - Loads `GET /driver/availability` on activation, on foreground re-entry,
 *   and every `staleAfterSeconds` while online (keeps `streamHealthy` fresh).
 * - Going online: location permission FIRST (UC-D-04 E3 — denied ⇒ the
 *   driver can't go online; explained, with a settings link), then
 *   `PUT {online:true}`. A 409 re-reads the GET, whose
 *   `cannotGoOnlineReason` explains the refusal (E1).
 * - While the server says online AND location is granted, a
 *   LocationStreamer runs; anything else stops it (going offline,
 *   being taken offline server-side, signing out).
 * - A user-initiated sign-out takes an online driver offline first
 *   (best-effort sign-out task).
 * - The same socket carries M7's ride / offer events: `subscribeRealtime`
 *   hands every (re)connect and every non-protocol frame to the ride slice
 *   (rides/DriverRideProvider), which filters and resyncs — one socket only.
 */
import * as Location from "expo-location";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Linking } from "react-native";

import {
  getAvailability,
  postLocationSamples,
  setAvailability,
} from "../api/availability";
import { ApiError, refreshSession } from "../api/client";
import type { DriverAvailability, LocationSample } from "../api/realtime-types";
import { useAuth } from "../auth/AuthProvider";
import { getSession, subscribeToSession } from "../auth/session";
import { addSignOutTask } from "../auth/sign-out-tasks";
import { getConfig } from "../config";
import { failureKindOf } from "../onboarding/server-errors";
import { runExclusive } from "../permissions/permission-queue";
import type { FailureKind } from "../onboarding/server-errors";
import { driverLocationSource } from "./location-source";
import { LocationStreamer } from "./location-streamer";
import type { SocketLike, StreamStatus } from "./location-streamer";
import { realtimeUrl } from "./protocol";

export type AvailabilityLoad =
  | { status: "loading" }
  | { status: "loaded"; data: DriverAvailability }
  /** 409 on GET: the account has no driver profile. */
  | { status: "noProfile" }
  | { status: "error"; kind: FailureKind };

export type GpsPermission = "unknown" | "granted" | "denied";

export type AvailabilityActionError =
  | FailureKind
  /** PUT online refused although the GET reports no reason. */
  | "onlineRefused"
  /** PUT offline refused (M7: an active ride must finish first). */
  | "offlineConflict";

/** What the socket hands to realtime consumers (the ride slice). */
export type RealtimeEvent =
  /** A socket reached `ready` (connect or reconnect) — refetch, events are not replayed. */
  | { kind: "connected" }
  /** A raw server frame the streamer does not handle itself (`ride.*`, `offer.*`…). */
  | { kind: "frame"; frame: Record<string, unknown> };

export type RealtimeListener = (event: RealtimeEvent) => void;

export interface AvailabilityContextValue {
  load: AvailabilityLoad;
  /** A toggle request in flight. */
  pending: "online" | "offline" | null;
  actionError: AvailabilityActionError | null;
  gps: GpsPermission;
  /** false once the OS will no longer show the permission prompt. */
  gpsCanAskAgain: boolean;
  /** GPS could not start although permission is granted (services off). */
  gpsUnavailable: boolean;
  stream: StreamStatus;
  /**
   * The server's `streamHealthy`, but only from a read made while our
   * socket was live (right after going online it is meaningless) — null
   * until then.
   */
  serverHealthy: boolean | null;
  /** Latest own position while online (for the map). */
  position: LocationSample | null;
  goOnline: () => Promise<void>;
  goOffline: () => Promise<void>;
  reload: () => Promise<void>;
  openSettings: () => void;
  /** Ride / offer events and (re)connects of the realtime socket; returns the unsubscribe. */
  subscribeRealtime: (listener: RealtimeListener) => () => void;
}

const AvailabilityContext = createContext<AvailabilityContextValue | null>(
  null,
);

/** Floor for the online poll, whatever the server's stale window. */
const MIN_POLL_MS = 15000;

function createWebSocket(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike;
}

export function AvailabilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status: authStatus, isDriver } = useAuth();
  const active = authStatus === "signedIn" && isDriver;

  const [load, setLoad] = useState<AvailabilityLoad>({ status: "loading" });
  const [pending, setPending] = useState<"online" | "offline" | null>(null);
  const [actionError, setActionError] =
    useState<AvailabilityActionError | null>(null);
  const [gps, setGps] = useState<GpsPermission>("unknown");
  const [gpsCanAskAgain, setGpsCanAskAgain] = useState(true);
  const [gpsUnavailable, setGpsUnavailable] = useState(false);
  const [stream, setStream] = useState<StreamStatus>("idle");
  const [serverHealthy, setServerHealthy] = useState<boolean | null>(null);
  const streamRef = useRef<StreamStatus>("idle");
  streamRef.current = stream;
  const [position, setPosition] = useState<LocationSample | null>(null);

  const mounted = useRef(true);
  const realtimeListeners = useRef(new Set<RealtimeListener>());
  const emitRealtime = useCallback((event: RealtimeEvent) => {
    for (const listener of [...realtimeListeners.current]) {
      try {
        listener(event);
      } catch {
        // One consumer's failure never breaks the socket or the others.
      }
    }
  }, []);
  const subscribeRealtime = useCallback((listener: RealtimeListener) => {
    realtimeListeners.current.add(listener);
    return () => {
      realtimeListeners.current.delete(listener);
    };
  }, []);
  const activeRef = useRef(active);
  activeRef.current = active;
  const dataRef = useRef<DriverAvailability | null>(null);
  dataRef.current = load.status === "loaded" ? load.data : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** GET; `quiet` keeps the current state on failure (polls, foreground). */
  const fetchAvailability = useCallback(
    async (quiet: boolean): Promise<DriverAvailability | null> => {
      if (!quiet) setLoad({ status: "loading" });
      const liveAtStart = streamRef.current === "live";
      try {
        const data = await getAvailability();
        if (mounted.current && activeRef.current) {
          setLoad({ status: "loaded", data });
          if (liveAtStart && streamRef.current === "live") {
            setServerHealthy(data.streamHealthy ?? null);
          }
        }
        return data;
      } catch (error) {
        if (!mounted.current || !activeRef.current) return null;
        if (error instanceof ApiError && error.status === 409) {
          setLoad({ status: "noProfile" });
        } else if (!quiet || !dataRef.current) {
          setLoad({ status: "error", kind: failureKindOf(error) });
        }
        return null;
      }
    },
    [],
  );

  /**
   * Retry / pull-to-refresh. With a state on screen the read is quiet, so
   * refreshing while online never tears the running stream down.
   */
  const reload = useCallback(async () => {
    setActionError(null);
    await fetchAvailability(dataRef.current !== null);
  }, [fetchAvailability]);

  const askLocation = useCallback(async (): Promise<boolean> => {
    try {
      const permission = await runExclusive(() =>
        Location.requestForegroundPermissionsAsync(),
      );
      if (!mounted.current) return false;
      setGps(permission.granted ? "granted" : "denied");
      setGpsCanAskAgain(permission.canAskAgain !== false);
      return permission.granted;
    } catch {
      if (mounted.current) setGps("denied");
      return false;
    }
  }, []);

  const goOnline = useCallback(async () => {
    setActionError(null);
    setPending("online");
    try {
      // UC-D-04 E3: no location, no going online.
      if (!(await askLocation())) return;
      setGpsUnavailable(false);
      try {
        const data = await setAvailability(true);
        if (mounted.current) setLoad({ status: "loaded", data });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // The GET carries the machine-readable reason (E1).
          const fresh = await fetchAvailability(true);
          if (mounted.current && fresh?.canGoOnline)
            setActionError("onlineRefused");
        } else if (mounted.current) {
          setActionError(failureKindOf(error));
        }
      }
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [askLocation, fetchAvailability]);

  const goOffline = useCallback(async () => {
    setActionError(null);
    setPending("offline");
    try {
      const data = await setAvailability(false);
      if (mounted.current) setLoad({ status: "loaded", data });
    } catch (error) {
      if (!mounted.current) return;
      setActionError(
        error instanceof ApiError && error.status === 409
          ? "offlineConflict"
          : failureKindOf(error),
      );
    } finally {
      if (mounted.current) setPending(null);
    }
  }, []);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  // Activation / deactivation.
  useEffect(() => {
    if (!active) {
      setLoad({ status: "loading" });
      setPending(null);
      setActionError(null);
      setGps("unknown");
      setGpsUnavailable(false);
      return;
    }
    void fetchAvailability(false);
  }, [active, fetchAvailability]);

  const online = load.status === "loaded" && load.data.online;

  // Online on arrival (app restarted while online): check location once.
  useEffect(() => {
    if (active && online && gps === "unknown") void askLocation();
  }, [active, online, gps, askLocation]);

  // The stream runs exactly while online with location granted.
  const shouldStream = active && online && gps === "granted";
  useEffect(() => {
    if (!shouldStream) return undefined;
    const data = dataRef.current;
    const intervalSeconds = data?.streamIntervalSeconds ?? 5;
    let healthTimer: ReturnType<typeof setTimeout> | null = null;
    const streamer = new LocationStreamer({
      url: realtimeUrl(getConfig().apiBaseUrl),
      createSocket: createWebSocket,
      // Background when the build + "Allow all the time" permit (M6-X2), else foreground.
      source: driverLocationSource(intervalSeconds),
      intervalSeconds,
      staleAfterSeconds: data?.staleAfterSeconds ?? 30,
      getAccessToken: () => getSession()?.accessToken ?? null,
      subscribeSession: subscribeToSession,
      refreshSession: async () => (await refreshSession())?.accessToken ?? null,
      postSamples: postLocationSamples,
      onStatus: (next) => {
        if (!mounted.current) return;
        setStream(next);
        if (next !== "live") setServerHealthy(null);
        // Confirm server-side health one interval after (re)connecting.
        if (next === "live") {
          if (healthTimer) clearTimeout(healthTimer);
          healthTimer = setTimeout(
            () => {
              healthTimer = null;
              if (streamRef.current === "live") void fetchAvailability(true);
            },
            intervalSeconds * 1000 + 2000,
          );
        }
      },
      onFix: (sample) => {
        if (mounted.current) {
          setPosition(sample);
          setGpsUnavailable(false);
        }
      },
      onRejected: () => {
        void fetchAvailability(true);
      },
      onSourceError: () => {
        if (mounted.current) setGpsUnavailable(true);
      },
      onConnected: () => {
        if (mounted.current) emitRealtime({ kind: "connected" });
      },
      onEvent: (frame) => {
        if (mounted.current) emitRealtime({ kind: "frame", frame });
      },
    });
    void streamer.start();
    return () => {
      if (healthTimer) clearTimeout(healthTimer);
      streamer.stop();
      if (mounted.current) {
        setStream("idle");
        setServerHealthy(null);
        setPosition(null);
      }
    };
  }, [shouldStream, fetchAvailability, emitRealtime]);

  // While online and in the foreground, re-read the server's view.
  const pollMs =
    load.status === "loaded"
      ? Math.max(MIN_POLL_MS, load.data.staleAfterSeconds * 1000)
      : MIN_POLL_MS;
  useEffect(() => {
    if (!active || !online) return undefined;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void fetchAvailability(true);
    }, pollMs);
    return () => clearInterval(timer);
  }, [active, online, pollMs, fetchAvailability]);

  // Foreground re-entry: refresh the state (and with it the stream).
  useEffect(() => {
    if (!active) return undefined;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active")
        void fetchAvailability(true);
      previous = next;
    });
    return () => subscription.remove();
  }, [active, fetchAvailability]);

  // Signing out while online: go offline first (best-effort).
  useEffect(() => {
    if (!active) return undefined;
    return addSignOutTask(async () => {
      if (dataRef.current?.online) await setAvailability(false);
    });
  }, [active]);

  const value = useMemo<AvailabilityContextValue>(
    () => ({
      load,
      pending,
      actionError,
      gps,
      gpsCanAskAgain,
      gpsUnavailable,
      stream,
      serverHealthy,
      position,
      goOnline,
      goOffline,
      reload,
      openSettings,
      subscribeRealtime,
    }),
    [
      load,
      pending,
      actionError,
      gps,
      gpsCanAskAgain,
      gpsUnavailable,
      stream,
      serverHealthy,
      position,
      goOnline,
      goOffline,
      reload,
      openSettings,
      subscribeRealtime,
    ],
  );

  return (
    <AvailabilityContext.Provider value={value}>
      {children}
    </AvailabilityContext.Provider>
  );
}

/** Null without the provider (provider-less unit tests of the home screen). */
export function useOptionalAvailability(): AvailabilityContextValue | null {
  return useContext(AvailabilityContext);
}

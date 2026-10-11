import { ApiError } from "../api/client";
import { LOCATION_BATCH_MAX } from "../api/realtime-types";
import type { LocationSample } from "../api/realtime-types";
import type { LocationSource } from "./location-source";
import {
  accessTokenExpiryMs,
  backoffDelayMs,
  CLOSE_NORMAL,
  CLOSE_UNAUTHORIZED,
  parseServerFrame,
  sampleFromFix,
} from "./protocol";
import type { ClientFrame, GpsFix } from "./protocol";

/**
 * Driver location streaming over the realtime WebSocket (TRK-01, TRK-04,
 * realtime-v1.yaml) — runs only while the driver is online.
 *
 * Lifecycle, frame by frame:
 * 1. Connect (`ws(s)://<api>/api/v1/realtime`, no token in the URL) and send
 *    `{"type":"auth","token"}` as the FIRST frame; wait for `ready` (which
 *    may override the sample interval).
 * 2. Every `streamIntervalSeconds` send the latest GPS fix as a `location`
 *    frame (fire-and-forget). A fix older than `staleAfterSeconds` is NOT
 *    resent — the server should see a silent stream rather than a fake-fresh
 *    one (TRK-04). Sending is ALSO fix-driven: Android pauses JS timers in
 *    the background while the OS location task (M6-X2) keeps delivering
 *    fixes every interval, so each fix sends itself once at least the
 *    interval has passed since the last send. The timer stays for the
 *    foreground (a stationary driver with flaky GPS must not go silent).
 * 3. Whenever the session's access token rotates (refresh by any caller) a
 *    new `auth` frame is sent on the open socket; ~60 s before the token's
 *    `exp` the streamer refreshes it proactively so the socket never lapses.
 * 4. `ping` every 25 s; no frame back within 10 s ⇒ the socket is treated as
 *    dead (half-open mobile connections) and replaced.
 * 5. Close 4401 ⇒ refresh the session, then reconnect (a dead refresh token
 *    signs the user out). Any other close (1001 shutdown, 4400, network) ⇒
 *    reconnect with exponential backoff (1 s … 30 s, jittered). In the
 *    background the backoff timer is paused with the rest of the JS timers,
 *    so a fix also reconnects once the backoff delay has already elapsed.
 * 6. While disconnected, samples are buffered (newest 20, the REST batch
 *    max); after the next `ready` they are flushed in one
 *    `POST /driver/locations` batch.
 * 7. `error` frames: `not_online` / `not_driver` are reported so availability
 *    can be re-read; `invalid_sample` is dropped. Every other frame type (M7's
 *    `ride.*` / `offer.*` events) is handed on raw through `onEvent` — the
 *    ride slice parses and filters it; this class stays protocol-only.
 * 8. `onConnected` fires on the FIRST `ready` of every socket (connect and
 *    each reconnect — not on re-auth), so the ride slice can resync: events
 *    are not replayed (rides-v1.yaml).
 *
 * Battery choices: one socket, one tiny frame per interval, pings only every
 * 25 s, GPS at the stream cadence, and everything stops when offline — the
 * full rationale is in the driver README ("Battery").
 */

export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting";

/** The subset of the WebSocket API the streamer uses. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

const SOCKET_OPEN = 1;

export const PING_INTERVAL_MS = 25000;
export const PONG_TIMEOUT_MS = 10000;
/** Refresh the access token this long before its `exp`. */
export const TOKEN_REFRESH_LEAD_MS = 60000;
/** Retry delay after a transiently failed proactive refresh. */
export const TOKEN_REFRESH_RETRY_MS = 15000;

export type StreamRejection = "not_online" | "not_driver";

export interface StreamerDeps {
  url: string;
  createSocket: (url: string) => SocketLike;
  source: LocationSource;
  intervalSeconds: number;
  staleAfterSeconds: number;
  getAccessToken: () => string | null;
  subscribeSession: (listener: () => void) => () => void;
  /** Rotates the session: new access token, null when the session is dead, throws when transient. */
  refreshSession: () => Promise<string | null>;
  postSamples: (samples: LocationSample[]) => Promise<void>;
  onStatus?: (status: StreamStatus) => void;
  onFix?: (sample: LocationSample) => void;
  /** The server says this driver can't stream (offline / not a driver). */
  onRejected?: (code: StreamRejection) => void;
  /** GPS could not start. */
  onSourceError?: (error: unknown) => void;
  /** First `ready` of each socket (connect / reconnect) — resync point. */
  onConnected?: () => void;
  /** Server frames of any type this class does not handle itself. */
  onEvent?: (frame: Record<string, unknown>) => void;
  random?: () => number;
  now?: () => number;
}

type Timer = ReturnType<typeof setTimeout>;

export class LocationStreamer {
  private readonly deps: StreamerDeps;
  private running = false;
  private socket: SocketLike | null = null;
  private authenticated = false;
  private everLive = false;
  private sentToken: string | null = null;
  private attempts = 0;
  private unauthorizedCloses = 0;
  private intervalSeconds: number;
  private staleAfterSeconds: number;
  private latest: LocationSample | null = null;
  /** When the last sample was sent/buffered — gates the fix-driven path. */
  private lastSentAt = 0;
  /** When the pending backoff reconnect is due — a fix past it reconnects. */
  private reconnectAt = 0;
  private buffer: LocationSample[] = [];
  private flushing = false;
  private status: StreamStatus = "idle";
  private stopSource: (() => void) | null = null;
  private unsubscribeSession: (() => void) | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: Timer | null = null;
  private reconnectTimer: Timer | null = null;
  private refreshTimer: Timer | null = null;

  constructor(deps: StreamerDeps) {
    this.deps = deps;
    this.intervalSeconds = deps.intervalSeconds;
    this.staleAfterSeconds = deps.staleAfterSeconds;
  }

  getStatus(): StreamStatus {
    return this.status;
  }

  /** Samples waiting for the REST flush (exposed for diagnostics/tests). */
  pendingSamples(): readonly LocationSample[] {
    return this.buffer;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastSentAt = this.deps.now?.() ?? Date.now();
    this.unsubscribeSession = this.deps.subscribeSession(() =>
      this.onSessionChange(),
    );
    this.scheduleTokenRefresh();
    this.connect();
    this.restartTicker();
    try {
      const stop = await this.deps.source.start((fix) => this.onFix(fix));
      if (!this.running) {
        stop();
        return;
      }
      this.stopSource = stop;
    } catch (error) {
      if (this.running) this.deps.onSourceError?.(error);
    }
  }

  /** Going offline / signing out: stops GPS, timers and the socket. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.clearTimers();
    this.stopSource?.();
    this.stopSource = null;
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.dropSocket(CLOSE_NORMAL);
    this.buffer = [];
    this.latest = null;
    this.setStatus("idle");
  }

  // ------------------------------------------------------------ socket

  private connect(): void {
    this.clearTimer("reconnect");
    if (!this.running) return;
    if (!this.deps.getAccessToken()) {
      this.stop();
      return;
    }
    this.setStatus(this.everLive ? "reconnecting" : "connecting");
    let socket: SocketLike;
    try {
      socket = this.deps.createSocket(this.deps.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (socket === this.socket) this.sendAuth();
    };
    socket.onmessage = (event) => {
      if (socket === this.socket) this.onFrame(event.data);
    };
    socket.onclose = (event) => {
      if (socket === this.socket) this.onClosed(event?.code);
    };
    // A close event always follows an error; nothing to do here.
    socket.onerror = () => {};
  }

  /** Detaches and closes the current socket without triggering a reconnect. */
  private dropSocket(code: number): void {
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    this.stopPing();
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(code);
    } catch {
      // already closed
    }
  }

  private send(frame: ClientFrame): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  private sendAuth(): void {
    const token = this.deps.getAccessToken();
    if (!token) {
      this.stop();
      return;
    }
    if (this.send({ type: "auth", token })) this.sentToken = token;
  }

  private onFrame(data: unknown): void {
    this.clearTimer("pong");
    const frame = parseServerFrame(data);
    if (!frame) return;
    switch (frame.type) {
      case "ready": {
        const firstReady = !this.authenticated;
        this.authenticated = true;
        this.everLive = true;
        this.attempts = 0;
        this.unauthorizedCloses = 0;
        if (frame.staleAfterSeconds)
          this.staleAfterSeconds = frame.staleAfterSeconds;
        if (
          frame.streamIntervalSeconds &&
          frame.streamIntervalSeconds !== this.intervalSeconds
        ) {
          this.intervalSeconds = frame.streamIntervalSeconds;
          this.restartTicker();
        }
        this.setStatus("live");
        if (firstReady) {
          this.startPing();
          if (this.buffer.length > 0) void this.flush();
          else this.tick();
          this.deps.onConnected?.();
        }
        break;
      }
      case "error":
        if (frame.code === "not_online" || frame.code === "not_driver") {
          this.deps.onRejected?.(frame.code);
        }
        // invalid_sample: the sample is dropped server-side; nothing to retry.
        break;
      case "pong":
        // Liveness handled above.
        break;
      case "unknown":
        this.deps.onEvent?.(frame.raw);
        break;
    }
  }

  private onClosed(code: number | undefined): void {
    this.socket = null;
    this.authenticated = false;
    this.stopPing();
    if (!this.running) return;
    if (code === CLOSE_UNAUTHORIZED) {
      this.unauthorizedCloses += 1;
      void this.reauthenticateAndReconnect();
      return;
    }
    this.scheduleReconnect();
  }

  private async reauthenticateAndReconnect(): Promise<void> {
    this.setStatus("reconnecting");
    let token: string | null;
    try {
      token = await this.deps.refreshSession();
    } catch {
      if (this.running) this.scheduleReconnect();
      return;
    }
    if (!this.running) return;
    if (!token) {
      // Session dead (revoked / password changed): the refresh signed out.
      this.stop();
      return;
    }
    // A fresh token rejected again: back off instead of hammering the server.
    if (this.unauthorizedCloses > 1) this.scheduleReconnect();
    else this.connect();
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    this.attempts += 1;
    this.setStatus("reconnecting");
    this.clearTimer("reconnect");
    const delay = backoffDelayMs(this.attempts, this.deps.random);
    this.reconnectAt = (this.deps.now?.() ?? Date.now()) + delay;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  // ---------------------------------------------------------- keep-alive

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.authenticated) return;
      // Armed before sending: any frame that arrives disarms it.
      this.clearTimer("pong");
      this.pongTimer = setTimeout(() => {
        // No frame back: half-open connection. Replace it.
        this.dropSocket(CLOSE_NORMAL);
        this.scheduleReconnect();
      }, PONG_TIMEOUT_MS);
      if (!this.send({ type: "ping" })) this.clearTimer("pong");
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.clearTimer("pong");
  }

  // ------------------------------------------------------------- samples

  private onFix(fix: GpsFix): void {
    if (!this.running) return;
    const sample = sampleFromFix(fix);
    this.latest = sample;
    this.deps.onFix?.(sample);
    // Android pauses JS timers in the background while the OS location task
    // keeps delivering fixes, so the fix itself drives sending (once the
    // interval has passed) and the overdue backoff reconnect (M6-X2).
    const now = this.deps.now?.() ?? Date.now();
    if (now - this.lastSentAt >= this.intervalSeconds * 1000) this.tick();
    if (!this.socket && this.reconnectTimer && now >= this.reconnectAt) {
      this.connect();
    }
  }

  private restartTicker(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(
      () => this.tick(),
      this.intervalSeconds * 1000,
    );
  }

  private tick(): void {
    const sample = this.latest;
    if (!sample) return;
    const now = this.deps.now?.() ?? Date.now();
    if (now - Date.parse(sample.recordedAt) > this.staleAfterSeconds * 1000)
      return;
    this.lastSentAt = now;
    if (this.authenticated && this.send({ type: "location", ...sample }))
      return;
    this.bufferSample(sample);
  }

  private bufferSample(sample: LocationSample): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && last.recordedAt === sample.recordedAt) return;
    this.buffer.push(sample);
    if (this.buffer.length > LOCATION_BATCH_MAX) {
      this.buffer.splice(0, this.buffer.length - LOCATION_BATCH_MAX);
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer.splice(0, LOCATION_BATCH_MAX);
    try {
      await this.deps.postSamples(batch);
    } catch (error) {
      if (!this.running) return;
      if (error instanceof ApiError && error.status === 409) {
        this.deps.onRejected?.("not_online");
      } else if (!(error instanceof ApiError && error.status === 400)) {
        // Network / server trouble: keep them for the next reconnect.
        this.buffer = [...batch, ...this.buffer].slice(-LOCATION_BATCH_MAX);
      }
    } finally {
      this.flushing = false;
    }
  }

  // ------------------------------------------------------------ session

  private onSessionChange(): void {
    if (!this.running) return;
    const token = this.deps.getAccessToken();
    if (!token) {
      this.stop();
      return;
    }
    if (token === this.sentToken) return;
    this.scheduleTokenRefresh();
    // Re-auth on the open socket; a socket still opening sends the new token itself.
    if (this.socket && this.socket.readyState === SOCKET_OPEN) this.sendAuth();
  }

  private scheduleTokenRefresh(): void {
    this.clearTimer("refresh");
    const token = this.deps.getAccessToken();
    const expiresAt = token ? accessTokenExpiryMs(token) : null;
    if (expiresAt === null) return;
    const now = this.deps.now?.() ?? Date.now();
    this.armRefresh(Math.max(0, expiresAt - TOKEN_REFRESH_LEAD_MS - now));
  }

  private armRefresh(delay: number): void {
    this.refreshTimer = setTimeout(async () => {
      if (!this.running) return;
      try {
        const token = await this.deps.refreshSession();
        if (!token) this.stop();
        // Success: the session listener re-auths and re-arms the timer.
      } catch {
        if (this.running) this.armRefresh(TOKEN_REFRESH_RETRY_MS);
      }
    }, delay);
  }

  // ------------------------------------------------------------- helpers

  private setStatus(status: StreamStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.deps.onStatus?.(status);
  }

  private clearTimer(which: "pong" | "reconnect" | "refresh"): void {
    if (which === "pong" && this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    } else if (which === "reconnect" && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    } else if (which === "refresh" && this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.stopPing();
    this.clearTimer("reconnect");
    this.clearTimer("refresh");
  }
}

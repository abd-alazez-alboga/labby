import {
  accessTokenExpiryMs,
  backoffDelayMs,
  CLOSE_NORMAL,
  CLOSE_UNAUTHORIZED,
  type ClientFrame,
  parseServerFrame,
  type RideEvent,
} from "./protocol";

/**
 * The rider app's realtime socket (realtime-v1.yaml, rides-v1.yaml
 * "Realtime events"). The rider never streams locations — the socket only
 * RECEIVES the ride frames addressed to the rider.
 *
 * Lifecycle:
 * 1. Connect to `ws(s)://<api>/api/v1/realtime` (no token in the URL) and
 *    send `{"type":"auth","token"}` as the FIRST frame.
 * 2. Every `ready` (first connect AND every reconnect) calls `onReady` — the
 *    ride facade resyncs from `GET /rides/active` there, because events are
 *    not replayed.
 * 3. When the stored access token rotates (a refresh by any caller) a new
 *    `auth` frame goes out on the open socket; ~60 s before the token's
 *    `exp` the client refreshes it proactively so the socket never lapses.
 * 4. `ping` every 25 s (the server closes idle sockets after 60 s); no frame
 *    back within 10 s ⇒ the socket is treated as dead and replaced.
 * 5. Close 4401 ⇒ refresh the session, then reconnect (a dead session stops
 *    the client — the http client already signed the user out). Any other
 *    close (1001 shutdown, 4400, network) ⇒ reconnect with exponential
 *    backoff (1 s … 30 s, jittered).
 * 6. Frames for another audience (`as` ≠ `rider`) and unknown types are
 *    ignored (protocol.ts).
 */

export type SocketStatus = "idle" | "connecting" | "live" | "reconnecting";

/** The subset of the WebSocket API the client uses. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

const SOCKET_OPEN = 1;

export const PING_INTERVAL_MS = 25000;
export const PONG_TIMEOUT_MS = 10000;
export const TOKEN_REFRESH_LEAD_MS = 60000;
export const TOKEN_REFRESH_RETRY_MS = 15000;

export interface RiderSocketDeps {
  url: string;
  createSocket: SocketFactory;
  getAccessToken: () => Promise<string | null>;
  subscribeTokens: (listener: () => void) => () => void;
  /** Rotates the session: the new access token, or null (dead or transient). */
  refreshSession: () => Promise<string | null>;
  onReady: () => void;
  onEvent: (event: RideEvent) => void;
  onStatus?: (status: SocketStatus) => void;
  random?: () => number;
  now?: () => number;
}

type Timer = ReturnType<typeof setTimeout>;

export class RiderSocket {
  private readonly deps: RiderSocketDeps;
  private running = false;
  private socket: SocketLike | null = null;
  private authenticated = false;
  private sentToken: string | null = null;
  private attempts = 0;
  private unauthorizedCloses = 0;
  private status: SocketStatus = "idle";
  private unsubscribeTokens: (() => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: Timer | null = null;
  private reconnectTimer: Timer | null = null;
  private refreshTimer: Timer | null = null;

  constructor(deps: RiderSocketDeps) {
    this.deps = deps;
  }

  getStatus(): SocketStatus {
    return this.status;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribeTokens = this.deps.subscribeTokens(() => {
      void this.onTokensChanged();
    });
    void this.scheduleTokenRefresh();
    void this.connect();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.unsubscribeTokens?.();
    this.unsubscribeTokens = null;
    this.clearReconnect();
    this.clearRefresh();
    this.dropSocket(CLOSE_NORMAL);
    this.setStatus("idle");
  }

  // ------------------------------------------------------------ socket

  private async connect(): Promise<void> {
    this.clearReconnect();
    if (!this.running) return;
    const token = await this.deps.getAccessToken();
    if (!this.running) return;
    if (!token) {
      this.stop();
      return;
    }
    this.setStatus(this.attempts > 0 ? "reconnecting" : "connecting");
    let socket: SocketLike;
    try {
      socket = this.deps.createSocket(this.deps.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (socket === this.socket) void this.sendAuth();
    };
    socket.onmessage = (event) => {
      if (socket === this.socket) this.onFrame(event.data);
    };
    socket.onclose = (event) => {
      if (socket === this.socket) this.onClosed(event?.code);
    };
    // A close event always follows an error.
    socket.onerror = () => {};
  }

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

  private async sendAuth(): Promise<void> {
    const token = await this.deps.getAccessToken();
    if (!this.running) return;
    if (!token) {
      this.stop();
      return;
    }
    if (this.send({ type: "auth", token })) this.sentToken = token;
  }

  private onFrame(data: unknown): void {
    this.clearPong();
    const frame = parseServerFrame(data);
    if (!frame) return;
    switch (frame.type) {
      case "ready": {
        const firstReady = !this.authenticated;
        this.authenticated = true;
        this.attempts = 0;
        this.unauthorizedCloses = 0;
        this.setStatus("live");
        if (firstReady) {
          this.startPing();
          // Events are not replayed: resync on every (re)connect.
          this.deps.onReady();
        }
        break;
      }
      case "ride":
        this.deps.onEvent(frame.event);
        break;
      case "pong":
      case "error":
      case "ignored":
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
    let token: string | null = null;
    try {
      token = await this.deps.refreshSession();
    } catch {
      token = null;
    }
    if (!this.running) return;
    if (!token) {
      // Tokens gone ⇒ the session is dead (already signed out): stop.
      // Tokens kept ⇒ transient refresh trouble: back off and try again.
      if (!(await this.deps.getAccessToken())) {
        this.stop();
        return;
      }
      this.scheduleReconnect();
      return;
    }
    // A fresh token rejected again: back off instead of hammering.
    if (this.unauthorizedCloses > 1) this.scheduleReconnect();
    else void this.connect();
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    this.attempts += 1;
    this.setStatus("reconnecting");
    this.clearReconnect();
    const delay = backoffDelayMs(this.attempts, this.deps.random);
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  // ---------------------------------------------------------- keep-alive

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.authenticated) return;
      this.clearPong();
      this.pongTimer = setTimeout(() => {
        // No frame back: half-open connection. Replace it.
        this.dropSocket(CLOSE_NORMAL);
        this.scheduleReconnect();
      }, PONG_TIMEOUT_MS);
      if (!this.send({ type: "ping" })) this.clearPong();
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.clearPong();
  }

  // ------------------------------------------------------------ session

  private async onTokensChanged(): Promise<void> {
    if (!this.running) return;
    const token = await this.deps.getAccessToken();
    if (!this.running) return;
    if (!token) {
      this.stop();
      return;
    }
    if (token === this.sentToken) return;
    void this.scheduleTokenRefresh();
    // Re-auth on the open socket; a socket still opening sends it itself.
    if (this.socket && this.socket.readyState === SOCKET_OPEN) {
      void this.sendAuth();
    }
  }

  private async scheduleTokenRefresh(): Promise<void> {
    this.clearRefresh();
    const token = await this.deps.getAccessToken();
    const expiresAt = token ? accessTokenExpiryMs(token) : null;
    if (expiresAt === null || !this.running) return;
    const now = this.deps.now?.() ?? Date.now();
    this.armRefresh(Math.max(0, expiresAt - TOKEN_REFRESH_LEAD_MS - now));
  }

  private armRefresh(delay: number): void {
    this.clearRefresh();
    this.refreshTimer = setTimeout(async () => {
      if (!this.running) return;
      const token = await this.deps.refreshSession().catch(() => null);
      if (!this.running) return;
      // Success: the token listener re-auths and re-arms the timer.
      if (!token) this.armRefresh(TOKEN_REFRESH_RETRY_MS);
    }, delay);
  }

  // ------------------------------------------------------------- helpers

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.deps.onStatus?.(status);
  }

  private clearPong(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}

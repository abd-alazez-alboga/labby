import type { DriverAvailability } from '../api/realtime-types';
import type { SocketLike } from '../realtime/location-streamer';

/**
 * Scriptable WebSocket double for the realtime protocol
 * (realtime-v1.yaml): tests drive the server side frame by frame.
 */
export class MockSocket implements SocketLike {
  static instances: MockSocket[] = [];

  static reset(): void {
    MockSocket.instances = [];
  }

  static latest(): MockSocket {
    const socket = MockSocket.instances[MockSocket.instances.length - 1];
    if (!socket) throw new Error('No socket was created');
    return socket;
  }

  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  /** Answer every ping with a pong (long-running healthy connections). */
  autoPong = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
    if (this.autoPong && JSON.parse(data).type === 'ping') {
      this.receive({ type: 'pong' });
    }
  }

  close(code?: number): void {
    this.readyState = 3;
    this.closedWith = code ?? 1000;
  }

  // ------------------------------------------------ server-side helpers

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  ready(overrides: Record<string, unknown> = {}): void {
    this.receive({
      type: 'ready',
      userId: 'user-1',
      streamIntervalSeconds: 5,
      staleAfterSeconds: 30,
      ...overrides,
    });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  frames(): { type: string; [key: string]: unknown }[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }

  framesOfType(type: string) {
    return this.frames().filter((frame) => frame.type === type);
  }
}

/** A contract `DriverAvailability` with sensible defaults. */
export function availabilityFixture(
  overrides: Partial<DriverAvailability> = {},
): DriverAvailability {
  return {
    online: false,
    onlineSince: null,
    canGoOnline: true,
    cannotGoOnlineReason: null,
    suspensionReason: null,
    offersBlockedReason: null,
    streamHealthy: null,
    streamIntervalSeconds: 5,
    staleAfterSeconds: 30,
    ...overrides,
  };
}

/** An unsigned JWT-shaped token whose payload carries `exp` (seconds). */
export function jwtExpiringAt(expMs: number): string {
  const encode = (value: unknown) =>
    globalThis
      .btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode({ sub: 'user-1', exp: Math.floor(expMs / 1000) })}.sig`;
}

/**
 * M6-T4 — the location streaming protocol (realtime-v1.yaml, TRK-01/04)
 * against a scripted WebSocket: first-frame auth, samples at the interval,
 * re-auth on token rotation (incl. proactive refresh before `exp`), 4401 →
 * refresh → reconnect, backoff reconnect + REST batch flush, ping
 * keep-alive, unknown frames ignored, and a clean stop when going offline.
 */
import { ApiError } from "../api/client";
import type { LocationSample } from "../api/realtime-types";
import type { LocationSource } from "../realtime/location-source";
import {
  LocationStreamer,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
} from "../realtime/location-streamer";
import type { StreamerDeps, StreamStatus } from "../realtime/location-streamer";
import {
  accessTokenExpiryMs,
  backoffDelayMs,
  parseServerFrame,
  realtimeUrl,
  sampleFromFix,
} from "../realtime/protocol";
import type { GpsFix } from "../realtime/protocol";
import { jwtExpiringAt, MockSocket } from "../test-utils/realtime";

const URL = "ws://api.test/api/v1/realtime";

interface Harness {
  streamer: LocationStreamer;
  deps: StreamerDeps;
  emitFix: (lat?: number, lng?: number) => void;
  stopSource: jest.Mock;
  setToken: (token: string | null) => void;
  refreshSession: jest.Mock;
  postSamples: jest.Mock;
  statuses: StreamStatus[];
  rejected: string[];
}

function setup(overrides: Partial<StreamerDeps> = {}): Harness {
  let token: string | null = "access-1";
  const sessionListeners = new Set<() => void>();
  let onFix: ((fix: GpsFix) => void) | null = null;
  const stopSource = jest.fn();
  const source: LocationSource = {
    start: jest.fn(async (listener) => {
      onFix = listener;
      return stopSource;
    }),
  };
  const statuses: StreamStatus[] = [];
  const rejected: string[] = [];
  const refreshSession = jest.fn(async () => {
    token = "access-2";
    sessionListeners.forEach((listener) => listener());
    return token;
  });
  const postSamples = jest.fn(async () => {});
  const deps: StreamerDeps = {
    url: URL,
    createSocket: (url) => new MockSocket(url),
    source,
    intervalSeconds: 5,
    staleAfterSeconds: 30,
    getAccessToken: () => token,
    subscribeSession: (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    refreshSession,
    postSamples,
    onStatus: (status) => statuses.push(status),
    onRejected: (code) => rejected.push(code),
    random: () => 0.5, // no jitter: backoff = 1 s, 2 s, 4 s …
    ...overrides,
  };
  const streamer = new LocationStreamer(deps);
  return {
    streamer,
    deps,
    emitFix: (lat = 33.5138, lng = 36.2765) => {
      onFix?.({
        coords: {
          latitude: lat,
          longitude: lng,
          heading: 90,
          speed: 8,
          accuracy: 5,
        },
        timestamp: Date.now(),
      });
    },
    stopSource,
    setToken: (next) => {
      token = next;
      sessionListeners.forEach((listener) => listener());
    },
    refreshSession,
    postSamples,
    statuses,
    rejected,
  };
}

async function startLive(h: Harness): Promise<MockSocket> {
  await h.streamer.start();
  const socket = MockSocket.latest();
  socket.open();
  socket.ready();
  return socket;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-06T10:00:00Z"));
  MockSocket.reset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("realtime protocol helpers", () => {
  it("derives ws/wss from the API base URL, never with a token", () => {
    expect(realtimeUrl("http://10.0.2.2:8080")).toBe(
      "ws://10.0.2.2:8080/api/v1/realtime",
    );
    expect(realtimeUrl("https://api.labby.example/")).toBe(
      "wss://api.labby.example/api/v1/realtime",
    );
  });

  it('parses server frames and maps unknown types to "unknown"', () => {
    expect(
      parseServerFrame('{"type":"ready","streamIntervalSeconds":5}'),
    ).toMatchObject({
      type: "ready",
      streamIntervalSeconds: 5,
    });
    expect(parseServerFrame('{"type":"ride.offered","rideId":"r"}')).toEqual({
      type: "unknown",
      rawType: "ride.offered",
    });
    expect(parseServerFrame("not json")).toBeNull();
    expect(parseServerFrame("[1]")).toEqual({ type: "unknown", rawType: null });
  });

  it("backs off exponentially up to 30 s with bounded jitter", () => {
    const exact = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => backoffDelayMs(n, exact))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(backoffDelayMs(1, () => 0)).toBe(800);
    expect(backoffDelayMs(1, () => 1)).toBe(1200);
  });

  it('sanitizes platform "unknown" values (-1) and normalizes heading', () => {
    const sample = sampleFromFix({
      coords: {
        latitude: 33.5,
        longitude: 36.3,
        heading: -1,
        speed: -1,
        accuracy: null,
      },
      timestamp: Date.UTC(2026, 9, 6, 10, 0, 0),
    });
    expect(sample).toEqual({
      lat: 33.5,
      lng: 36.3,
      headingDeg: null,
      speedMps: null,
      accuracyM: null,
      recordedAt: "2026-10-06T10:00:00.000Z",
    });
    expect(
      sampleFromFix({
        coords: { latitude: 1, longitude: 2, heading: 360 },
        timestamp: 0,
      }).headingDeg,
    ).toBe(0);
  });

  it("reads the access token expiry from a JWT and ignores opaque tokens", () => {
    const exp = Date.UTC(2026, 9, 6, 10, 15, 0);
    expect(accessTokenExpiryMs(jwtExpiringAt(exp))).toBe(exp);
    expect(accessTokenExpiryMs("access-1")).toBeNull();
  });
});

describe("LocationStreamer", () => {
  it("sends auth as the FIRST frame and no samples before ready", async () => {
    const h = setup();
    await h.streamer.start();
    const socket = MockSocket.latest();
    expect(socket.url).toBe(URL);
    expect(h.statuses).toEqual(["connecting"]);

    h.emitFix();
    socket.open();
    await jest.advanceTimersByTimeAsync(5000);

    expect(socket.frames()).toEqual([{ type: "auth", token: "access-1" }]);
  });

  it("streams the latest fix every streamIntervalSeconds once ready", async () => {
    const h = setup();
    await h.streamer.start();
    h.emitFix(33.5, 36.3);
    const socket = MockSocket.latest();
    socket.open();
    socket.ready();
    expect(h.statuses).toEqual(["connecting", "live"]);

    // Immediately on ready, then once per interval.
    expect(socket.framesOfType("location")).toHaveLength(1);
    expect(socket.framesOfType("location")[0]).toEqual({
      type: "location",
      lat: 33.5,
      lng: 36.3,
      headingDeg: 90,
      speedMps: 8,
      accuracyM: 5,
      recordedAt: "2026-10-06T10:00:00.000Z",
    });

    await jest.advanceTimersByTimeAsync(4000);
    h.emitFix(33.51, 36.31);
    await jest.advanceTimersByTimeAsync(1000);
    expect(socket.framesOfType("location")).toHaveLength(2);
    expect(socket.framesOfType("location")[1]).toMatchObject({
      lat: 33.51,
      lng: 36.31,
    });

    await jest.advanceTimersByTimeAsync(10000);
    expect(socket.framesOfType("location")).toHaveLength(4);
  });

  it("honors the interval from the ready frame", async () => {
    const h = setup();
    await h.streamer.start();
    h.emitFix();
    const socket = MockSocket.latest();
    socket.open();
    socket.ready({ streamIntervalSeconds: 2 });
    await jest.advanceTimersByTimeAsync(6000);
    expect(socket.framesOfType("location")).toHaveLength(4); // t=0,2,4,6
  });

  it("stops resending a fix older than staleAfterSeconds (TRK-04 stays truthful)", async () => {
    const h = setup();
    const socket = await startLive(h);
    h.emitFix();
    await jest.advanceTimersByTimeAsync(30000);
    const sentWhileFresh = socket.framesOfType("location").length;
    await jest.advanceTimersByTimeAsync(20000);
    expect(socket.framesOfType("location")).toHaveLength(sentWhileFresh);
  });

  it("re-authenticates on the open socket when the session token rotates", async () => {
    const h = setup();
    const socket = await startLive(h);
    h.setToken("access-rotated");
    expect(socket.framesOfType("auth")).toEqual([
      { type: "auth", token: "access-1" },
      { type: "auth", token: "access-rotated" },
    ]);
    // Same token again: no duplicate auth.
    h.setToken("access-rotated");
    expect(socket.framesOfType("auth")).toHaveLength(2);
  });

  it("refreshes the token ~60 s before exp and re-auths with the new one", async () => {
    const h = setup();
    h.setToken(jwtExpiringAt(Date.now() + 5 * 60 * 1000));
    const socket = await startLive(h);
    socket.autoPong = true;

    await jest.advanceTimersByTimeAsync(3 * 60 * 1000);
    expect(h.refreshSession).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60 * 1000 + 1);
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
    expect(socket.framesOfType("auth").at(-1)).toEqual({
      type: "auth",
      token: "access-2",
    });
  });

  it("on close 4401 refreshes the session, then reconnects with the new token", async () => {
    const h = setup();
    const first = await startLive(h);
    first.serverClose(4401);
    await jest.advanceTimersByTimeAsync(0);

    expect(h.refreshSession).toHaveBeenCalledTimes(1);
    expect(MockSocket.instances).toHaveLength(2);
    const second = MockSocket.latest();
    second.open();
    expect(second.frames()[0]).toEqual({ type: "auth", token: "access-2" });
  });

  it("stops when the refresh says the session is dead (signed out)", async () => {
    const h = setup({ refreshSession: jest.fn(async () => null) });
    const first = await startLive(h);
    first.serverClose(4401);
    await jest.advanceTimersByTimeAsync(60000);
    expect(MockSocket.instances).toHaveLength(1);
    expect(h.streamer.getStatus()).toBe("idle");
    expect(h.stopSource).toHaveBeenCalled();
  });

  it("reconnects with backoff, buffers samples meanwhile and flushes them over REST", async () => {
    const h = setup();
    const first = await startLive(h);
    h.emitFix(33.5, 36.3);
    first.serverClose(1001);
    expect(h.statuses.at(-1)).toBe("reconnecting");

    // Backoff 1 s: still disconnected at 900 ms.
    await jest.advanceTimersByTimeAsync(900);
    expect(MockSocket.instances).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(100);
    expect(MockSocket.instances).toHaveLength(2);

    // The new socket never opens: next backoff 2 s, ticks buffer samples.
    MockSocket.latest().serverClose(1006);
    await jest.advanceTimersByTimeAsync(4000);
    h.emitFix(33.6, 36.4);
    await jest.advanceTimersByTimeAsync(5000);
    const third = MockSocket.latest();
    expect(MockSocket.instances).toHaveLength(3);
    expect(h.streamer.pendingSamples().length).toBeGreaterThanOrEqual(2);

    third.open();
    third.ready();
    await jest.advanceTimersByTimeAsync(0);

    expect(h.postSamples).toHaveBeenCalledTimes(1);
    const batch = h.postSamples.mock.calls[0][0] as LocationSample[];
    expect(batch.length).toBeGreaterThanOrEqual(2);
    expect(batch.length).toBeLessThanOrEqual(20);
    expect(batch.at(-1)).toMatchObject({ lat: 33.6, lng: 36.4 });
    // Buffered samples go over REST, not the socket.
    expect(third.framesOfType("location")).toHaveLength(0);
    expect(h.streamer.pendingSamples()).toHaveLength(0);
    expect(h.statuses.at(-1)).toBe("live");
  });

  it("keeps buffered samples when the REST flush fails on the network; reports a 409", async () => {
    const networkDown = setup({
      postSamples: jest.fn(async () => {
        throw new TypeError("Network request failed");
      }),
    });
    const socket = await startLive(networkDown);
    networkDown.emitFix();
    socket.serverClose(1001);
    await jest.advanceTimersByTimeAsync(5000);
    const reconnected = MockSocket.latest();
    reconnected.open();
    reconnected.ready();
    await jest.advanceTimersByTimeAsync(0);
    expect(networkDown.streamer.pendingSamples().length).toBeGreaterThan(0);
    networkDown.streamer.stop();

    MockSocket.reset();
    const offline = setup({
      postSamples: jest.fn(async () => {
        throw new ApiError(409, { status: 409 });
      }),
    });
    const socket2 = await startLive(offline);
    offline.emitFix();
    socket2.serverClose(1001);
    await jest.advanceTimersByTimeAsync(5000);
    MockSocket.latest().open();
    MockSocket.latest().ready();
    await jest.advanceTimersByTimeAsync(0);
    expect(offline.rejected).toEqual(["not_online"]);
  });

  it("pings every 25 s and replaces a socket that stops answering", async () => {
    const h = setup();
    const socket = await startLive(h);
    await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(socket.framesOfType("ping")).toHaveLength(1);

    socket.receive({ type: "pong" });
    await jest.advanceTimersByTimeAsync(PONG_TIMEOUT_MS);
    expect(MockSocket.instances).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS - PONG_TIMEOUT_MS);
    expect(socket.framesOfType("ping")).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(PONG_TIMEOUT_MS);
    expect(socket.closedWith).toBe(1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(MockSocket.instances).toHaveLength(2);
  });

  it("ignores unknown frame types and reports not_online / not_driver errors", async () => {
    const h = setup();
    const socket = await startLive(h);
    socket.receive({ type: "offer.created", rideId: "r-1" });
    socket.receive("garbage");
    socket.receive({ type: "error", code: "invalid_sample", message: "bad" });
    expect(h.rejected).toEqual([]);
    expect(h.streamer.getStatus()).toBe("live");

    socket.receive({ type: "error", code: "not_online", message: "offline" });
    socket.receive({ type: "error", code: "not_driver", message: "nope" });
    expect(h.rejected).toEqual(["not_online", "not_driver"]);
    expect(socket.closedWith).toBeNull();
  });

  it("going offline stops GPS, timers and the socket for good", async () => {
    const h = setup();
    const socket = await startLive(h);
    h.emitFix();
    h.streamer.stop();

    expect(socket.closedWith).toBe(1000);
    expect(h.stopSource).toHaveBeenCalledTimes(1);
    expect(h.streamer.getStatus()).toBe("idle");
    const sent = socket.sent.length;
    await jest.advanceTimersByTimeAsync(120000);
    expect(socket.sent).toHaveLength(sent);
    expect(MockSocket.instances).toHaveLength(1);
  });

  it("stops by itself when the session disappears (sign-out)", async () => {
    const h = setup();
    const socket = await startLive(h);
    h.setToken(null);
    expect(socket.closedWith).toBe(1000);
    expect(h.streamer.getStatus()).toBe("idle");
  });
});

/**
 * The rider realtime client against realtime-v1.yaml + rides-v1.yaml:
 * auth as the first frame, `ready` ⇒ resync (every reconnect), ride frames
 * for the rider only (`as`), unknown types ignored, 4401 ⇒ refresh then
 * reconnect, other closes ⇒ backoff, ping keep-alive, re-auth on rotation.
 */
import { FakeSocket, ride } from "../../test-utils/ride-fixtures";
import { parseServerFrame, realtimeUrl } from "../protocol";
import {
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  RiderSocket,
  type RiderSocketDeps,
} from "../rider-socket";

function setup(overrides: Partial<RiderSocketDeps> = {}) {
  let token: string | null = "token-1";
  const tokenListeners = new Set<() => void>();
  const onReady = jest.fn();
  const onEvent = jest.fn();
  const refreshSession = jest.fn(async () => {
    token = "token-2";
    tokenListeners.forEach((listener) => listener());
    return token;
  });
  const client = new RiderSocket({
    url: "ws://api.test/api/v1/realtime",
    createSocket: (url) => new FakeSocket(url),
    getAccessToken: async () => token,
    subscribeTokens: (listener) => {
      tokenListeners.add(listener);
      return () => tokenListeners.delete(listener);
    },
    refreshSession,
    onReady,
    onEvent,
    random: () => 0.5,
    ...overrides,
  });
  return {
    client,
    onReady,
    onEvent,
    refreshSession,
    setToken: (next: string | null) => {
      token = next;
      tokenListeners.forEach((listener) => listener());
    },
  };
}

async function flush() {
  await jest.advanceTimersByTimeAsync(0);
}

describe("realtime protocol", () => {
  it("derives the socket URL without a token", () => {
    expect(realtimeUrl("https://api.labby.example/")).toBe(
      "wss://api.labby.example/api/v1/realtime",
    );
    expect(realtimeUrl("http://localhost:8080")).toBe(
      "ws://localhost:8080/api/v1/realtime",
    );
  });

  it("keeps rider frames and ignores driver-addressed and unknown frames", () => {
    expect(
      parseServerFrame(
        JSON.stringify({ type: "ride.state", as: "rider", ride: ride() }),
      ),
    ).toEqual({ type: "ride", event: { type: "ride.state", ride: ride() } });
    expect(
      parseServerFrame(
        JSON.stringify({ type: "ride.state", as: "driver", ride: ride() }),
      ),
    ).toEqual({ type: "ignored" });
    expect(
      parseServerFrame(
        JSON.stringify({ type: "offer.new", as: "driver", offer: {} }),
      ),
    ).toEqual({ type: "ignored" });
    expect(
      parseServerFrame(JSON.stringify({ type: "something.new", as: "rider" })),
    ).toEqual({ type: "ignored" });
    expect(parseServerFrame("not json")).toBeNull();
  });
});

describe("chat frames (comms-v1.yaml)", () => {
  it("parses chat.message / chat.read without an `as` and rejects malformed ones", () => {
    expect(
      parseServerFrame(
        JSON.stringify({
          type: "chat.message",
          rideId: "r-1",
          messageId: "m-1",
          clientMsgId: "c-1",
          senderRole: "rider",
          kind: "quick_reply",
          quickReplyCode: "rider_coming",
          sentAt: "2026-10-13T09:30:00Z",
        }),
      ),
    ).toEqual({
      type: "chat",
      event: {
        type: "chat.message",
        rideId: "r-1",
        messageId: "m-1",
        clientMsgId: "c-1",
        senderRole: "rider",
        kind: "quick_reply",
        body: null,
        quickReplyCode: "rider_coming",
        sentAt: "2026-10-13T09:30:00Z",
      },
    });
    expect(
      parseServerFrame(
        JSON.stringify({
          type: "chat.read",
          rideId: "r-1",
          readerRole: "driver",
          lastReadMessageId: "m-1",
        }),
      ),
    ).toEqual({
      type: "chat",
      event: {
        type: "chat.read",
        rideId: "r-1",
        readerRole: "driver",
        lastReadMessageId: "m-1",
      },
    });
    expect(
      parseServerFrame(JSON.stringify({ type: "chat.message", rideId: "r-1" })),
    ).toEqual({ type: "ignored" });
    expect(parseServerFrame(JSON.stringify({ type: "chat.future" }))).toEqual({
      type: "ignored",
    });
  });

  it("relays chat + error frames and sends chat frames only once authenticated", async () => {
    jest.useFakeTimers();
    FakeSocket.reset();
    const onChatEvent = jest.fn();
    const onError = jest.fn();
    const { client } = setup({ onChatEvent, onError });
    const frame = {
      type: "chat.send" as const,
      rideId: "r-1",
      clientMsgId: "c-1",
      kind: "text" as const,
      body: "hi",
    };
    client.start();
    await flush();
    const socket = FakeSocket.latest();
    socket.open();
    await flush();
    // Open but not yet `ready`: refused, the caller resends after ready.
    expect(client.sendChatFrame(frame)).toBe(false);
    socket.receive({ type: "ready" });
    expect(client.sendChatFrame(frame)).toBe(true);
    expect(socket.sent.at(-1)).toEqual(frame);
    socket.receive({
      type: "chat.read",
      rideId: "r-1",
      readerRole: "driver",
      lastReadMessageId: "m-1",
    });
    expect(onChatEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chat.read", lastReadMessageId: "m-1" }),
    );
    socket.receive({ type: "error", code: "chat_closed", message: "closed" });
    expect(onError).toHaveBeenCalledWith("chat_closed");
    client.stop();
    jest.useRealTimers();
  });
});

describe("RiderSocket", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeSocket.reset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("sends the auth frame first and resyncs on ready", async () => {
    const { client, onReady } = setup();
    client.start();
    await flush();
    const socket = FakeSocket.latest();
    expect(socket.url).toBe("ws://api.test/api/v1/realtime");
    socket.open();
    await flush();
    expect(socket.sent[0]).toEqual({ type: "auth", token: "token-1" });
    expect(onReady).not.toHaveBeenCalled();
    socket.receive({ type: "ready", userId: "u-1" });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(client.getStatus()).toBe("live");
    client.stop();
  });

  it("delivers only frames addressed to the rider", async () => {
    const { client, onEvent } = setup();
    client.start();
    await flush();
    const socket = FakeSocket.latest();
    socket.open();
    await flush();
    socket.receive({ type: "ready" });
    socket.receive({ type: "ride.state", as: "driver", ride: ride() });
    socket.receive({ type: "offer.new", as: "driver", offer: {} });
    socket.receive({ type: "future.thing" });
    expect(onEvent).not.toHaveBeenCalled();
    socket.receive({
      type: "ride.driver_position",
      as: "rider",
      rideId: "r-1",
      lat: 33.5,
      lng: 36.3,
      recordedAt: "2026-10-08T09:30:00Z",
      etaSeconds: 120,
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ride.driver_position",
        rideId: "r-1",
        etaSeconds: 120,
      }),
    );
    client.stop();
  });

  it("reconnects with backoff after a server close and resyncs again", async () => {
    const { client, onReady } = setup();
    client.start();
    await flush();
    const first = FakeSocket.latest();
    first.open();
    await flush();
    first.receive({ type: "ready" });
    expect(onReady).toHaveBeenCalledTimes(1);

    first.serverClose(1001);
    expect(client.getStatus()).toBe("reconnecting");
    expect(FakeSocket.instances).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1000); // attempt 1: 1 s × jitter 1.0
    expect(FakeSocket.instances).toHaveLength(2);

    const second = FakeSocket.latest();
    second.open();
    await flush();
    expect(second.sent[0]).toEqual({ type: "auth", token: "token-1" });
    second.receive({ type: "ready" });
    expect(onReady).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it("refreshes the session on 4401 and reconnects with the new token", async () => {
    const { client, refreshSession } = setup();
    client.start();
    await flush();
    const first = FakeSocket.latest();
    first.open();
    await flush();
    first.serverClose(4401);
    await flush();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    const second = FakeSocket.latest();
    expect(second).not.toBe(first);
    second.open();
    await flush();
    expect(second.sent[0]).toEqual({ type: "auth", token: "token-2" });
    client.stop();
  });

  it("stops when the session is dead (no tokens after the refresh)", async () => {
    const { client, setToken } = setup({
      refreshSession: async () => null,
    });
    client.start();
    await flush();
    FakeSocket.latest().open();
    await flush();
    setToken(null);
    await flush();
    expect(client.getStatus()).toBe("idle");
  });

  it("re-authenticates on the open socket when the token rotates", async () => {
    const { client, setToken } = setup();
    client.start();
    await flush();
    const socket = FakeSocket.latest();
    socket.open();
    await flush();
    socket.receive({ type: "ready" });
    setToken("token-9");
    await flush();
    expect(socket.sent).toContainEqual({ type: "auth", token: "token-9" });
    client.stop();
  });

  it("pings to stay alive and replaces a socket that stops answering", async () => {
    const { client } = setup();
    client.start();
    await flush();
    const socket = FakeSocket.latest();
    socket.open();
    await flush();
    socket.receive({ type: "ready" });

    await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(socket.sent).toContainEqual({ type: "ping" });
    socket.receive({ type: "pong" });
    await jest.advanceTimersByTimeAsync(PONG_TIMEOUT_MS);
    expect(socket.closedWith).toBeNull();

    await jest.advanceTimersByTimeAsync(PING_INTERVAL_MS + PONG_TIMEOUT_MS);
    expect(socket.closedWith).toBe(1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
    client.stop();
  });
});

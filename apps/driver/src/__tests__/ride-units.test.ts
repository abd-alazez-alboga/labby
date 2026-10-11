/**
 * M7-T4 — the pure pieces of the ride slice: the frame parser (`as`
 * filter, malformed payloads), the offer deadline on the device clock, the
 * display formatters, and the location streamer handing ride frames and
 * (re)connects on (one socket, no second connection).
 */
import { parseDriverRideFrame } from "../realtime/ride-frames";
import { LocationStreamer } from "../realtime/location-streamer";
import type { LocationSource } from "../realtime/location-source";
import { offerDeadline, OFFER_WINDOW_MS } from "../rides/DriverRideProvider";
import { distanceMeters, formatClock } from "../rides/format";
import { MockSocket } from "../test-utils/realtime";
import {
  offerFixture,
  offerNewFrame,
  offerWithdrawnFrame,
  rideFixture,
  rideFrame,
} from "../test-utils/rides";

describe("parseDriverRideFrame", () => {
  it("accepts every driver frame of the catalog", () => {
    expect(parseDriverRideFrame(offerNewFrame(offerFixture()))?.type).toBe(
      "offer.new",
    );
    expect(parseDriverRideFrame(offerWithdrawnFrame("ride_ended"))).toEqual(
      expect.objectContaining({ type: "offer.withdrawn", reason: "ride_ended" }),
    );
    expect(
      parseDriverRideFrame(rideFrame("ride.state", rideFixture()))?.type,
    ).toBe("ride.state");
    expect(
      parseDriverRideFrame(
        rideFrame("ride.updated", rideFixture(), { reason: "route_changed" }),
      ),
    ).toEqual(expect.objectContaining({ reason: "route_changed" }));
    expect(
      parseDriverRideFrame({
        type: "ride.connection",
        as: "driver",
        rideId: "r",
        driverStream: "lost",
      }),
    ).toEqual({ type: "ride.connection", rideId: "r", driverStream: "lost" });
  });

  it("drops rider frames, frames without `as`, unknown types and malformed payloads", () => {
    expect(parseDriverRideFrame(offerNewFrame(offerFixture(), "rider"))).toBeNull();
    expect(
      parseDriverRideFrame(rideFrame("ride.state", rideFixture(), {}, "rider")),
    ).toBeNull();
    expect(parseDriverRideFrame({ type: "offer.new", offer: offerFixture() })).toBeNull();
    expect(
      parseDriverRideFrame({ type: "ride.driver_position", as: "driver" }),
    ).toBeNull();
    expect(parseDriverRideFrame({ type: "offer.new", as: "driver", offer: {} })).toBeNull();
    expect(parseDriverRideFrame({ type: "ride.state", as: "driver", ride: null })).toBeNull();
    expect(
      parseDriverRideFrame({
        type: "ride.connection",
        as: "driver",
        rideId: "r",
        driverStream: "weird",
      }),
    ).toBeNull();
  });
});

describe("offerDeadline", () => {
  const now = Date.parse("2026-10-08T10:00:00Z");

  it("uses expiresAt when the device clock agrees with the server's", () => {
    const offer = offerFixture({
      offeredAt: "2026-10-08T09:59:55Z",
      expiresAt: "2026-10-08T10:00:10Z",
    });
    expect(offerDeadline(offer, now)).toEqual({
      deadline: Date.parse("2026-10-08T10:00:10Z"),
      windowMs: 15000,
    });
  });

  it("falls back to a full window from now when the clocks disagree", () => {
    const past = offerFixture({
      offeredAt: "2026-10-08T09:58:00Z",
      expiresAt: "2026-10-08T09:58:15Z",
    });
    expect(offerDeadline(past, now)).toEqual({
      deadline: now + 15000,
      windowMs: 15000,
    });
    const noOfferedAt = offerFixture({
      offeredAt: undefined,
      expiresAt: "2026-10-08T11:00:00Z",
    });
    expect(offerDeadline(noOfferedAt, now)).toEqual({
      deadline: now + OFFER_WINDOW_MS,
      windowMs: OFFER_WINDOW_MS,
    });
  });
});

describe("format helpers", () => {
  it("formats timers and great-circle distances", () => {
    expect(formatClock(72000, "en")).toBe("1:12");
    expect(formatClock(3725000, "en")).toBe("1:02:05");
    expect(formatClock(-5000, "en")).toBe("0:00");
    const meters = distanceMeters(
      { lat: 33.5, lng: 36.28 },
      { lat: 33.5, lng: 36.29 },
    );
    expect(meters).toBeGreaterThan(900);
    expect(meters).toBeLessThan(950);
  });
});

describe("LocationStreamer ride hand-off", () => {
  const source: LocationSource = {
    start: async () => () => {},
  };

  it("hands non-protocol frames to onEvent and every socket's first ready to onConnected", async () => {
    MockSocket.reset();
    const onEvent = jest.fn();
    const onConnected = jest.fn();
    const streamer = new LocationStreamer({
      url: "ws://test/api/v1/realtime",
      createSocket: (url) => new MockSocket(url),
      source,
      intervalSeconds: 5,
      staleAfterSeconds: 30,
      getAccessToken: () => "access-1",
      subscribeSession: () => () => {},
      refreshSession: async () => "access-2",
      postSamples: async () => {},
      onEvent,
      onConnected,
      random: () => 0.5,
    });
    await streamer.start();
    const socket = MockSocket.latest();
    socket.open();
    socket.ready();
    expect(onConnected).toHaveBeenCalledTimes(1);

    // A re-auth `ready` on the same socket is not a reconnect.
    socket.ready();
    expect(onConnected).toHaveBeenCalledTimes(1);

    const frame = offerNewFrame(offerFixture());
    socket.receive(frame);
    socket.receive({ type: "pong" });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toEqual(JSON.parse(JSON.stringify(frame)));
    // Only the one socket exists.
    expect(MockSocket.instances).toHaveLength(1);
    streamer.stop();
  });
});

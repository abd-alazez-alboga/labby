/**
 * M7-T4 — UC-D-06 against rides-v1.yaml: an offer arriving on the socket
 * (offer.new) shows the offer card with its countdown; accept (→ to
 * pickup), decline, expiry, withdrawn (timeout / rider cancel, E1), accept
 * 409 `offer_closed`; frames addressed to the rider app are ignored; the
 * open offer and the active ride are resynced on every (re)connect.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
  goLive,
  mockLocationGranted,
  OPEN_OFFER,
  receive,
  renderDriverApp,
  screen,
  waitForResync,
} from "../test-utils/ride-harness";
import {
  OFFER_ID,
  offerFixture,
  offerNewFrame,
  offerWithdrawnFrame,
  RIDE_ID,
  rideFixture,
  rideFrame,
} from "../test-utils/rides";

const ACCEPT = `POST /api/v1/driver/offers/${OFFER_ID}/accept`;
const DECLINE = `POST /api/v1/driver/offers/${OFFER_ID}/decline`;
const originalWebSocket = globalThis.WebSocket;

describe("ride offers (UC-D-06)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
    mockLocationGranted();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("shows an offer from offer.new with the countdown, fare, pickup and destination — no rating", async () => {
    const contract = await renderDriverApp();
    const socket = await goLive();
    await waitForResync(contract);
    expect(await screen.findByTestId("availability-online")).toBeTruthy();

    receive(socket, offerNewFrame(offerFixture({}, 10000)));

    expect(await screen.findByTestId("offer-card")).toBeTruthy();
    expect(screen.getByTestId("offer-service")).toHaveTextContent(
      "Economy · Cash",
    );
    expect(screen.getByTestId("offer-fare")).toHaveTextContent("SYP 22,000");
    expect(screen.getByTestId("offer-pickup")).toHaveTextContent(
      "3 min · 1.1 km away",
      { exact: false },
    );
    expect(screen.getByTestId("offer-pickup")).toHaveTextContent(
      "Mazzeh Autostrad",
      { exact: false },
    );
    expect(screen.getByTestId("offer-destination")).toHaveTextContent(
      "Umayyad Square",
      { exact: false },
    );
    // Countdown from expiresAt (≈10 s left of 15).
    const ring = screen.getByTestId("offer-countdown");
    expect(Number(ring.props.accessibilityLabel.match(/\d+/)[0])).toBeLessThanOrEqual(10);
    expect(Number(ring.props.accessibilityLabel.match(/\d+/)[0])).toBeGreaterThanOrEqual(9);
    // A null rider rating (below 5 ratings, M11): nothing rendered.
    expect(screen.queryByText(/rating|★/i)).toBeNull();
    // I33: the rider's comfort preferences ride along on the offer.
    expect(screen.getByTestId("offer-comfort-temperature")).toHaveTextContent("Cool", { exact: false });
    expect(screen.getByTestId("offer-comfort-conversation")).toHaveTextContent("Quiet", {
      exact: false,
    });
  });

  it("accepts → the to-pickup screen with rider name and comfort chips", async () => {
    const contract = await renderDriverApp({
      [ACCEPT]: { status: 200, body: rideFixture() },
    });
    const socket = await goLive();
    await waitForResync(contract);
    receive(socket, offerNewFrame(offerFixture()));

    fireEvent.press(await screen.findByTestId("offer-accept"));

    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
    expect(contract.requestsTo(ACCEPT)).toHaveLength(1);
    expect(screen.queryByTestId("offer-card")).toBeNull();
    expect(screen.getByTestId("to-pickup-title")).toHaveTextContent(
      "Pick up Rana",
    );
    expect(screen.getByTestId("rider-comfort-temperature")).toHaveTextContent(
      "Cool",
      { exact: false },
    );
    expect(screen.getByTestId("rider-comfort-conversation")).toHaveTextContent(
      "Quiet",
      { exact: false },
    );
    expect(screen.getByTestId("rider-comfort-music")).toHaveTextContent(
      "No music pref.",
      { exact: false },
    );
    expect(screen.getByTestId("to-pickup-instruction-subtitle")).toHaveTextContent(
      "to pickup · Mazzeh Autostrad",
    );
    expect(screen.getByTestId("to-pickup-instruction-title")).toHaveTextContent(
      /3 min · \d/,
    );
  });

  it("declines → back to the online home", async () => {
    const contract = await renderDriverApp({ [DECLINE]: { status: 204 } });
    const socket = await goLive();
    await waitForResync(contract);
    receive(socket, offerNewFrame(offerFixture()));

    fireEvent.press(await screen.findByTestId("offer-decline"));

    expect(await screen.findByTestId("availability-online")).toBeTruthy();
    expect(contract.requestsTo(DECLINE)).toHaveLength(1);
    expect(screen.queryByTestId("offer-card")).toBeNull();
    expect(screen.queryByTestId(/^ride-notice-/)).toBeNull();
  });

  it("dismisses the offer when the countdown runs out, with a notice", async () => {
    const contract = await renderDriverApp();
    const socket = await goLive();
    await waitForResync(contract);
    const t0 = Date.now();
    receive(socket, offerNewFrame(offerFixture({}, 1200)));
    expect(await screen.findByTestId("offer-card")).toBeTruthy();

    expect(
      await screen.findByTestId("ride-notice-offerExpired", undefined, {
        timeout: 4000,
      }),
    ).toBeTruthy();
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "Offer expired.",
    );
    expect(screen.queryByTestId("offer-card")).toBeNull();
    // Dismissed by the countdown, not before it.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
  });

  it("offer.withdrawn: timeout → 'Offer expired', ride_ended → 'cancelled by the rider' (E1)", async () => {
    const contract = await renderDriverApp();
    const socket = await goLive();
    await waitForResync(contract);

    receive(socket, offerNewFrame(offerFixture()));
    expect(await screen.findByTestId("offer-card")).toBeTruthy();
    receive(socket, offerWithdrawnFrame("timeout"));
    expect(await screen.findByTestId("ride-notice-offerExpired")).toBeTruthy();

    receive(socket, offerNewFrame(offerFixture()));
    expect(await screen.findByTestId("offer-card")).toBeTruthy();
    receive(socket, offerWithdrawnFrame("ride_ended"));
    expect(await screen.findByTestId("ride-notice-offerCancelled")).toBeTruthy();
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "Ride was cancelled by the rider.",
    );
    expect(screen.queryByTestId("offer-card")).toBeNull();

    fireEvent.press(screen.getByTestId("ride-notice-dismiss"));
    expect(screen.queryByTestId("ride-notice-offerCancelled")).toBeNull();
  });

  it("accept answered 409 offer_closed → dismissed with a notice", async () => {
    const contract = await renderDriverApp({
      [ACCEPT]: {
        status: 409,
        body: { status: 409, message: "Offer closed", code: "offer_closed" },
      },
    });
    const socket = await goLive();
    await waitForResync(contract);
    receive(socket, offerNewFrame(offerFixture()));

    fireEvent.press(await screen.findByTestId("offer-accept"));

    expect(await screen.findByTestId("ride-notice-offerClosed")).toBeTruthy();
    expect(screen.queryByTestId("offer-card")).toBeNull();
    expect(screen.getByTestId("availability-online")).toBeTruthy();
  });

  it("keeps the offer and explains a network failure on accept", async () => {
    const contract = await renderDriverApp();
    const socket = await goLive();
    await waitForResync(contract);
    receive(socket, offerNewFrame(offerFixture()));

    // ACCEPT is outside the mocked contract → fetch rejects (network).
    fireEvent.press(await screen.findByTestId("offer-accept"));

    expect(await screen.findByTestId("offer-error")).toHaveTextContent(
      "No connection.",
      { exact: false },
    );
    expect(screen.getByTestId("offer-card")).toBeTruthy();
  });

  it("ignores frames addressed to the rider app (as: rider) and unknown types", async () => {
    const contract = await renderDriverApp();
    const socket = await goLive();
    await waitForResync(contract);

    receive(socket, offerNewFrame(offerFixture(), "rider"));
    receive(socket, rideFrame("ride.state", rideFixture(), {}, "rider"));
    receive(socket, { type: "ride.driver_position", as: "rider", rideId: RIDE_ID, lat: 1, lng: 2 });
    receive(socket, { type: "something.new", as: "driver" });
    receive(socket, { type: "offer.new", offer: offerFixture() }); // no `as`
    await act(async () => {});

    expect(screen.queryByTestId("offer-card")).toBeNull();
    expect(screen.queryByTestId("ride-screen")).toBeNull();
    expect(screen.getByTestId("availability-online")).toBeTruthy();
  });

  it("resyncs the open offer and the active ride on every (re)connect", async () => {
    const contract = await renderDriverApp({
      [OPEN_OFFER]: [
        { status: 204 }, // activation
        { status: 204 }, // first ready
        { status: 200, body: offerFixture() }, // after the reconnect
      ],
    });
    const socket = await goLive();
    await waitForResync(contract, 2);
    expect(screen.queryByTestId("offer-card")).toBeNull();

    // The socket drops (1001) and comes back: events are not replayed.
    act(() => socket.serverClose(1001));
    await waitFor(() => expect(MockSocket.instances).toHaveLength(2), {
      timeout: 4000,
    });
    const second = MockSocket.latest();
    act(() => second.open());
    act(() => second.ready());

    expect(await screen.findByTestId("offer-card")).toBeTruthy();
    expect(contract.requestsTo(OPEN_OFFER).length).toBeGreaterThanOrEqual(3);
    expect(contract.requestsTo(ACTIVE_RIDE).length).toBeGreaterThanOrEqual(3);
  });

  it("resync on connect restores an active ride (app reopened mid-ride)", async () => {
    const contract = await renderDriverApp({
      [ACTIVE_RIDE]: { status: 200, body: rideFixture() },
    });
    await goLive();
    await waitForResync(contract);
    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
  });
});

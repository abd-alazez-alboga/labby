/**
 * M7-T3 ride tracking (UC-R-05…07, UC-R-09) through the real facade + home
 * screen against contract-shaped mocks: GET /rides/active resync, rider
 * realtime frames on a fake socket, and every state's sheet — finding,
 * accepted, arrived (countdown), in progress, completed (stored fare),
 * no driver found + retry, driver cancel → automatic follow of the
 * re-dispatched ride, rider no-show fee, rider cancel free vs fee, the
 * connection-lost banner and reconnect resync.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  acceptedRide,
  components,
  FakeSocket,
  fakeSocketFactory,
  RIDE_ID,
  ride,
  sampleDriver,
} from "../../../test-utils/ride-fixtures";
import HomeScreen from "../../home-screen";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webviewMock = require("react-native-webview") as {
  __injectJavaScript: jest.Mock;
};
function lastMapScript(): string {
  return (webviewMock.__injectJavaScript.mock.calls.at(-1)?.[0] ?? "") as string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const ACTIVE = "GET /api/v1/rides/active";
const NEW_RIDE_ID = "77777777-7777-4777-8777-777777777777";

function renderHome() {
  return render(
    <LocaleProvider>
      <RideProvider socketFactory={fakeSocketFactory}>
        <HomeScreen />
      </RideProvider>
    </LocaleProvider>,
  );
}

async function connect(): Promise<FakeSocket> {
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeSocket.latest();
  await act(async () => socket.open());
  await waitFor(() =>
    expect(socket.sent[0]).toEqual({ type: "auth", token: "seed-access" }),
  );
  await act(async () => socket.receive({ type: "ready", userId: "u-1" }));
  return socket;
}

function send(socket: FakeSocket, frame: Record<string, unknown>) {
  return act(async () => socket.receive({ as: "rider", ...frame }));
}

describe("ride flow (UC-R-05…07)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    FakeSocket.reset();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it("follows a ride from finding to the receipt with the stored fare", async () => {
    const api = mockApi({ [ACTIVE]: { status: 200, body: ride() } });
    await renderHome();

    expect(await screen.findByText("Finding your driver")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-estimate")).toHaveTextContent(
      "SYP 22,000 est.",
    );
    expect(screen.getByText("Free to cancel now")).toBeOnTheScreen();
    expect(screen.getByTestId("route-column-pickup")).toHaveTextContent(
      "Mazzeh Autostrad",
    );

    const socket = await connect();
    // Every ready resyncs (mount + this connect).
    await waitFor(() => expect(api.callsTo("GET", "/api/v1/rides/active")).toHaveLength(2));

    await send(socket, { type: "ride.state", ride: ride({ state: "offering" }) });
    expect(screen.getByText("Finding your driver")).toBeOnTheScreen();

    // Accepted: driver, vehicle, plate, ETA — no M10 actions, no rating.
    await send(socket, { type: "ride.state", ride: acceptedRide() });
    expect(await screen.findByText("Meet at pickup")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-eta")).toHaveTextContent("4 min");
    expect(screen.getByTestId("driver-name")).toHaveTextContent("Samer");
    expect(screen.getByTestId("driver-vehicle")).toHaveTextContent(
      "Silver Hyundai Accent",
    );
    expect(screen.getByTestId("driver-plate")).toHaveTextContent("دمشق 502345");
    for (const hidden of ["Call", "Message", "Share trip", "Safety"]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    expect(screen.queryByText(/★/)).toBeNull();
    // The map page shows the driver once it is ready (state injection).
    await act(async () => {
      fireEvent(screen.getByTestId("ride-map-webview"), "message", {
        nativeEvent: { data: '{"type":"ready"}' },
      });
    });
    expect(lastMapScript()).toContain(
      '{"id":"driver","latlng":[33.52,36.27],"kind":"driver"}',
    );

    // Live position + refreshed ETA; a frame for the driver app is ignored.
    await send(socket, {
      type: "ride.driver_position",
      rideId: RIDE_ID,
      lat: 33.515,
      lng: 36.275,
      recordedAt: "2026-10-08T09:30:00Z",
      etaSeconds: 60,
    });
    expect(screen.getByTestId("ride-eta")).toHaveTextContent("1 min");
    expect(lastMapScript()).toContain(
      '{"id":"driver","latlng":[33.515,36.275],"kind":"driver"}',
    );
    await act(async () =>
      socket.receive({
        type: "ride.state",
        as: "driver",
        ride: acceptedRide({ state: "completed" }),
      }),
    );
    expect(screen.getByText("Meet at pickup")).toBeOnTheScreen();

    // Arrived: the free-waiting countdown from waitGraceEndsAt.
    await send(socket, {
      type: "ride.state",
      ride: acceptedRide({
        state: "driver_arrived",
        waitGraceEndsAt: new Date(Date.now() + 252_000).toISOString(),
      }),
    });
    expect(await screen.findByText("Your driver is here")).toBeOnTheScreen();
    expect(
      screen.getByText("Samer is waiting at Mazzeh Autostrad."),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("ride-wait-countdown").props.children).toMatch(
      /^4:1[0-2]$/,
    );

    // In progress: stops + destination, route changes, NO cancel (E1).
    await send(socket, {
      type: "ride.state",
      ride: acceptedRide({
        state: "in_progress",
        stops: [{ lat: 33.51, lng: 36.28, label: "Abu Rummaneh" }],
        etaSeconds: 720,
      }),
    });
    expect(await screen.findByText("On the way")).toBeOnTheScreen();
    expect(screen.getByTestId("route-column-stop-0")).toHaveTextContent(
      "Abu Rummaneh",
    );
    expect(screen.getByText("Economy · Cash · fare is metered")).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-cancel")).toBeNull();
    await fireEvent.press(screen.getByTestId("ride-change-destination"));
    expect(mockPush).toHaveBeenCalledWith("/change-route");
    await fireEvent.press(screen.getByTestId("ride-add-stop"));
    expect(mockPush).toHaveBeenCalledWith("/change-route?focus=stop");

    // Completed: ONLY the stored components and the stored total.
    await send(socket, {
      type: "ride.state",
      ride: acceptedRide({
        state: "completed",
        paymentStatus: "pending",
        timeline: {
          requestedAt: "2026-10-08T09:29:00Z",
          completedAt: "2026-10-08T09:43:00Z",
        },
        fare: {
          distanceMeters: 4200,
          durationSeconds: 840,
          components: components({
            surchargePercent: 25,
            surchargeAmount: 5450,
            total: 27250,
          }),
        },
      }),
    });
    expect(await screen.findByText("You've arrived")).toBeOnTheScreen();
    expect(screen.getByText("Pay your driver in cash")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-total")).toHaveTextContent("SYP 27,250");
    expect(screen.getByTestId("fare-breakdown-base")).toHaveTextContent(
      "Base fareSYP 5,000",
    );
    expect(screen.getByTestId("fare-breakdown-distance")).toHaveTextContent(
      "Distance · 4.2 kmSYP 12,600",
    );
    expect(screen.getByTestId("fare-breakdown-time")).toHaveTextContent(
      "Time · 14 minSYP 4,200",
    );
    expect(screen.getByTestId("fare-breakdown-surcharge")).toHaveTextContent(
      "Time surcharge +25%SYP 5,450",
    );
    expect(screen.getByTestId("fare-breakdown-total")).toHaveTextContent(
      "TotalSYP 27,250",
    );
    // Zero components are not listed; the estimate is not the fare.
    expect(screen.queryByTestId("fare-breakdown-surge")).toBeNull();
    expect(screen.queryByText(/22,000/)).toBeNull();

    await fireEvent.press(screen.getByTestId("ride-view-receipt"));
    expect(mockPush).toHaveBeenCalledWith(`/receipt/${RIDE_ID}`);
    await fireEvent.press(screen.getByTestId("ride-done"));
    expect(await screen.findByText("Where to?")).toBeOnTheScreen();
  });

  it("offers a one-tap retry and trip edit when no driver was found (E1)", async () => {
    const api = mockApi({
      [ACTIVE]: { status: 200, body: ride({ state: "offering" }) },
      [`POST /api/v1/rides/${RIDE_ID}/retry`]: [
        {
          status: 409,
          body: { status: 409, message: "Active", code: "active_ride_exists" },
        },
        {
          status: 201,
          body: ride({ id: NEW_RIDE_ID, retryOfRideId: RIDE_ID }),
        },
      ],
    });
    await renderHome();
    const socket = await connect();

    await send(socket, {
      type: "ride.state",
      ride: ride({ state: "no_driver_found" }),
    });
    expect(await screen.findByText("No driver available")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "All nearby drivers are busy right now. You were not charged.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("Accepting distant drivers can find a ride faster."),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("ride-edit-trip"));
    expect(mockPush).toHaveBeenCalledWith("/booking?edit=1");

    await fireEvent.press(screen.getByTestId("ride-retry"));
    expect(await screen.findByTestId("ride-retry-error")).toHaveTextContent(
      "You already have an active ride.",
    );
    await fireEvent.press(screen.getByTestId("ride-retry"));
    expect(await screen.findByText("Finding your driver")).toBeOnTheScreen();
    expect(
      api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/retry`),
    ).toHaveLength(2);
  });

  it("closes a no-driver ride back to Where to?", async () => {
    mockApi({ [ACTIVE]: { status: 200, body: ride({ state: "offering" }) } });
    await renderHome();
    const socket = await connect();
    await send(socket, {
      type: "ride.state",
      ride: ride({ state: "no_driver_found" }),
    });
    await fireEvent.press(await screen.findByTestId("ride-close"));
    expect(await screen.findByText("Where to?")).toBeOnTheScreen();
  });

  it("follows the re-dispatched ride after a driver cancels (E2)", async () => {
    const api = mockApi({
      [ACTIVE]: { status: 200, body: acceptedRide() },
      [`GET /api/v1/rides/${NEW_RIDE_ID}`]: {
        status: 200,
        body: ride({ id: NEW_RIDE_ID, redispatchOfRideId: RIDE_ID }),
      },
    });
    await renderHome();
    const socket = await connect();
    expect(await screen.findByText("Meet at pickup")).toBeOnTheScreen();

    await send(socket, {
      type: "ride.state",
      ride: acceptedRide({
        state: "cancelled_by_driver",
        cancellationReason: "vehicle_issue",
        redispatchedAsRideId: NEW_RIDE_ID,
      }),
    });
    expect(await screen.findByText("Finding you another driver")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Your driver cancelled. You won't be charged — we're asking other drivers now.",
      ),
    ).toBeOnTheScreen();
    await waitFor(() =>
      expect(api.callsTo("GET", `/api/v1/rides/${NEW_RIDE_ID}`)).toHaveLength(1),
    );

    // The new ride's own frames now drive the screen.
    await send(socket, {
      type: "ride.state",
      ride: acceptedRide({ id: NEW_RIDE_ID, redispatchOfRideId: RIDE_ID }),
    });
    expect(await screen.findByText("Meet at pickup")).toBeOnTheScreen();
  });

  it("finds the re-dispatched ride through the active ride when the frame has no link", async () => {
    mockApi({
      [ACTIVE]: [
        { status: 200, body: acceptedRide() },
        { status: 200, body: acceptedRide() },
        {
          status: 200,
          body: ride({ id: NEW_RIDE_ID, redispatchOfRideId: RIDE_ID }),
        },
      ],
    });
    await renderHome();
    const socket = await connect();
    expect(await screen.findByText("Meet at pickup")).toBeOnTheScreen();

    await send(socket, {
      type: "ride.state",
      ride: acceptedRide({
        state: "cancelled_by_driver",
        cancellationReason: "unsafe_pickup",
      }),
    });
    expect(await screen.findByText("Finding you another driver")).toBeOnTheScreen();
    // Its own frame for the new ride arrives too.
    await send(socket, {
      type: "ride.state",
      ride: ride({ id: NEW_RIDE_ID, state: "offering", redispatchOfRideId: RIDE_ID }),
    });
    expect(screen.getByText("Finding you another driver")).toBeOnTheScreen();
  });

  it("shows the recorded fee of a rider no-show (no re-dispatch)", async () => {
    const api = mockApi({ [ACTIVE]: { status: 200, body: acceptedRide({ state: "driver_arrived" }) } });
    await renderHome();
    const socket = await connect();
    await send(socket, {
      type: "ride.state",
      ride: acceptedRide({
        state: "cancelled_by_driver",
        cancellationReason: "rider_no_show",
        cancellationFee: 2000,
      }),
    });
    expect(await screen.findByText("Your driver cancelled")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-ended-fee")).toHaveTextContent(
      "A cancellation fee of SYP 2,000 was recorded.",
    );
    // Nothing to follow: only the mount + ready resyncs happened.
    expect(api.callsTo("GET", "/api/v1/rides/active")).toHaveLength(2);
  });

  it("cancels for free before acceptance (quote first, reason chosen)", async () => {
    const api = mockApi({
      [ACTIVE]: { status: 200, body: ride() },
      [`GET /api/v1/rides/${RIDE_ID}/cancellation-quote`]: {
        status: 200,
        body: { free: true, fee: null, currency: "SYP", graceEndsAt: null },
      },
      [`POST /api/v1/rides/${RIDE_ID}/cancel`]: {
        status: 200,
        body: ride({ state: "cancelled_by_rider", cancellationReason: "changed_mind" }),
      },
    });
    await renderHome();
    await fireEvent.press(await screen.findByTestId("ride-cancel"));

    expect(await screen.findByTestId("cancel-quote-free")).toHaveTextContent(
      "Free cancellationYou won't be charged.",
    );
    expect(screen.getByTestId("cancel-confirm")).toHaveTextContent("Cancel ride");
    await fireEvent.press(screen.getByTestId("cancel-confirm"));

    expect(await screen.findByText("Ride cancelled")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-ended-fee")).toHaveTextContent(
      "You were not charged.",
    );
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/cancel`)[0].body).toEqual({
      reason: "changed_mind",
    });
  });

  it("shows the fee from the quote after the grace window and needs a note for other", async () => {
    const api = mockApi({
      [ACTIVE]: { status: 200, body: acceptedRide() },
      [`GET /api/v1/rides/${RIDE_ID}/cancellation-quote`]: {
        status: 200,
        body: { free: false, fee: 2000, currency: "SYP", graceEndsAt: null },
      },
      [`POST /api/v1/rides/${RIDE_ID}/cancel`]: {
        status: 200,
        body: acceptedRide({
          state: "cancelled_by_rider",
          cancellationReason: "other",
          cancellationFee: 2000,
        }),
      },
    });
    await renderHome();
    await fireEvent.press(await screen.findByTestId("ride-cancel"));

    expect(await screen.findByTestId("cancel-quote-fee")).toHaveTextContent(
      /SYP 2,000 cancellation fee/,
    );
    expect(screen.getByTestId("cancel-confirm")).toHaveTextContent(
      "Cancel ride · SYP 2,000 fee",
    );
    await fireEvent.press(screen.getByTestId("cancel-reason-other"));
    await fireEvent.press(screen.getByTestId("cancel-confirm"));
    expect(await screen.findByTestId("cancel-note-error")).toHaveTextContent(
      "Please tell us the reason.",
    );
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/cancel`)).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId("cancel-note"), "Plans changed");
    await fireEvent.press(screen.getByTestId("cancel-confirm"));
    expect(await screen.findByText("Ride cancelled")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-ended-fee")).toHaveTextContent(
      "A cancellation fee of SYP 2,000 was recorded.",
    );
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/cancel`)[0].body).toEqual({
      reason: "other",
      note: "Plans changed",
    });
  });

  it("keeps the ride when the rider changes their mind in the cancel sheet", async () => {
    const api = mockApi({
      [ACTIVE]: { status: 200, body: acceptedRide() },
      [`GET /api/v1/rides/${RIDE_ID}/cancellation-quote`]: {
        status: 200,
        body: { free: true, graceEndsAt: "2026-10-08T09:31:20Z", currency: "SYP" },
      },
    });
    await renderHome();
    await fireEvent.press(await screen.findByTestId("ride-cancel"));
    await screen.findByTestId("cancel-quote-free");
    await fireEvent.press(screen.getByTestId("cancel-keep"));
    await waitFor(() => expect(screen.queryByTestId("cancel-sheet")).toBeNull());
    expect(screen.getByText("Meet at pickup")).toBeOnTheScreen();
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/cancel`)).toHaveLength(0);
  });

  it("shows the connection-lost banner while the driver's stream is lost (A1)", async () => {
    mockApi({ [ACTIVE]: { status: 200, body: acceptedRide({ state: "in_progress" }) } });
    await renderHome();
    const socket = await connect();
    expect(await screen.findByText("On the way")).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-connection-lost")).toBeNull();

    await send(socket, { type: "ride.connection", rideId: RIDE_ID, driverStream: "lost" });
    expect(screen.getByTestId("ride-connection-lost")).toHaveTextContent(
      "Connection to your driver lost — reconnecting",
    );
    // The driver app's copy of the frame does not clear it.
    await act(async () =>
      socket.receive({
        type: "ride.connection",
        as: "driver",
        rideId: RIDE_ID,
        driverStream: "ok",
      }),
    );
    expect(screen.getByTestId("ride-connection-lost")).toBeOnTheScreen();
    await send(socket, { type: "ride.connection", rideId: RIDE_ID, driverStream: "ok" });
    expect(screen.queryByTestId("ride-connection-lost")).toBeNull();
  });

  it("resyncs from GET /rides/active after a reconnect (events are not replayed)", async () => {
    const api = mockApi({
      [ACTIVE]: [
        { status: 200, body: acceptedRide() },
        { status: 200, body: acceptedRide() },
        { status: 200, body: acceptedRide({ state: "in_progress" }) },
      ],
    });
    await renderHome();
    const first = await connect();
    expect(await screen.findByText("Meet at pickup")).toBeOnTheScreen();

    await act(async () => first.serverClose(1001));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2), {
      timeout: 3000,
    });
    const second = FakeSocket.latest();
    await act(async () => second.open());
    await waitFor(() => expect(second.sent[0]).toEqual({ type: "auth", token: "seed-access" }));
    await act(async () => second.receive({ type: "ready" }));

    expect(await screen.findByText("On the way")).toBeOnTheScreen();
    expect(api.callsTo("GET", "/api/v1/rides/active")).toHaveLength(3);
  });

  it("learns how a ride ended while the app was not listening", async () => {
    mockApi({
      [ACTIVE]: [
        { status: 200, body: acceptedRide({ state: "in_progress" }) },
        { status: 204 },
      ],
      [`GET /api/v1/rides/${RIDE_ID}`]: {
        status: 200,
        body: acceptedRide({
          state: "completed",
          paymentStatus: "paid_cash",
          driver: sampleDriver,
          fare: {
            distanceMeters: 3000,
            durationSeconds: 600,
            components: components({ total: 21800 }),
          },
        }),
      },
    });
    await renderHome();
    expect(await screen.findByText("On the way")).toBeOnTheScreen();
    await connect();
    expect(await screen.findByText("You've arrived")).toBeOnTheScreen();
    expect(screen.getByText("Paid in cash")).toBeOnTheScreen();
  });
});

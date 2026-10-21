/**
 * M7-T4 — UC-D-07..10 against rides-v1.yaml: arrive (422 outside_geofence
 * distance hint, no_position, success → at pickup), the waiting timer and
 * the no-show path (disabled until waitGraceEndsAt, then cancel
 * rider_no_show), start → in ride, a rider route change, end ride → the
 * STORED fare breakdown, cash-confirm / mark-unpaid (+ 409
 * payment_not_pending), driver cancel with a mandatory reason (`other`
 * needs a note) → back to the online home, the rider cancelling, a lost
 * stream, and going offline refused (409) during a ride.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
  AVAILABILITY,
  emitPosition,
  goLive,
  mockLocationGranted,
  receive,
  renderDriverApp,
  screen,
  SET_AVAILABILITY,
  waitForResync,
} from "../test-utils/ride-harness";
import {
  arrivedRide,
  completedRide,
  inProgressRide,
  RIDE_ID,
  rideFixture,
  rideFrame,
} from "../test-utils/rides";
import type { MockResponse } from "../test-utils/contract";
import {
  EARNINGS,
  earningPage,
  tripEarningFixture,
} from "../test-utils/money";

const RIDE = `/api/v1/driver/rides/${RIDE_ID}`;
const ARRIVE = `POST ${RIDE}/arrive`;
const START = `POST ${RIDE}/start`;
const COMPLETE = `POST ${RIDE}/complete`;
const CASH = `POST ${RIDE}/cash-confirm`;
const UNPAID = `POST ${RIDE}/mark-unpaid`;
const CANCEL = `POST ${RIDE}/cancel`;
const originalWebSocket = globalThis.WebSocket;

const ok = (body: unknown): MockResponse => ({ status: 200, body });

/** Renders with the given active ride, goes live, waits for the ride screen. */
async function withActiveRide(
  ride: unknown,
  routes: Record<string, MockResponse | MockResponse[]> = {},
) {
  const contract = await renderDriverApp({
    [ACTIVE_RIDE]: ok(ride),
    ...routes,
  });
  const socket = await goLive();
  await waitForResync(contract);
  return { contract, socket };
}

describe("active ride (UC-D-07..10)", () => {
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

  it("arrive outside the geofence shows the 422 distance hint (E1)", async () => {
    const { contract } = await withActiveRide(rideFixture(), {
      [ARRIVE]: {
        status: 422,
        body: {
          status: 422,
          message: "Too far from the pickup",
          code: "outside_geofence",
          details: { distanceMeters: 350, geofenceMeters: 100 },
        },
      },
    });
    fireEvent.press(await screen.findByTestId("ride-arrived"));

    expect(await screen.findByTestId("geofence-hint-text")).toHaveTextContent(
      "You're 350 m away. Get within 100 m to mark arrived.",
    );
    expect(contract.requestsTo(ARRIVE)).toHaveLength(1);
    // The app just calls arrive — the server judges on its own latest position.
    expect(contract.requestsTo(ARRIVE)[0].body).toBeNull();
    expect(screen.getByTestId("to-pickup-sheet")).toBeTruthy();
  });

  it("a newer own fix inside the fence clears the stale geofence hint (L-I4)", async () => {
    await withActiveRide(rideFixture(), {
      [ARRIVE]: {
        status: 422,
        body: {
          status: 422,
          message: "Too far from the pickup",
          code: "outside_geofence",
          details: { distanceMeters: 268, geofenceMeters: 100 },
        },
      },
    });
    fireEvent.press(await screen.findByTestId("ride-arrived"));
    expect(await screen.findByTestId("geofence-hint-text")).toHaveTextContent(
      "You're 268 m away.",
      { exact: false },
    );

    // Still outside (≈ 1.1 km from the 33.5 / 36.28 pickup): the hint stays.
    emitPosition(33.49, 36.27);
    expect(screen.getByTestId("geofence-hint")).toBeTruthy();

    // ≈ 30 m from the pickup — inside the 100 m fence: the hint goes away.
    emitPosition(33.5, 36.2803);
    await waitFor(() =>
      expect(screen.queryByTestId("geofence-hint")).toBeNull(),
    );
    expect(screen.getByTestId("ride-arrived")).toBeTruthy();
  });

  it("arrive without a fresh server position explains no_position", async () => {
    await withActiveRide(rideFixture(), {
      [ARRIVE]: {
        status: 422,
        body: {
          status: 422,
          message: "No position",
          code: "no_position",
          details: { distanceMeters: null, geofenceMeters: 100 },
        },
      },
    });
    fireEvent.press(await screen.findByTestId("ride-arrived"));
    expect(await screen.findByTestId("no-position-hint")).toHaveTextContent(
      "We don't have your current location yet.",
      { exact: false },
    );
  });

  it("arrive succeeds → at pickup: waiting timer, free wait, no-show disabled until the grace ends, then cancel rider_no_show", async () => {
    const arrived = arrivedRide(1500, 72000);
    const { contract } = await withActiveRide(rideFixture(), {
      [ARRIVE]: ok(arrived),
      [CANCEL]: ok(
        rideFixture({
          state: "cancelled_by_driver",
          cancellationReason: "rider_no_show",
        }),
      ),
    });
    fireEvent.press(await screen.findByTestId("ride-arrived"));

    expect(await screen.findByTestId("at-pickup-sheet")).toBeTruthy();
    expect(screen.getByTestId("wait-timer")).toHaveTextContent(/^1:1\d$/);
    expect(screen.getByTestId("free-wait-text")).toHaveTextContent(
      /Free wait ends in 0:0\d/,
    );
    const noShow = screen.getByTestId("ride-no-show");
    expect(noShow.props.accessibilityState.disabled).toBe(true);
    expect(noShow).toHaveTextContent(/No-show in 0:0\d/);
    fireEvent.press(noShow);
    expect(screen.queryByTestId("cancel-sheet")).toBeNull();

    // The free wait ends → the no-show option opens.
    await waitFor(
      () =>
        expect(
          screen.getByTestId("ride-no-show").props.accessibilityState.disabled,
        ).toBe(false),
      { timeout: 4000 },
    );
    expect(screen.getByTestId("free-wait-text")).toHaveTextContent(
      "Free wait is over.",
      { exact: false },
    );
    fireEvent.press(screen.getByTestId("ride-no-show"));
    expect(await screen.findByTestId("cancel-sheet")).toBeTruthy();
    expect(
      screen.getByTestId("cancel-reason-rider_no_show").props.accessibilityState
        .checked,
    ).toBe(true);
    expect(screen.getByTestId("cancel-copy")).toHaveTextContent(
      "Rana will be charged the cancellation fee",
      { exact: false },
    );
    fireEvent.press(screen.getByTestId("cancel-confirm"));

    expect(await screen.findByTestId("ride-notice-rideCancelled")).toBeTruthy();
    expect(contract.requestsTo(CANCEL)[0].body).toEqual({
      reason: "rider_no_show",
    });
    expect(screen.getByTestId("availability-online")).toBeTruthy();
  });

  it("a no-show the server finds too early (422 no_show_too_early) is explained", async () => {
    await withActiveRide(arrivedRide(-1000), {
      [CANCEL]: {
        status: 422,
        body: {
          status: 422,
          message: "Too early",
          code: "no_show_too_early",
          details: { availableAt: "2026-10-08T10:05:00Z" },
        },
      },
    });
    fireEvent.press(await screen.findByTestId("ride-no-show"));
    fireEvent.press(await screen.findByTestId("cancel-confirm"));
    expect(
      await screen.findByTestId("cancel-no-show-too-early"),
    ).toHaveTextContent("It's too early to cancel as a no-show.", {
      exact: false,
    });
    expect(screen.getByTestId("cancel-sheet")).toBeTruthy();
  });

  it("start → in ride; a rider route change is shown; end ride → the stored fare breakdown", async () => {
    const started = inProgressRide({
      stops: [{ lat: 33.51, lng: 36.29, label: "Abu Rummaneh" }],
    });
    const completed = completedRide();
    const { socket } = await withActiveRide(arrivedRide(60000), {
      [START]: ok(started),
      [COMPLETE]: ok(completed),
    });
    fireEvent.press(await screen.findByTestId("ride-start"));

    expect(await screen.findByTestId("in-ride-sheet")).toBeTruthy();
    expect(screen.getByTestId("ride-stop-0")).toHaveTextContent("Abu Rummaneh", {
      exact: false,
    });
    expect(screen.getByTestId("ride-destination")).toHaveTextContent(
      "Umayyad Square",
      { exact: false },
    );
    // I60 (board DriverInRide): while a stop remains, the top card leads to
    // it with its number badge; once passed, to the drop-off.
    expect(screen.getByTestId("in-ride-instruction-title")).toHaveTextContent(
      "Abu Rummaneh",
    );
    expect(screen.getByTestId("in-ride-instruction-subtitle")).toHaveTextContent(
      /^Next stop · [0-9.]+ km$/,
    );
    act(() => emitPosition(33.5101, 36.2901));
    await waitFor(() =>
      expect(screen.getByTestId("in-ride-instruction-subtitle")).toHaveTextContent(
        "Drop-off · 7 min",
      ),
    );
    expect(screen.queryByTestId("route-changed")).toBeNull();

    // The rider changes the destination (RIDE-05).
    receive(
      socket,
      rideFrame(
        "ride.updated",
        inProgressRide({
          stops: started.stops,
          destination: { lat: 33.52, lng: 36.3, label: "Bab Touma" },
        }),
        { reason: "route_changed" },
      ),
    );
    expect(await screen.findByTestId("route-changed")).toBeTruthy();
    expect(screen.getByTestId("ride-destination")).toHaveTextContent(
      "Drop-off · route updated by riderBab Touma",
    );

    fireEvent.press(screen.getByTestId("ride-end"));
    expect(await screen.findByTestId("ride-complete-screen")).toBeTruthy();
    // Only the STORED fare from the response — never recomputed.
    expect(screen.getByTestId("collect-total")).toHaveTextContent("SYP 27,250");
    expect(screen.getByTestId("fare-line-base")).toHaveTextContent(
      "Base fareSYP 5,000",
    );
    expect(screen.getByTestId("fare-line-distance")).toHaveTextContent(
      "Distance · 4.2 kmSYP 12,600",
    );
    expect(screen.getByTestId("fare-line-time")).toHaveTextContent(
      "Time · 14 minSYP 4,200",
    );
    expect(screen.getByTestId("fare-line-surcharge")).toHaveTextContent(
      "Time surcharge +25%SYP 5,450",
    );
    // Zero components are not listed.
    expect(screen.queryByTestId("fare-line-surge")).toBeNull();
    expect(screen.queryByTestId("fare-line-wait")).toBeNull();
  });

  it("cash received → paid_cash → the earnings breakdown (M8) → Done → online home", async () => {
    const { contract } = await withActiveRide(completedRide(), {
      [CASH]: ok(completedRide({ paymentStatus: "paid_cash" })),
      [EARNINGS]: ok(earningPage([tripEarningFixture()])),
    });
    fireEvent.press(await screen.findByTestId("cash-received"));
    // UC-D-15: the per-trip breakdown replaces the M7 notice.
    expect(await screen.findByTestId("trip-earnings-screen")).toBeTruthy();
    expect(contract.requestsTo(CASH)).toHaveLength(1);
    fireEvent.press(screen.getByTestId("trip-earnings-done"));
    expect(await screen.findByTestId("availability-online")).toBeTruthy();
  });

  it("rider didn't pay → unpaid; the ride stays completed and closes (E1)", async () => {
    const { contract } = await withActiveRide(completedRide(), {
      [UNPAID]: ok(completedRide({ paymentStatus: "unpaid" })),
    });
    fireEvent.press(await screen.findByTestId("mark-unpaid"));
    expect(await screen.findByTestId("ride-notice-markedUnpaid")).toBeTruthy();
    expect(contract.requestsTo(UNPAID)).toHaveLength(1);
  });

  it("409 payment_not_pending → resync and a notice", async () => {
    const { contract } = await withActiveRide(completedRide(), {
      [ACTIVE_RIDE]: [ok(completedRide()), ok(completedRide()), { status: 204 }],
      [CASH]: {
        status: 409,
        body: { status: 409, message: "Settled", code: "payment_not_pending" },
      },
      [`GET ${RIDE}`]: ok(completedRide({ paymentStatus: "paid_cash" })),
    });
    fireEvent.press(await screen.findByTestId("cash-received"));
    expect(await screen.findByTestId("ride-notice-paymentSettled")).toBeTruthy();
    expect(screen.getByTestId("availability-online")).toBeTruthy();
    expect(contract.requestsTo(ACTIVE_RIDE).length).toBeGreaterThanOrEqual(3);
  });

  it("driver cancel: reason mandatory, `other` needs a note → cancelled, back online", async () => {
    const { contract } = await withActiveRide(rideFixture(), {
      [CANCEL]: ok(
        rideFixture({ state: "cancelled_by_driver", cancellationReason: "other" }),
      ),
    });
    fireEvent.press(await screen.findByTestId("ride-cancel-open"));
    expect(await screen.findByTestId("cancel-sheet")).toBeTruthy();
    expect(screen.getByTestId("cancel-copy")).toHaveTextContent(
      "Rana won't be charged, and we'll find another driver for the trip. Cancellations count toward your cancellation rate.",
    );
    // No-show is impossible before arriving.
    expect(
      screen.getByTestId("cancel-reason-rider_no_show").props.accessibilityState
        .disabled,
    ).toBe(true);
    // No reason → confirm disabled.
    expect(
      screen.getByTestId("cancel-confirm").props.accessibilityState.disabled,
    ).toBe(true);

    fireEvent.press(screen.getByTestId("cancel-reason-other"));
    fireEvent.press(screen.getByTestId("cancel-confirm"));
    expect(
      await screen.findByText("Tell us briefly what happened."),
    ).toBeTruthy();
    expect(contract.requestsTo(CANCEL)).toHaveLength(0);

    fireEvent.changeText(screen.getByTestId("cancel-note"), "Flat tyre");
    fireEvent.press(screen.getByTestId("cancel-confirm"));

    expect(await screen.findByTestId("ride-notice-rideCancelled")).toBeTruthy();
    expect(contract.requestsTo(CANCEL)[0].body).toEqual({
      reason: "other",
      note: "Flat tyre",
    });
    expect(screen.getByTestId("availability-online")).toBeTruthy();
  });

  it("keep the ride closes the cancel sheet without a request", async () => {
    const { contract } = await withActiveRide(rideFixture());
    fireEvent.press(await screen.findByTestId("ride-cancel-open"));
    fireEvent.press(screen.getByTestId("cancel-reason-vehicle_issue"));
    fireEvent.press(screen.getByTestId("cancel-keep"));
    expect(screen.queryByTestId("cancel-sheet")).toBeNull();
    expect(contract.requestsTo(CANCEL)).toHaveLength(0);
    expect(screen.getByTestId("to-pickup-sheet")).toBeTruthy();
  });

  it("the rider cancelling (ride.state cancelled_by_rider) ends the ride with a notice", async () => {
    const { socket } = await withActiveRide(rideFixture());
    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
    receive(
      socket,
      rideFrame("ride.state", rideFixture({ state: "cancelled_by_rider" })),
    );
    expect(await screen.findByTestId("ride-notice-riderCancelled")).toBeTruthy();
    expect(screen.getByTestId("availability-online")).toBeTruthy();
  });

  it("the in-ride sheet header follows board DriverSafetyActions (I64)", async () => {
    await withActiveRide(inProgressRide());
    expect(await screen.findByTestId("in-ride-sheet")).toBeTruthy();

    expect(screen.getByTestId("in-ride-title")).toHaveTextContent("To drop-off");
    expect(screen.getByTestId("in-ride-eta")).toHaveTextContent("7 min");
    expect(screen.getByTestId("in-ride-subtitle")).toHaveTextContent(
      "Umayyad Square · Rana",
    );
    expect(screen.getByTestId("in-ride-fare")).toHaveTextContent(
      "Economy · Cash · fare is metered",
      { exact: false },
    );
    expect(screen.getByTestId("in-ride-estimate")).toHaveTextContent(
      /^SYP 22,000 est\.$/,
    );
    // The superseded DriverInRide header (rider's name + elapsed clock) is gone.
    expect(screen.queryByText("Rana's ride")).toBeNull();
    expect(screen.queryByTestId("ride-elapsed")).toBeNull();
    expect(screen.getByTestId("ride-end")).toBeTruthy();
  });

  it("ride.connection lost / ok toggles the connection-lost banner (UC-D-08 E1)", async () => {
    const { socket } = await withActiveRide(inProgressRide());
    expect(await screen.findByTestId("in-ride-sheet")).toBeTruthy();
    receive(socket, {
      type: "ride.connection",
      as: "driver",
      rideId: RIDE_ID,
      driverStream: "lost",
    });
    expect(await screen.findByTestId("ride-connection-lost")).toBeTruthy();
    receive(socket, {
      type: "ride.connection",
      as: "driver",
      rideId: RIDE_ID,
      driverStream: "ok",
    });
    await waitFor(() =>
      expect(screen.queryByTestId("ride-connection-lost")).toBeNull(),
    );
  });

  it("going offline during a ride is refused (409): explained, and the ride is shown", async () => {
    const contract = await renderDriverApp({
      [ACTIVE_RIDE]: [{ status: 204 }, { status: 204 }, ok(rideFixture())],
      [SET_AVAILABILITY]: { status: 409, body: { status: 409 } },
    });
    await goLive();
    await waitForResync(contract, 2);
    expect(await screen.findByTestId("availability-online")).toBeTruthy();

    fireEvent.press(screen.getByTestId("availability-toggle"));

    // The facade resyncs after the refusal and the ride takes over the home.
    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
    expect(contract.requestsTo(SET_AVAILABILITY)[0].body).toEqual({
      online: false,
    });
    expect(contract.requestsTo(AVAILABILITY).length).toBeGreaterThanOrEqual(1);
    await act(async () => {});
  });

  it("offline refusal message is shown while no ride was found", async () => {
    await renderDriverApp({
      [SET_AVAILABILITY]: { status: 409, body: { status: 409 } },
    });
    await goLive();
    fireEvent.press(await screen.findByTestId("availability-toggle"));
    expect(
      await screen.findByTestId("availability-action-error-offlineConflict"),
    ).toHaveTextContent(
      "You can't go offline right now — finish your active ride first.",
      { exact: false },
    );
  });
});

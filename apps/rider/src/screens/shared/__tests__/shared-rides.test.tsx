/**
 * M12-T3 shared rides (UC-R-12…15) against scheduled-shared-v1 mocks:
 * browse with occupancy + filters (EN + AR), join (E1 seats race inline,
 * E2 closed sheet, the join that fills it hands over to the ride), the
 * creator's start / cancel, a member's free leave, live occupancy frames,
 * creation (no stops, departure rule, seats / party, coded errors), and
 * after dispatch: the shared chip, the per-member leave with its fee
 * quote, no route changes, the per-seat split at completion and on the
 * receipt.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { LANGUAGE_STORAGE_KEY, LocaleProvider } from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import {
  liveSharedRide,
  member,
  SHARED_ID,
  sharedRide,
} from "../../../test-utils/m12-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  components,
  ECONOMY_ID,
  estimateResponse,
  fakeSocketFactory,
  FakeSocket,
  receiptFixture,
  savedHome,
  savedWork,
} from "../../../test-utils/ride-fixtures";
import HomeScreen from "../../home-screen";
import ReceiptScreen from "../../ride/receipt-screen";
import { RideView } from "../../ride/ride-view";
import SharedCreateScreen from "../shared-create-screen";
import SharedRideScreen from "../shared-ride-screen";
import SharedRidesScreen from "../shared-rides-screen";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import("react")>("react").useEffect(effect, [effect]),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const locationMock = Location as jest.Mocked<typeof Location>;

function grantLocation() {
  const permission = {
    granted: true,
    status: "granted" as Location.PermissionStatus,
    canAskAgain: true,
    expires: "never" as const,
  };
  locationMock.requestForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 33.5138, longitude: 36.2765 },
  } as Location.LocationObject);
  locationMock.watchPositionAsync.mockResolvedValue({
    remove: jest.fn(),
  } as unknown as Location.LocationSubscription);
}

function withProviders(ui: React.ReactElement) {
  return render(
    <LocaleProvider>
      <RideProvider socketFactory={fakeSocketFactory}>{ui}</RideProvider>
    </LocaleProvider>,
  );
}

const SHARED = `/api/v1/shared-rides/${SHARED_ID}`;
const ACTIVE_NONE = { "GET /api/v1/rides/active": { status: 204 } };

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  grantLocation();
});

describe("browse shared rides (UC-R-13 step 1)", () => {
  it("lists open rides with occupancy and filters them", async () => {
    const whenFull = sharedRide({
      rideId: "99999999-9999-4999-8999-999999999999",
      destination: { lat: 33.5134, lng: 36.3157, label: "Bab Touma" },
      departure: { mode: "when_full", departAt: null, expiresAt: null },
      totalSeats: 6,
      seatsTaken: 5,
      seatsLeft: 1,
      estimateTotal: 30000,
      me: member(),
    });
    const api = mockApi({
      ...ACTIVE_NONE,
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedHome] },
      "GET /api/v1/shared-rides": {
        status: 200,
        body: { items: [sharedRide(), whenFull], page: 0, size: 20, totalItems: 2 },
      },
    });
    await withProviders(<SharedRidesScreen />);

    const card = await screen.findByTestId(`shared-card-${SHARED_ID}`);
    expect(card).toHaveTextContent(/Damascus University.*Leaves /);
    expect(card).toHaveTextContent(/From Mazzeh Autostrad · 0 m from you · Economy/);
    expect(screen.getByTestId(`shared-card-occupancy-${SHARED_ID}`)).toHaveTextContent(
      "2 of 4 seats taken · 2 left",
    );
    expect(card).toHaveTextContent(/~SYP 24,000 ride/);
    expect(screen.getByTestId(`shared-card-${whenFull.rideId}`)).toHaveTextContent(
      /Bab Touma.*Leaves when full/,
    );
    // The ride the rider is already in says so.
    expect(screen.getByTestId(`shared-card-member-${whenFull.rideId}`)).toHaveTextContent(
      "You're in",
    );
    expect(api.callsTo("GET", "/api/v1/shared-rides")[0].query).toMatchObject({
      lat: "33.5138",
      lng: "36.2765",
      page: "0",
    });

    // "Next 2 hours" sends a departure range.
    await fireEvent.press(screen.getByTestId("shared-filter-next2h"));
    await waitFor(() => expect(api.callsTo("GET", "/api/v1/shared-rides")).toHaveLength(2));
    const timed = api.callsTo("GET", "/api/v1/shared-rides")[1].query;
    expect(timed.departFrom).toBeTruthy();
    expect(
      Date.parse(timed.departTo) - Date.parse(timed.departFrom),
    ).toBe(2 * 60 * 60 * 1000);

    // A destination from the saved places.
    await fireEvent.press(screen.getByTestId("shared-destination"));
    await fireEvent.press(await screen.findByTestId(`shared-destination-saved-${savedHome.id}`));
    await waitFor(() => expect(api.callsTo("GET", "/api/v1/shared-rides")).toHaveLength(3));
    expect(api.callsTo("GET", "/api/v1/shared-rides")[2].query).toMatchObject({
      destLat: String(savedHome.lat),
      destLng: String(savedHome.lng),
    });

    await fireEvent.press(screen.getByTestId(`shared-card-${SHARED_ID}`));
    expect(mockPush).toHaveBeenCalledWith(`/shared/${SHARED_ID}`);
    await fireEvent.press(screen.getByTestId("shared-create"));
    expect(mockPush).toHaveBeenCalledWith("/shared/create");
  });

  it("reads in Arabic", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({
      ...ACTIVE_NONE,
      "GET /api/v1/rider/saved-locations": { status: 200, body: [] },
      "GET /api/v1/shared-rides": {
        status: 200,
        body: { items: [sharedRide()], page: 0, size: 20, totalItems: 1 },
      },
    });
    await withProviders(<SharedRidesScreen />);
    expect(await screen.findByTestId(`shared-card-occupancy-${SHARED_ID}`)).toHaveTextContent(
      "2 من 4 مقاعد · بقي 2",
    );
    expect(screen.getByText("أنشئ رحلة مشتركة")).toBeOnTheScreen();
    expect(screen.getByText("إلى أين؟ (أي وجهة)")).toBeOnTheScreen();
  });

  it("explains an area outside the service region", async () => {
    mockApi({
      ...ACTIVE_NONE,
      "GET /api/v1/rider/saved-locations": { status: 200, body: [] },
      "GET /api/v1/shared-rides": {
        status: 422,
        body: { status: 422, message: "Outside", code: "outside_region" },
      },
    });
    await withProviders(<SharedRidesScreen />);
    expect(await screen.findByTestId("shared-message")).toBeOnTheScreen();
  });
});

describe("join a shared ride (UC-R-13)", () => {
  it("joins first-come with party size and own payment", async () => {
    const api = mockApi({
      ...ACTIVE_NONE,
      [`GET ${SHARED}`]: { status: 200, body: sharedRide() },
      [`POST ${SHARED}/join`]: {
        status: 200,
        body: sharedRide({ seatsTaken: 4, seatsLeft: 0, state: "gathering", me: member() }),
      },
    });
    await withProviders(<SharedRideScreen rideId={SHARED_ID} />);

    expect(await screen.findByText("To Damascus University")).toBeOnTheScreen();
    expect(screen.getByText("Shared by Lina · Economy")).toBeOnTheScreen();
    expect(screen.getByTestId("shared-ride-departure")).toHaveTextContent(
      /Leaves at .* with whoever has joined/,
    );
    expect(screen.getByTestId("shared-ride-occupancy")).toHaveTextContent(
      "2 of 4 seats taken · 2 left",
    );
    expect(screen.getByText("If all 4 seats ride · per seat")).toBeOnTheScreen();
    expect(screen.getByTestId("shared-ride-per-seat")).toHaveTextContent("~SYP 6,000");
    // Party size is capped by the seats left.
    await fireEvent.press(screen.getByTestId("shared-ride-party-increase"));
    expect(screen.getByTestId("shared-ride-party-value")).toHaveTextContent("2");
    expect(screen.getByTestId("shared-ride-party-increase")).toBeDisabled();
    await fireEvent.press(screen.getByTestId("shared-ride-payment-change"));
    expect(screen.getByTestId("shared-ride-join")).toHaveTextContent("Join · 2 seats");
    await fireEvent.press(screen.getByTestId("shared-ride-join"));

    // Member view (approved artboard RiderSharedMember).
    expect(await screen.findByText("You're in · waiting to leave")).toBeOnTheScreen();
    expect(screen.getByTestId("shared-ride-occupancy")).toHaveTextContent(
      "4 of 4 seats taken",
    );
    expect(screen.getByText("Your 2 seats if all 4 ride")).toBeOnTheScreen();
    expect(screen.getByTestId("shared-ride-my-share")).toHaveTextContent("~SYP 12,000");
    expect(api.callsTo("POST", `${SHARED}/join`)[0].body).toEqual({
      partySize: 2,
      paymentMethod: "wallet",
    });
  });

  it("E1: fewer seats left than the party — inline, join with fewer", async () => {
    const api = mockApi({
      ...ACTIVE_NONE,
      [`GET ${SHARED}`]: { status: 200, body: sharedRide() },
      [`POST ${SHARED}/join`]: [
        {
          status: 409,
          body: {
            status: 409,
            message: "Not enough seats",
            code: "insufficient_seats",
            details: { seatsLeft: 1 },
          },
        },
        { status: 200, body: sharedRide({ me: member({ partySize: 1 }) }) },
      ],
    });
    await withProviders(<SharedRideScreen rideId={SHARED_ID} />);
    await fireEvent.press(await screen.findByTestId("shared-ride-party-increase"));
    await fireEvent.press(screen.getByTestId("shared-ride-join"));

    expect(await screen.findByTestId("shared-ride-insufficient")).toHaveTextContent(
      /Only 1 seat left.*Someone joined just before you/,
    );
    expect(screen.getByTestId("shared-ride-join")).toHaveTextContent("Join · 1 seat");
    await fireEvent.press(screen.getByTestId("shared-ride-join"));
    await waitFor(() => expect(api.callsTo("POST", `${SHARED}/join`)).toHaveLength(2));
    expect(api.callsTo("POST", `${SHARED}/join`)[1].body).toMatchObject({ partySize: 1 });
  });

  it("E2: the ride left or was cancelled meanwhile", async () => {
    mockApi({
      ...ACTIVE_NONE,
      [`GET ${SHARED}`]: { status: 200, body: sharedRide() },
      [`POST ${SHARED}/join`]: {
        status: 409,
        body: { status: 409, message: "Closed", code: "shared_ride_closed" },
      },
    });
    await withProviders(<SharedRideScreen rideId={SHARED_ID} />);
    await fireEvent.press(await screen.findByTestId("shared-ride-join"));
    expect(await screen.findByText("This ride is no longer open")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("shared-closed-done"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("the join that fills the ride hands over to the live ride", async () => {
    mockApi({
      ...ACTIVE_NONE,
      [`GET ${SHARED}`]: { status: 200, body: sharedRide() },
      [`POST ${SHARED}/join`]: {
        status: 200,
        body: sharedRide({ state: "requested", seatsTaken: 4, seatsLeft: 0, me: member() }),
      },
      [`GET /api/v1/rides/${SHARED_ID}`]: { status: 200, body: liveSharedRide({ state: "requested" }) },
    });
    await withProviders(<SharedRideScreen rideId={SHARED_ID} />);
    await fireEvent.press(await screen.findByTestId("shared-ride-party-increase"));
    await fireEvent.press(screen.getByTestId("shared-ride-join"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/ride/${SHARED_ID}`));
  });
});

describe("creator and member before dispatch (UC-R-14/15)", () => {
  const creatorView = () =>
    sharedRide({
      seatsTaken: 3,
      seatsLeft: 1,
      isCreator: true,
      me: member({ isCreator: true, partySize: 1 }),
    });

  it("the creator starts now", async () => {
    const api = mockApi({
      ...ACTIVE_NONE,
      [`GET ${SHARED}`]: { status: 200, body: creatorView() },
      [`POST ${SHARED}/start`]: {
        status: 200,
        body: { ...creatorView(), state: "requested" },
      },
      [`GET /api/v1/rides/${SHARED_ID}`]: { status: 200, body: liveSharedRide({ state: "requested" }) },
    });
    await withProviders(<SharedRideScreen rideId={SHARED_ID} />);
    expect(await screen.findByText("Gathering riders · you shared this ride")).toBeOnTheScreen();
    expect(screen.getByText("Per seat if 3 ride")).toBeOnTheScreen();
    expect(screen.getByTestId("shared-ride-per-seat")).toHaveTextContent("~SYP 8,000");
    await fireEvent.press(screen.getByTestId("shared-ride-start"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/ride/${SHARED_ID}`));
    expect(api.callsTo("POST", `${SHARED}/start`)).toHaveLength(1);
  });

  it("the creator cancels the group (free, everyone told)", async () => {
    const api = mockApi({
      ...ACTIVE_NONE,
      [`GET ${SHARED}`]: { status: 200, body: creatorView() },
      [`POST ${SHARED}/cancel`]: {
        status: 200,
        body: { ...creatorView(), state: "cancelled_by_rider" },
      },
    });
    await withProviders(<SharedRideScreen rideId={SHARED_ID} />);
    await fireEvent.press(await screen.findByTestId("shared-ride-cancel"));
    expect(await screen.findByText("It's free. Everyone who joined will be told.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("shared-cancel-confirm"));
    expect(await screen.findByTestId("shared-ride-ended")).toHaveTextContent(
      "This shared ride was cancelled",
    );
    expect(screen.getByTestId("shared-ride-ended-body")).toHaveTextContent(
      "You cancelled it. Everyone who joined was told.",
    );
    expect(api.callsTo("POST", `${SHARED}/cancel`)[0].body).toEqual({
      reason: "changed_mind",
    });
  });

  it("a member leaves free before dispatch; occupancy updates live", async () => {
    const api = mockApi({
      ...ACTIVE_NONE,
      [`GET ${SHARED}`]: { status: 200, body: sharedRide({ me: member() }) },
      [`POST ${SHARED}/leave`]: {
        status: 200,
        body: sharedRide({ me: member({ status: "left" }) }),
      },
    });
    await withProviders(<SharedRideScreen rideId={SHARED_ID} />);
    expect(await screen.findByTestId("shared-ride-occupancy")).toHaveTextContent(
      "2 of 4 seats taken",
    );

    const socket = FakeSocket.latest();
    await act(async () => socket.open());
    await act(async () => socket.receive({ type: "ready" }));
    await act(async () =>
      socket.receive({
        type: "shared.occupancy",
        as: "rider",
        rideId: SHARED_ID,
        seatsTaken: 3,
        totalSeats: 4,
      }),
    );
    expect(screen.getByTestId("shared-ride-occupancy")).toHaveTextContent(
      "3 of 4 seats taken",
    );

    // V1 audit I52: leaving is free here, but asked first.
    await fireEvent.press(screen.getByTestId("shared-ride-leave"));
    expect(await screen.findByTestId("shared-leave-free-sheet")).toHaveTextContent(
      /Leave this shared ride\?.*Free to leave now/,
    );
    await fireEvent.press(screen.getByTestId("shared-leave-free-stay"));
    expect(api.callsTo("POST", `${SHARED}/leave`)).toHaveLength(0);
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("shared-ride-leave"));
    await fireEvent.press(await screen.findByTestId("shared-leave-free-confirm"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", `${SHARED}/leave`)[0].body).toEqual({});
  });

  it("explains an unfilled 'when full' ride the system cancelled", async () => {
    mockApi({
      ...ACTIVE_NONE,
      [`GET ${SHARED}`]: {
        status: 200,
        body: sharedRide({
          state: "cancelled_by_rider",
          cancellationReason: "shared_expired",
          me: member({ status: "left" }),
        }),
      },
    });
    await withProviders(<SharedRideScreen rideId={SHARED_ID} />);
    expect(await screen.findByTestId("shared-ride-ended-body")).toHaveTextContent(
      "It didn't fill within 24 hours. No one was charged.",
    );
  });
});

describe("create a shared ride (UC-R-12)", () => {
  async function planRoute() {
    await waitFor(() =>
      expect(screen.getByTestId("shared-create-route-input-pickup").props.value).toBe(
        "Current location",
      ),
    );
    // One pickup, one destination: no stops.
    expect(screen.queryByTestId("shared-create-route-add-stop")).toBeNull();
    expect(screen.getByText("Share a ride")).toBeOnTheScreen();
    await fireEvent.press(
      await screen.findByTestId(`shared-create-route-saved-${savedWork.id}`),
    );
    await fireEvent.press(screen.getByTestId("shared-create-route-submit"));
  }

  it("publishes a 'when full' ride with seats and party", async () => {
    const api = mockApi({
      ...ACTIVE_NONE,
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedWork] },
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/shared-rides": {
        status: 201,
        body: sharedRide({ isCreator: true, me: member({ isCreator: true }) }),
      },
    });
    await withProviders(<SharedCreateScreen />);
    await planRoute();

    expect(await screen.findByTestId("shared-create-estimate")).toHaveTextContent(
      "~SYP 22,000 whole ride · you pay your seats' share",
    );
    // M12 review W6: priced like the published ride — at the departure time.
    const estimateBody = api.callsTo("POST", "/api/v1/rides/estimate")[0].body as {
      scheduledAt?: string;
    };
    expect(estimateBody).toMatchObject({
      pickup: { lat: 33.5138, lng: 36.2765, label: "Current location" },
      destination: { lat: savedWork.lat, lng: savedWork.lng, label: "Work" },
    });
    expect(Date.parse(estimateBody.scheduledAt ?? "")).toBeGreaterThan(Date.now());
    // V1 audit I50: the note says "Leaves at 17:30" (or "Tomorrow · 17:30"),
    // never "Leaves at Today · 17:30".
    expect(screen.getByTestId("shared-create-depart-note")).toHaveTextContent(
      /^Leaves at \S.* with whoever has joined\./,
    );
    expect(screen.getByTestId("shared-create-depart-note")).not.toHaveTextContent(
      /Leaves at Today/,
    );
    await fireEvent.press(screen.getByTestId("shared-create-mode-when_full"));
    expect(
      screen.getByText(
        "Leaves as soon as every seat is taken. If it doesn't fill within 24 hours, it's cancelled and everyone is told.",
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("shared-create-seats-increase"));
    await fireEvent.press(screen.getByTestId("shared-create-party-increase"));
    await fireEvent.press(screen.getByTestId("shared-create-publish"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/shared/${SHARED_ID}`));
    expect(api.callsTo("POST", "/api/v1/shared-rides")[0].body).toEqual({
      pickup: { lat: 33.5138, lng: 36.2765, label: "Current location" },
      destination: { lat: savedWork.lat, lng: savedWork.lng, label: "Work" },
      serviceTypeId: ECONOMY_ID,
      paymentMethod: "cash",
      totalSeats: 5,
      partySize: 2,
      departure: { mode: "when_full" },
    });
  });

  it("sends a departure time and explains seats_unavailable", async () => {
    const api = mockApi({
      ...ACTIVE_NONE,
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedWork] },
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/shared-rides": {
        status: 422,
        body: {
          status: 422,
          message: "Seats",
          code: "seats_unavailable",
          details: { maxSeats: 4 },
        },
      },
    });
    await withProviders(<SharedCreateScreen />);
    await planRoute();
    await fireEvent.press(await screen.findByTestId("shared-create-seats-increase"));
    await fireEvent.press(screen.getByTestId("shared-create-publish"));

    expect(await screen.findByTestId("shared-create-error")).toHaveTextContent(
      "Cars of this ride type here have at most 4 seats. Offer fewer seats.",
    );
    const body = api.callsTo("POST", "/api/v1/shared-rides")[0].body as {
      departure: { mode: string; departAt: string };
    };
    expect(body.departure.mode).toBe("at_time");
    expect(Date.parse(body.departure.departAt)).toBeGreaterThan(Date.now());
  });

  it("explains party_too_large on create", async () => {
    mockApi({
      ...ACTIVE_NONE,
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedWork] },
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/shared-rides": {
        status: 422,
        body: { status: 422, message: "party_too_large", code: "party_too_large" },
      },
    });
    await withProviders(<SharedCreateScreen />);
    await planRoute();
    await fireEvent.press(await screen.findByTestId("shared-create-publish"));
    expect(await screen.findByTestId("shared-create-error")).toHaveTextContent(
      "Your party can't be bigger than the seats in the ride.",
    );
  });

  it("explains departure_in_past on create", async () => {
    mockApi({
      ...ACTIVE_NONE,
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedWork] },
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/shared-rides": {
        status: 422,
        body: { status: 422, message: "departure_in_past", code: "departure_in_past" },
      },
    });
    await withProviders(<SharedCreateScreen />);
    await planRoute();
    await fireEvent.press(await screen.findByTestId("shared-create-publish"));
    expect(await screen.findByTestId("shared-create-error")).toHaveTextContent(
      "Pick a departure time in the future.",
    );
  });

  it("explains an active ride in the way", async () => {
    mockApi({
      ...ACTIVE_NONE,
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedWork] },
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/shared-rides": {
        status: 409,
        body: { status: 409, message: "Active", code: "active_ride_exists" },
      },
    });
    await withProviders(<SharedCreateScreen />);
    await planRoute();
    await fireEvent.press(await screen.findByTestId("shared-create-publish"));
    expect(await screen.findByTestId("shared-create-error")).toHaveTextContent(
      "You already have a ride or a shared ride in progress. Finish it first.",
    );
  });
});

describe("after dispatch (UC-R-14 E1, UC-R-15 completion)", () => {
  it("shows the shared chip and leaves with the fee quote", async () => {
    const live = liveSharedRide();
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 200, body: live },
      [`GET ${SHARED}/leave-quote`]: {
        status: 200,
        body: {
          free: false,
          fee: 2000,
          currency: "SYP",
          graceEndsAt: "2026-10-08T09:31:20Z",
        },
      },
      [`POST ${SHARED}/leave`]: {
        status: 200,
        body: sharedRide({
          state: "accepted",
          me: member({ status: "cancelled", cancellationFee: 2000 }),
        }),
      },
    });
    await withProviders(<RideView ride={live} onDone={() => {}} />);

    expect(await screen.findByTestId("ride-shared-chip")).toHaveTextContent(
      "Shared ride · 4 of 4 seats · your party 2",
    );
    await fireEvent.press(screen.getByTestId("ride-cancel"));
    expect(await screen.findByTestId("shared-leave-fee")).toHaveTextContent(
      /SYP 2,000 cancellation fee.*The others keep riding\./,
    );
    await fireEvent.press(screen.getByTestId("shared-leave-reason-driver_too_far"));
    await fireEvent.press(screen.getByTestId("shared-leave-confirm"));
    await waitFor(() => expect(api.callsTo("POST", `${SHARED}/leave`)).toHaveLength(1));
    expect(api.callsTo("POST", `${SHARED}/leave`)[0].body).toEqual({
      reason: "driver_too_far",
    });
    // The facade shows the ride ended for this member, with the fee.
    expect(api.callsTo("POST", `/api/v1/rides/${SHARED_ID}/cancel`)).toHaveLength(0);
  });

  it("home shows the ride ended for the member who left, with the fee", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 200, body: liveSharedRide() },
      "GET /api/v1/rider/saved-locations": { status: 200, body: [] },
      "GET /api/v1/scheduled-rides": { status: 200, body: [] },
      [`GET ${SHARED}/leave-quote`]: {
        status: 200,
        body: { free: false, fee: 2000, currency: "SYP", graceEndsAt: null },
      },
      [`POST ${SHARED}/leave`]: {
        status: 200,
        body: sharedRide({
          state: "accepted",
          me: member({ status: "cancelled", cancellationFee: 2000 }),
        }),
      },
    });
    await withProviders(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId("ride-cancel"));
    expect(screen.getByTestId("ride-cancel")).toHaveTextContent("Leave ride");
    await fireEvent.press(await screen.findByTestId("shared-leave-confirm"));
    expect(await screen.findByTestId("ride-ended-title")).toHaveTextContent(
      "You left this shared ride",
    );
    expect(screen.getByTestId("ride-ended-fee")).toHaveTextContent(
      "A cancellation fee of SYP 2,000 was recorded.",
    );
  });

  it("shows a member where to meet and their seats' share — never the whole-ride estimate (W25)", async () => {
    const live = liveSharedRide();
    mockApi({ "GET /api/v1/rides/active": { status: 200, body: live } });
    const view = await withProviders(<RideView ride={live} onDone={() => {}} />);

    expect(await screen.findByTestId("ride-shared-footer")).toBeOnTheScreen();
    expect(screen.getByText("Meet at")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-shared-meet-at")).toHaveTextContent(
      "Mazzeh Autostrad",
    );
    expect(screen.getByTestId("ride-shared-seats")).toHaveTextContent(
      "Your 2 seats · Cash",
    );
    expect(screen.getByText("share of the final fare")).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-estimate")).toBeNull();
    expect(screen.queryByText(/22,000/)).toBeNull();
    expect(screen.getByTestId("ride-cancel")).toHaveTextContent("Leave ride");

    // The arrived sheet carries the same rows.
    const arrived = liveSharedRide({
      state: "driver_arrived",
      shared: {
        ...live.shared!,
        me: member({ partySize: 1, paymentMethod: "wallet" }),
      },
    });
    await view.rerender(
      <LocaleProvider>
        <RideProvider socketFactory={fakeSocketFactory}>
          <RideView ride={arrived} onDone={() => {}} />
        </RideProvider>
      </LocaleProvider>,
    );
    expect(await screen.findByTestId("ride-arrived")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-shared-seats")).toHaveTextContent(
      "Your seat · Wallet",
    );
    expect(screen.queryByTestId("ride-estimate")).toBeNull();
  });

  it("words the member's seats in Arabic, dual and plural (W25)", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    const live = liveSharedRide();
    mockApi({ "GET /api/v1/rides/active": { status: 200, body: live } });
    await withProviders(<RideView ride={live} onDone={() => {}} />);

    expect(await screen.findByTestId("ride-shared-seats")).toHaveTextContent(
      "مقعداك · نقدًا",
    );
    expect(screen.getByText("نقطة اللقاء")).toBeOnTheScreen();
    expect(screen.getByText("حصتك من الأجرة النهائية")).toBeOnTheScreen();
  });

  it("offers no route changes on a shared ride", async () => {
    const live = liveSharedRide({ state: "in_progress" });
    mockApi({ "GET /api/v1/rides/active": { status: 200, body: live } });
    await withProviders(<RideView ride={live} onDone={() => {}} />);
    expect(await screen.findByTestId("ride-shared-chip")).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-change-destination")).toBeNull();
    expect(screen.queryByTestId("ride-add-stop")).toBeNull();
  });

  it("completes with the member's own share and the per-seat split", async () => {
    const done = liveSharedRide({
      state: "completed",
      paymentStatus: "split",
      fare: {
        distanceMeters: 5100,
        durationSeconds: 1080,
        components: components({ total: 25700, distanceFare: 15300, timeFare: 5400 }),
      },
      cashDue: 12850,
      shared: {
        ...liveSharedRide().shared!,
        me: member({
          status: "completed",
          shareAmount: 12850,
          paymentStatus: "paid_cash",
          cashDue: 12850,
        }),
        split: { fareTotal: 25700, currency: "SYP", boardedSeats: 4, perSeatAmount: 6425 },
      },
      myRating: { state: "submitted", windowEndsAt: null, score: 5 },
    });
    mockApi({ "GET /api/v1/rides/active": { status: 204 } });
    await withProviders(<RideView ride={done} onDone={() => {}} />);

    expect(await screen.findByTestId("ride-total")).toHaveTextContent("SYP 12,850");
    expect(screen.getByTestId("shared-split-per-seat")).toHaveTextContent(
      "Per seat · SYP 25,700 ÷ 4SYP 6,425",
    );
    expect(screen.getByTestId("shared-split-party")).toHaveTextContent("Your party2 seats");
    expect(screen.getByTestId("shared-split-share")).toHaveTextContent(
      "Your shareSYP 12,850",
    );
    expect(screen.getByText("Paid in cash")).toBeOnTheScreen();
  });

  it("the receipt adds the split and the member's own status", async () => {
    mockApi({
      ...ACTIVE_NONE,
      [`GET /api/v1/rides/${SHARED_ID}/receipt`]: {
        status: 200,
        body: receiptFixture({ rideId: SHARED_ID, paymentStatus: "split" }),
      },
      [`GET /api/v1/rides/${SHARED_ID}`]: {
        status: 200,
        body: liveSharedRide({
          state: "completed",
          shared: {
            ...liveSharedRide().shared!,
            me: member({ status: "completed", shareAmount: 12850, paymentStatus: "paid_cash" }),
            split: { fareTotal: 25700, currency: "SYP", boardedSeats: 4, perSeatAmount: 6425 },
          },
        }),
      },
    });
    await withProviders(<ReceiptScreen rideId={SHARED_ID} />);
    expect(await screen.findByTestId("receipt-shared-split")).toHaveTextContent(
      /Split by seat.*Seats that rode4.*Your shareSYP 12,850/,
    );
    expect(screen.getByText(/^Shared ride · Economy/)).toBeOnTheScreen();
    // Approved artboard RiderSharedReceipt (V1 audit I51).
    expect(screen.getByTestId("receipt-fare-total")).toHaveTextContent(
      /^Whole ride/,
    );
    expect(screen.getByTestId("receipt-shared-each-pays")).toHaveTextContent(
      "Each rider pays their own share and gets their own receipt.",
    );
  });
});

describe("M12 review fixes", () => {
  it("W7: a ride the rider left is not marked \"You're in\"", async () => {
    mockApi({
      ...ACTIVE_NONE,
      "GET /api/v1/rider/saved-locations": { status: 200, body: [] },
      "GET /api/v1/shared-rides": {
        status: 200,
        body: {
          items: [sharedRide({ me: member({ status: "left" }) })],
          page: 0,
          size: 20,
          totalItems: 1,
        },
      },
    });
    await withProviders(<SharedRidesScreen />);
    await screen.findByTestId(`shared-card-${SHARED_ID}`);
    expect(screen.queryByTestId(`shared-card-member-${SHARED_ID}`)).toBeNull();
  });

  it("W5: a shared ride with no driver ends without retry", async () => {
    const ended = liveSharedRide({ state: "no_driver_found", driver: null });
    mockApi({ "GET /api/v1/rides/active": { status: 204 } });
    await withProviders(<RideView ride={ended} onDone={() => {}} />);
    expect(await screen.findByTestId("ride-no-driver-shared")).toHaveTextContent(
      /No driver for this shared ride/,
    );
    expect(screen.queryByTestId("ride-retry")).toBeNull();
    await fireEvent.press(screen.getByTestId("ride-shared-find-another"));
    expect(mockReplace).toHaveBeenCalledWith("/shared");
  });

  it("W9: a shared receipt whose ride read fails offers a retry, never 'Pending'", async () => {
    const api = mockApi({
      ...ACTIVE_NONE,
      [`GET /api/v1/rides/${SHARED_ID}/receipt`]: {
        status: 200,
        body: receiptFixture({ rideId: SHARED_ID, paymentStatus: "split" }),
      },
      [`GET /api/v1/rides/${SHARED_ID}`]: [
        { status: 500, body: { status: 500, message: "down" } },
        {
          status: 200,
          body: liveSharedRide({
            state: "completed",
            shared: {
              ...liveSharedRide().shared!,
              me: member({ status: "completed", shareAmount: 12850, paymentStatus: "paid_cash" }),
              split: { fareTotal: 25700, currency: "SYP", boardedSeats: 4, perSeatAmount: 6425 },
            },
          }),
        },
      ],
    });
    await withProviders(<ReceiptScreen rideId={SHARED_ID} />);
    await fireEvent.press(await screen.findByTestId("error-retry"));
    expect(await screen.findByTestId("receipt-shared-split")).toBeOnTheScreen();
    expect(api.callsTo("GET", `/api/v1/rides/${SHARED_ID}`)).toHaveLength(2);
  });
});

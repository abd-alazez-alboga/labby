/**
 * M12-T3 managing scheduled rides (UC-R-11) against scheduled-shared-v1 /
 * rides-v1 mocks: the upcoming list with claim status (EN + AR/RTL), the
 * detail with the claiming driver, reminders and the free cancel; home's
 * "Later" / upcoming / shared entries; the 60-min warning before booking
 * now (ruling 2026-10-16); a push for a still-pre-live ride opens its own
 * screen; the system's `rider_busy` cancellation reads as such.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { LANGUAGE_STORAGE_KEY, LocaleProvider } from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import {
  inMinutes,
  openScheduledRide,
  SCHEDULED_ID,
  SCHEDULED_OPEN_ID,
  scheduledRide,
  sharedRide,
  SHARED_ID,
} from "../../../test-utils/m12-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  estimateResponse,
  fakeSocketFactory,
  FakeSocket,
  preferencesFixture,
  ride,
  RIDE_ID,
  savedWork,
} from "../../../test-utils/ride-fixtures";
import HomeScreen from "../../home-screen";
import BookingScreen from "../../ride/booking-screen";
import RideScreen from "../../ride/ride-screen";
import ScheduledRideScreen from "../scheduled-ride-screen";
import ScheduledRidesScreen from "../scheduled-rides-screen";

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

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  grantLocation();
});

describe("upcoming scheduled rides (UC-R-11)", () => {
  it("lists rides with claim status and opens one", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/scheduled-rides": {
        status: 200,
        body: [scheduledRide(), openScheduledRide()],
      },
    });
    await withProviders(<ScheduledRidesScreen />);

    expect(await screen.findByTestId(`scheduled-status-${SCHEDULED_ID}`)).toHaveTextContent(
      "Driver confirmed",
    );
    expect(screen.getByTestId(`scheduled-card-${SCHEDULED_ID}`)).toHaveTextContent(
      /Tomorrow · .*To Damascus Airport.*Samer · 4\.9 · Silver Hyundai Accent/,
    );
    expect(screen.getByTestId(`scheduled-status-${SCHEDULED_OPEN_ID}`)).toHaveTextContent(
      "Waiting for a driver",
    );
    expect(screen.getByTestId(`scheduled-card-${SCHEDULED_OPEN_ID}`)).toHaveTextContent(
      /we start looking for one live 15 minutes before pickup/,
    );

    await fireEvent.press(screen.getByTestId(`scheduled-card-${SCHEDULED_ID}`));
    expect(mockPush).toHaveBeenCalledWith(`/scheduled/${SCHEDULED_ID}`);
    await fireEvent.press(screen.getByTestId("scheduled-new"));
    expect(mockPush).toHaveBeenCalledWith("/schedule");
  });

  it("shows the empty state", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/scheduled-rides": { status: 200, body: [] },
    });
    await withProviders(<ScheduledRidesScreen />);
    expect(await screen.findByText("No scheduled rides")).toBeOnTheScreen();
  });

  it("reads in Arabic (RTL copy, Western digits)", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/scheduled-rides": {
        status: 200,
        body: [scheduledRide(), openScheduledRide()],
      },
    });
    await withProviders(<ScheduledRidesScreen />);
    expect(await screen.findByTestId(`scheduled-status-${SCHEDULED_ID}`)).toHaveTextContent(
      "تم تأكيد السائق",
    );
    expect(screen.getByTestId(`scheduled-status-${SCHEDULED_OPEN_ID}`)).toHaveTextContent(
      "بانتظار سائق",
    );
    expect(screen.getByTestId(`scheduled-card-${SCHEDULED_ID}`)).toHaveTextContent(/غداً/);
    expect(screen.getByText("جدولة رحلة")).toBeOnTheScreen();
    expect(screen.getByTestId(`scheduled-card-${SCHEDULED_ID}`)).not.toHaveTextContent(
      /[٠-٩]/,
    );
  });
});

describe("one scheduled ride", () => {
  it("shows the claim, reminders and cancels free", async () => {
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${SCHEDULED_ID}`]: { status: 200, body: scheduledRide() },
      [`GET /api/v1/rides/${SCHEDULED_ID}/cancellation-quote`]: {
        status: 200,
        body: { free: true, fee: null, currency: null, graceEndsAt: null },
      },
      [`POST /api/v1/rides/${SCHEDULED_ID}/cancel`]: {
        status: 200,
        body: scheduledRide({ state: "cancelled_by_rider" }),
      },
    });
    await withProviders(<ScheduledRideScreen rideId={SCHEDULED_ID} />);

    expect(await screen.findByTestId("scheduled-ride-status")).toHaveTextContent(
      "Driver confirmed",
    );
    expect(screen.getByTestId("scheduled-ride-driver")).toHaveTextContent(
      /Samer · 4\.9.*Silver Hyundai Accent · دمشق 502345/,
    );
    expect(screen.getByTestId("scheduled-ride-estimate")).toHaveTextContent(
      "~SYP 22,000 · at ride time",
    );
    expect(
      screen.getByText("We'll remind you 24 hours and 1 hour before pickup."),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("scheduled-ride-free-until")).toHaveTextContent(
      /Free cancellation until .*, when your ride starts\./,
    );

    await fireEvent.press(screen.getByTestId("scheduled-ride-cancel"));
    expect(await screen.findByTestId("scheduled-cancel-free")).toHaveTextContent(
      /Free — no cancellation fee.*Samer will be told\./,
    );
    await fireEvent.press(screen.getByTestId("scheduled-cancel-reason-wrong_pickup"));
    await fireEvent.press(screen.getByTestId("scheduled-cancel-confirm"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", `/api/v1/rides/${SCHEDULED_ID}/cancel`)[0].body).toEqual({
      reason: "wrong_pickup",
    });
  });

  it("hands over to the ride screen once the ride is live", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${SCHEDULED_ID}`]: {
        status: 200,
        body: scheduledRide({ state: "requested" }),
      },
    });
    await withProviders(<ScheduledRideScreen rideId={SCHEDULED_ID} />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(`/ride/${SCHEDULED_ID}`),
    );
  });
});

describe("pushes for pre-live rides", () => {
  it("opens the scheduled ride, not the live ride view", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${SCHEDULED_ID}`]: { status: 200, body: scheduledRide() },
    });
    await withProviders(<RideScreen rideId={SCHEDULED_ID} />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(`/scheduled/${SCHEDULED_ID}`),
    );
    expect(screen.queryByTestId("ride-view")).toBeNull();
  });

  it("opens a gathering shared ride on its own screen", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${SHARED_ID}`]: {
        status: 200,
        body: ride({ id: SHARED_ID, state: "gathering", kind: "shared" }),
      },
    });
    await withProviders(<RideScreen rideId={SHARED_ID} />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/shared/${SHARED_ID}`));
    expect(sharedRide().rideId).toBe(SHARED_ID);
  });

  it("explains a scheduled ride the system cancelled (rider_busy)", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${SCHEDULED_ID}`]: {
        status: 200,
        body: scheduledRide({
          state: "cancelled_by_rider",
          cancellationReason: "rider_busy",
        }),
      },
    });
    await withProviders(<RideScreen rideId={SCHEDULED_ID} />);
    expect(await screen.findByTestId("ride-ended-title")).toHaveTextContent(
      "Your scheduled ride was cancelled",
    );
    expect(screen.getByTestId("ride-ended-rider-busy")).toHaveTextContent(
      "You were still on another ride when it was due. You weren't charged.",
    );
  });
});

describe("home entries (approved artboard RiderM12Home)", () => {
  it("offers Later, the soonest upcoming ride and shared rides", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rider/saved-locations": { status: 200, body: [] },
      "GET /api/v1/scheduled-rides": {
        status: 200,
        body: [scheduledRide(), openScheduledRide()],
      },
    });
    await withProviders(<HomeScreen />);

    expect(await screen.findByTestId("home-upcoming")).toHaveTextContent(
      /Tomorrow · .*Damascus Airport · Driver confirmed.*2 scheduled/,
    );
    await fireEvent.press(screen.getByTestId("home-later"));
    expect(mockPush).toHaveBeenCalledWith("/schedule");
    await fireEvent.press(screen.getByTestId("home-upcoming"));
    expect(mockPush).toHaveBeenCalledWith("/scheduled");
    await fireEvent.press(screen.getByTestId("home-shared"));
    expect(mockPush).toHaveBeenCalledWith("/shared");
  });

  it("shows no upcoming card without scheduled rides", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rider/saved-locations": { status: 200, body: [] },
      "GET /api/v1/scheduled-rides": { status: 200, body: [] },
    });
    await withProviders(<HomeScreen />);
    expect(await screen.findByTestId("home-shared")).toBeOnTheScreen();
    expect(screen.queryByTestId("home-upcoming")).toBeNull();
  });
});

describe("booking now with a scheduled ride due within 60 min (ruling 2026-10-16)", () => {
  const dueSoon = () =>
    scheduledRide({
      scheduled: {
        scheduledAt: inMinutes(40),
        claimState: "claimed",
        pricedAtRideTime: true,
        claimedBy: scheduledRide().scheduled?.claimedBy,
      },
    });

  const routes = (extra: Record<string, unknown> = {}) => ({
    "GET /api/v1/rides/active": { status: 204 },
    "GET /api/v1/rider/preferences": { status: 200, body: preferencesFixture() },
    "GET /api/v1/rider/saved-locations": { status: 200, body: [savedWork] },
    "GET /api/v1/scheduled-rides": { status: 200, body: [dueSoon()] },
    "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
    "POST /api/v1/rides": { status: 201, body: ride() },
    ...extra,
  });

  async function planAndChoose() {
    await waitFor(() =>
      expect(screen.getByTestId("booking-input-pickup").props.value).toBe(
        "Current location",
      ),
    );
    await fireEvent.press(await screen.findByTestId(`booking-saved-${savedWork.id}`));
    await fireEvent.press(screen.getByTestId("booking-submit"));
    await fireEvent.press(await screen.findByTestId("booking-confirm"));
  }

  it("keeps it and books now", async () => {
    const api = mockApi(routes() as never);
    await withProviders(<BookingScreen />);
    await planAndChoose();

    expect(await screen.findByTestId("scheduled-warning-title")).toHaveTextContent(
      /You have a ride scheduled at .* — keep it\?/,
    );
    expect(api.callsTo("POST", "/api/v1/rides")).toHaveLength(0);
    await fireEvent.press(screen.getByTestId("scheduled-warning-keep"));
    await waitFor(() => expect(api.callsTo("POST", "/api/v1/rides")).toHaveLength(1));
    expect(api.callsTo("POST", `/api/v1/rides/${SCHEDULED_ID}/cancel`)).toHaveLength(0);
  });

  it("cancels the scheduled ride first, then books", async () => {
    const api = mockApi(
      routes({
        [`GET /api/v1/rides/${SCHEDULED_ID}/cancellation-quote`]: {
          status: 200,
          body: { free: true },
        },
        [`POST /api/v1/rides/${SCHEDULED_ID}/cancel`]: {
          status: 200,
          body: scheduledRide({ state: "cancelled_by_rider" }),
        },
      }) as never,
    );
    await withProviders(<BookingScreen />);
    await planAndChoose();

    await fireEvent.press(await screen.findByTestId("scheduled-warning-cancel"));
    await fireEvent.press(await screen.findByTestId("scheduled-cancel-confirm"));
    await waitFor(() => expect(api.callsTo("POST", "/api/v1/rides")).toHaveLength(1));
    expect(api.callsTo("POST", `/api/v1/rides/${SCHEDULED_ID}/cancel`)[0].body).toEqual({
      reason: "changed_mind",
    });
  });

  it("does not warn when the scheduled ride is further away", async () => {
    const api = mockApi(
      routes({
        "GET /api/v1/scheduled-rides": { status: 200, body: [scheduledRide()] },
      }) as never,
    );
    await withProviders(<BookingScreen />);
    await planAndChoose();
    await waitFor(() => expect(api.callsTo("POST", "/api/v1/rides")).toHaveLength(1));
    expect(screen.queryByTestId("scheduled-warning-title")).toBeNull();
  });
});

describe("realtime protocol", () => {
  it("never shows a scheduled ride frame as the ride on screen", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rider/saved-locations": { status: 200, body: [] },
      "GET /api/v1/scheduled-rides": { status: 200, body: [] },
    });
    await withProviders(<HomeScreen />);
    const socket = FakeSocket.latest();
    await act(async () => socket.open());
    await act(async () => socket.receive({ type: "ready" }));
    await act(async () =>
      socket.receive({ type: "ride.state", as: "rider", ride: scheduledRide() }),
    );
    expect(screen.queryByTestId("ride-view")).toBeNull();
    // …while a live ride frame still takes over home.
    await act(async () =>
      socket.receive({ type: "ride.state", as: "rider", ride: ride({ id: RIDE_ID }) }),
    );
    expect(await screen.findByTestId("ride-view")).toBeOnTheScreen();
  });
});

/**
 * M7-T3 screens around the ride against rides-v1.yaml mocks: in-ride route
 * change (UC-R-06, incl. E1 too_many_stops), history list, receipt from the
 * stored components (UC-R-07), saved places CRUD incl. duplicate_name
 * (UC-R-01), ride preferences (UC-R-02/03), the ride opened from a push
 * deep link (`ride` {rideId}) and the settings entries.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
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
import { renderWithProviders } from "../../../test-utils/render";
import {
  acceptedRide,
  FakeSocket,
  fakeSocketFactory,
  preferencesFixture,
  receiptFixture,
  RIDE_ID,
  savedHome,
  savedWork,
} from "../../../test-utils/ride-fixtures";
import ChangeRouteScreen from "../change-route-screen";
import ReceiptScreen from "../receipt-screen";
import RideHistoryScreen from "../ride-history-screen";
import RidePreferencesScreen from "../ride-preferences-screen";
import RideScreen from "../ride-screen";
import SavedPlacesScreen from "../saved-places-screen";
import SettingsScreen from "../../settings-screen";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => false,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const locationMock = Location as jest.Mocked<typeof Location>;

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
});

describe("in-ride route change (UC-R-06)", () => {
  const inProgress = acceptedRide({
    state: "in_progress",
    stops: [{ lat: 33.51, lng: 36.28, label: "Abu Rummaneh" }],
  });

  it("adds a stop from a saved place and updates the route", async () => {
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 200, body: inProgress },
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedHome] },
      [`PUT /api/v1/rides/${RIDE_ID}/route`]: {
        status: 200,
        body: { ...inProgress, stops: [...inProgress.stops, savedHome] },
      },
    });
    await withProviders(<ChangeRouteScreen focus="stop" />);

    expect(await screen.findByText("Change your route")).toBeOnTheScreen();
    // The pickup is fixed during the ride.
    expect(screen.queryByTestId("change-route-input-pickup")).toBeNull();
    expect(screen.getByTestId("change-route-field-pickup")).toHaveTextContent(
      "PickupMazzeh Autostrad",
    );
    await fireEvent.press(await screen.findByTestId(`change-route-saved-${savedHome.id}`));
    expect(screen.getByTestId("change-route-input-stop-1").props.value).toBe("Home");
    await fireEvent.press(screen.getByTestId("change-route-submit"));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("PUT", `/api/v1/rides/${RIDE_ID}/route`)[0].body).toEqual({
      destination: inProgress.destination,
      stops: [
        { lat: 33.51, lng: 36.28, label: "Abu Rummaneh" },
        { lat: savedHome.lat, lng: savedHome.lng, label: "Home" },
      ],
    });
  });

  it("rejects more than 3 stops (E1, 422 too_many_stops)", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 200, body: inProgress },
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedWork] },
      [`PUT /api/v1/rides/${RIDE_ID}/route`]: {
        status: 422,
        body: { status: 422, message: "Too many stops", code: "too_many_stops" },
      },
    });
    await withProviders(<ChangeRouteScreen />);
    await fireEvent.press(await screen.findByTestId(`change-route-saved-${savedWork.id}`));
    await fireEvent.press(screen.getByTestId("change-route-submit"));
    expect(await screen.findByTestId("change-route-error")).toHaveTextContent(
      "You can add up to 3 stops.",
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("is unavailable when the ride can no longer change", async () => {
    mockApi({ "GET /api/v1/rides/active": { status: 204 } });
    await withProviders(<ChangeRouteScreen />);
    expect(await screen.findByTestId("change-route-unavailable")).toBeOnTheScreen();
  });
});

describe("ride history (UC-R-07)", () => {
  it("lists every state newest first with totals, fees and receipts", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rides": {
        status: 200,
        body: {
          items: [
            {
              id: "r-done",
              state: "completed",
              requestedAt: "2026-10-08T09:29:00Z",
              pickup: { lat: 1, lng: 1, label: "Mazzeh" },
              destination: { lat: 2, lng: 2, label: "Umayyad Square" },
              serviceTypeNameEn: "Economy",
              serviceTypeNameAr: "اقتصادية",
              total: 27250,
              cancellationFee: null,
              currency: "SYP",
            },
            {
              id: "r-cancel",
              state: "cancelled_by_rider",
              requestedAt: "2026-10-05T09:29:00Z",
              pickup: { lat: 1, lng: 1, label: "Mazzeh" },
              destination: { lat: 2, lng: 2, label: "Mezzeh Villas" },
              serviceTypeNameEn: "Economy",
              serviceTypeNameAr: "اقتصادية",
              total: null,
              cancellationFee: 2000,
              currency: "SYP",
            },
            {
              id: "r-none",
              state: "no_driver_found",
              requestedAt: "2026-10-04T09:29:00Z",
              pickup: { lat: 1, lng: 1, label: "Mazzeh" },
              destination: { lat: 2, lng: 2, label: "Damascus University" },
              serviceTypeNameEn: "Economy",
              serviceTypeNameAr: "اقتصادية",
              total: null,
              cancellationFee: null,
              currency: "SYP",
            },
          ],
          page: 0,
          size: 20,
          totalItems: 3,
        },
      },
    });
    await withProviders(<RideHistoryScreen />);

    expect(await screen.findByText("Umayyad Square")).toBeOnTheScreen();
    expect(screen.getByTestId("history-amount-r-done")).toHaveTextContent("SYP 27,250");
    expect(screen.getByTestId("history-r-cancel")).toHaveTextContent(/Cancelled by you/);
    expect(screen.getByTestId("history-amount-r-cancel")).toHaveTextContent("SYP 2,000");
    expect(screen.getByText("Cancellation fee")).toBeOnTheScreen();
    expect(screen.getByTestId("history-r-none")).toHaveTextContent(/No driver found/);
    expect(screen.queryByTestId("history-load-more")).toBeNull();

    await fireEvent.press(screen.getByTestId("history-r-done"));
    expect(mockPush).toHaveBeenCalledWith("/receipt/r-done");
  });

  it("explains an empty history", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rides": {
        status: 200,
        body: { items: [], page: 0, size: 20, totalItems: 0 },
      },
    });
    await withProviders(<RideHistoryScreen />);
    expect(await screen.findByText("No rides yet")).toBeOnTheScreen();
  });
});

describe("receipt (UC-R-07 step 4, PRC-04)", () => {
  it("draws the trace route and lists the stored components", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}/receipt`]: { status: 200, body: receiptFixture() },
    });
    await withProviders(<ReceiptScreen rideId={RIDE_ID} />);

    expect(await screen.findByTestId("receipt-screen")).toBeOnTheScreen();
    const html = screen.getByTestId("receipt-map-webview").props.source.html as string;
    // receipt.route ([lng, lat]) is drawn in Leaflet order.
    expect(html).toContain('"route":[[33.5138,36.2765],[33.515,36.28],[33.5131,36.2913]]');
    expect(screen.getByTestId("receipt-fare-surcharge")).toHaveTextContent(
      "Time surcharge +25%SYP 5,450",
    );
    expect(screen.getByTestId("receipt-fare-total")).toHaveTextContent("TotalSYP 27,250");
    expect(screen.getByTestId("receipt-payment")).toHaveTextContent("Paid in cash");
    expect(screen.getByTestId("receipt-route-dropoff")).toHaveTextContent("Umayyad Square");
    await fireEvent.press(screen.getByTestId("receipt-back"));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe("saved places (UC-R-01)", () => {
  beforeEach(() => {
    const permission = {
      granted: true,
      status: "granted" as Location.PermissionStatus,
      canAskAgain: true,
      expires: "never" as const,
    };
    locationMock.requestForegroundPermissionsAsync.mockResolvedValue(permission);
    locationMock.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 33.5, longitude: 36.3 },
    } as Location.LocationObject);
    locationMock.watchPositionAsync.mockResolvedValue({
      remove: jest.fn(),
    } as unknown as Location.LocationSubscription);
  });

  it("adds a place from a pin, rejects a duplicate name, edits and deletes", async () => {
    const gym = { id: "g-1", name: "Gym", lat: 33.52, lng: 36.31, address: null };
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedHome] },
      "POST /api/v1/rider/saved-locations": [
        {
          status: 409,
          body: { status: 409, message: "Duplicate", code: "duplicate_name" },
        },
        { status: 201, body: gym },
      ],
      "PUT /api/v1/rider/saved-locations/g-1": {
        status: 200,
        body: { ...gym, name: "Gym 2" },
      },
      "DELETE /api/v1/rider/saved-locations/g-1": { status: 204 },
    });
    await withProviders(<SavedPlacesScreen />);

    expect(await screen.findByTestId(`saved-place-${savedHome.id}`)).toHaveTextContent(
      /Mazzeh, Damascus/,
    );

    // Name + pin (the map reports its centre after the rider pans).
    await fireEvent.changeText(screen.getByTestId("saved-name"), "Home");
    await waitFor(() =>
      expect(screen.getByTestId("saved-pick-location").props.accessibilityState).not.toEqual(
        expect.objectContaining({ disabled: true }),
      ),
    );
    await fireEvent.press(screen.getByTestId("saved-pick-location"));
    await act(async () => {
      fireEvent(screen.getByTestId("pin-picker-map-webview"), "message", {
        nativeEvent: { data: '{"type":"center","lat":33.52,"lng":36.31}' },
      });
    });
    await fireEvent.press(screen.getByTestId("pin-picker-confirm"));

    await fireEvent.press(screen.getByTestId("saved-save"));
    expect(await screen.findByTestId("saved-name-error")).toHaveTextContent(
      "You already have a place called “Home”. Try another name.",
    );
    expect(api.callsTo("POST", "/api/v1/rider/saved-locations")[0].body).toEqual({
      name: "Home",
      lat: 33.52,
      lng: 36.31,
      address: null,
    });

    await fireEvent.changeText(screen.getByTestId("saved-name"), "Gym");
    await fireEvent.press(screen.getByTestId("saved-save"));
    expect(await screen.findByTestId("saved-place-g-1")).toHaveTextContent(/Gym/);

    await fireEvent.press(screen.getByTestId("saved-edit-g-1"));
    expect(screen.getByText("Edit place")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("saved-name"), "Gym 2");
    await fireEvent.press(screen.getByTestId("saved-save"));
    expect(await screen.findByText("Gym 2")).toBeOnTheScreen();
    expect(api.callsTo("PUT", "/api/v1/rider/saved-locations/g-1")[0].body).toEqual({
      name: "Gym 2",
      lat: 33.52,
      lng: 36.31,
      address: null,
    });

    await fireEvent.press(screen.getByTestId("saved-edit-g-1"));
    await fireEvent.press(screen.getByTestId("saved-delete"));
    await waitFor(() => expect(screen.queryByTestId("saved-place-g-1")).toBeNull());
    expect(api.callsTo("DELETE", "/api/v1/rider/saved-locations/g-1")).toHaveLength(1);
  });

  it("needs a name and a pin", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rider/saved-locations": { status: 200, body: [] },
    });
    await withProviders(<SavedPlacesScreen />);
    expect(await screen.findByText("No saved places yet")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("saved-save"));
    expect(screen.getByTestId("saved-name-error")).toHaveTextContent("Enter a name.");
    await fireEvent.changeText(screen.getByTestId("saved-name"), "Work");
    await fireEvent.press(screen.getByTestId("saved-save"));
    expect(screen.getByTestId("saved-error")).toHaveTextContent(
      "Place the pin on the map.",
    );
  });
});

describe("ride preferences (UC-R-02, UC-R-03)", () => {
  it("saves one exclusive matching mode and the comfort values", async () => {
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rider/preferences": { status: 200, body: preferencesFixture() },
      "PUT /api/v1/rider/preferences": {
        status: 200,
        body: preferencesFixture({
          pickupDistanceMode: "accept_distant_fee",
          temperature: "warm",
          conversation: "chatty",
          music: "soft",
        }),
      },
    });
    await withProviders(<RidePreferencesScreen />);

    const nearby = await screen.findByTestId("ride-prefs-mode-nearby_only");
    expect(nearby.props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(screen.getByTestId("ride-prefs-mode-accept_distant_fee"));
    expect(screen.getByTestId("ride-prefs-mode-nearby_only").props.accessibilityState).toEqual({
      checked: false,
    });
    await fireEvent.press(screen.getByTestId("ride-prefs-temperature-warm"));
    await fireEvent.press(screen.getByTestId("ride-prefs-conversation-chatty"));
    await fireEvent.press(screen.getByTestId("ride-prefs-music-soft"));
    await fireEvent.press(screen.getByTestId("ride-prefs-save"));

    expect(await screen.findByTestId("ride-prefs-saved")).toHaveTextContent(
      "Preferences saved.",
    );
    expect(api.callsTo("PUT", "/api/v1/rider/preferences")[0].body).toEqual({
      temperature: "warm",
      conversation: "chatty",
      music: "soft",
      pickupDistanceMode: "accept_distant_fee",
    });
  });

  it("explains a failed save", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rider/preferences": { status: 200, body: preferencesFixture() },
      "PUT /api/v1/rider/preferences": { status: 400, body: { status: 400 } },
    });
    await withProviders(<RidePreferencesScreen />);
    await fireEvent.press(await screen.findByTestId("ride-prefs-save"));
    expect(await screen.findByTestId("ride-prefs-failed")).toBeOnTheScreen();
  });
});

describe("push deep link `ride` {rideId}", () => {
  it("opens the ride flow for that ride", async () => {
    const arrived = acceptedRide({ state: "driver_arrived" });
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 200, body: arrived },
      [`GET /api/v1/rides/${RIDE_ID}`]: { status: 200, body: arrived },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);
    expect(await screen.findByText("Your driver is here")).toBeOnTheScreen();
    expect(api.callsTo("GET", `/api/v1/rides/${RIDE_ID}`)).toHaveLength(1);
  });

  it("returns home after Done on an ended ride", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}`]: {
        status: 200,
        body: acceptedRide({ state: "cancelled_by_rider" }),
      },
    });
    await withProviders(<RideScreen rideId={RIDE_ID} />);
    await fireEvent.press(await screen.findByTestId("ride-done"));
    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});

describe("settings → ride screens", () => {
  it("opens history, saved places and ride preferences from settings", async () => {
    mockApi({});
    await renderWithProviders(<SettingsScreen />);
    await fireEvent.press(await screen.findByTestId("settings-rides"));
    expect(mockPush).toHaveBeenCalledWith("/rides");
    await fireEvent.press(screen.getByTestId("settings-saved-places"));
    expect(mockPush).toHaveBeenCalledWith("/saved-places");
    await fireEvent.press(screen.getByTestId("settings-ride-preferences"));
    expect(mockPush).toHaveBeenCalledWith("/ride-preferences");
  });
});

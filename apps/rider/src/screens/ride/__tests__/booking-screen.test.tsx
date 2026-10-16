/**
 * M7-T3 booking (UC-R-04, RIDE-01) against rides-v1.yaml mocks: pickup from
 * the current location, saved places as one-tap choices, ≤ 3 stops, the
 * matching-toggle line with comfort preferences, estimates labelled as
 * estimates (approximate flagged), cash only, and every booking error by
 * its contract code. Plus the RTL verification of the booking flow.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import React from "react";
import { StyleSheet } from "react-native";

import { LANGUAGE_STORAGE_KEY, LocaleProvider } from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  ECONOMY_ID,
  COMFORT_ID,
  estimateResponse,
  fakeSocketFactory,
  FakeSocket,
  preferencesFixture,
  ride,
  savedHome,
  savedWork,
} from "../../../test-utils/ride-fixtures";
import BookingScreen from "../booking-screen";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

// Icons render their name so the mirrored chevron can be asserted.
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: MockText } = require("react-native");
  return {
    Ionicons: ({ name }: { name: string }) => (
      <MockText testID={`icon-${name}`}>{name}</MockText>
    ),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const locationMock = Location as jest.Mocked<typeof Location>;

const HERE = { lat: 33.5138, lng: 36.2765 };

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
    coords: { latitude: HERE.lat, longitude: HERE.lng },
  } as Location.LocationObject);
  locationMock.watchPositionAsync.mockResolvedValue({
    remove: jest.fn(),
  } as unknown as Location.LocationSubscription);
}

const BASE_ROUTES = {
  "GET /api/v1/rides/active": { status: 204 },
  "GET /api/v1/rider/preferences": { status: 200, body: preferencesFixture() },
  "GET /api/v1/rider/saved-locations": {
    status: 200,
    body: [savedHome, savedWork],
  },
};

function renderBooking(props: React.ComponentProps<typeof BookingScreen> = {}) {
  return render(
    <LocaleProvider>
      <RideProvider socketFactory={fakeSocketFactory}>
        <BookingScreen {...props} />
      </RideProvider>
    </LocaleProvider>,
  );
}

/** Plan a trip Current location → Work and ask for prices. */
async function planToWork() {
  await waitFor(() =>
    expect(screen.getByTestId("booking-input-pickup").props.value).toBe(
      "Current location",
    ),
  );
  await fireEvent.press(await screen.findByTestId(`booking-saved-${savedWork.id}`));
  expect(screen.getByTestId("booking-input-destination").props.value).toBe("Work");
  await fireEvent.press(screen.getByTestId("booking-submit"));
}

function flat(style: unknown) {
  return StyleSheet.flatten(style as never) as Record<string, unknown>;
}

describe("booking (UC-R-04)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    FakeSocket.reset();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
    grantLocation();
  });

  it("plans a trip, shows estimates and books with cash", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/rides": { status: 201, body: ride() },
    });
    await renderBooking();

    expect(await screen.findByText("Plan your ride")).toBeOnTheScreen();
    // Matching toggle + comfort preferences are visible in booking.
    expect(await screen.findByTestId("booking-matching-mode")).toHaveTextContent(
      "Nearby drivers only",
    );
    expect(screen.getByTestId("booking-comfort")).toHaveTextContent(
      "Cool · Quiet · No pref.",
    );
    await fireEvent.press(screen.getByTestId("booking-matching"));
    expect(mockPush).toHaveBeenCalledWith("/ride-preferences");

    await planToWork();

    expect(await screen.findByText("Choose a ride")).toBeOnTheScreen();
    expect(api.callsTo("POST", "/api/v1/rides/estimate")[0].body).toEqual({
      pickup: { ...HERE, label: "Current location" },
      stops: [],
      destination: { lat: savedWork.lat, lng: savedWork.lng, label: "Work" },
    });
    expect(screen.getByTestId(`booking-price-${ECONOMY_ID}`)).toHaveTextContent(
      "SYP 22,000 est.",
    );
    expect(screen.getByTestId(`booking-price-${COMFORT_ID}`)).toHaveTextContent(
      "SYP 33,000 est.",
    );
    expect(
      screen.getByText(
        "Estimated fares — the final fare is metered on the actual route.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("booking-approximate")).toBeNull();
    expect(screen.getByTestId("booking-payment")).toHaveTextContent("Cash");
    expect(screen.queryByText(/wallet/i)).toBeNull();

    await fireEvent.press(screen.getByTestId(`booking-option-${COMFORT_ID}`));
    expect(screen.getByTestId("booking-confirm")).toHaveTextContent(
      "Choose Comfort",
    );
    await fireEvent.press(screen.getByTestId("booking-confirm"));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", "/api/v1/rides")[0].body).toEqual({
      pickup: { ...HERE, label: "Current location" },
      stops: [],
      destination: { lat: savedWork.lat, lng: savedWork.lng, label: "Work" },
      serviceTypeId: COMFORT_ID,
      paymentMethod: "cash",
      // PRC-02: the shown multiplier is always sent, also without surge.
      expectedSurgeMultiplier: 1,
    });
  });

  it("flags an approximate estimate (E2) and shows surge and the distant-fee rule", async () => {
    const approximate = estimateResponse({
      surgeMultiplier: 1.5,
      surgeActive: true,
      surgeZoneName: "Mazzeh",
      pickupDistanceMode: "accept_distant_fee",
      pickupFeeRule: { thresholdKm: 10, perKm: 500 },
    });
    approximate.route.approximate = true;
    approximate.options[0].estimate.approximate = true;
    mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: approximate },
    });
    await renderBooking();
    await planToWork();

    expect(await screen.findByTestId("booking-approximate")).toHaveTextContent(
      /Approximate estimate/,
    );
    expect(screen.getByTestId("booking-surge-title")).toHaveTextContent(
      "High demand in Mazzeh",
    );
    // M8 disclosure card (approved artboard RiderWalletShort).
    expect(screen.getByTestId("booking-pickup-fee-disclosure")).toHaveTextContent(
      /You accept distant drivers: beyond 10 km a pickup fee of SYP 500\/km is added\. It shows on your receipt\./,
    );
  });

  it("requires a destination before asking for prices", async () => {
    const api = mockApi(BASE_ROUTES);
    await renderBooking();
    await waitFor(() =>
      expect(screen.getByTestId("booking-input-pickup").props.value).toBe(
        "Current location",
      ),
    );
    await fireEvent.press(screen.getByTestId("booking-submit"));
    expect(await screen.findByTestId("booking-error")).toHaveTextContent(
      "Choose where you're going.",
    );
    expect(api.callsTo("POST", "/api/v1/rides/estimate")).toHaveLength(0);
  });

  it("adds at most 3 stops and searches saved places by typing", async () => {
    mockApi(BASE_ROUTES);
    await renderBooking();
    await screen.findByTestId(`booking-saved-${savedHome.id}`);

    await fireEvent.press(screen.getByTestId("booking-add-stop"));
    expect(screen.getByText("· 2 left")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("booking-input-stop-0"), "hom");
    await fireEvent.press(screen.getByTestId(`booking-match-${savedHome.id}`));
    expect(screen.getByTestId("booking-input-stop-0").props.value).toBe("Home");

    await fireEvent.press(screen.getByTestId("booking-add-stop"));
    await fireEvent.press(screen.getByTestId("booking-add-stop"));
    expect(screen.queryByTestId("booking-add-stop")).toBeNull();
    expect(screen.getByTestId("booking-field-stop-2")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId("booking-input-stop-2"), "zzz");
    expect(screen.getByTestId("booking-no-matches")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("booking-remove-stop-2"));
    expect(screen.getByTestId("booking-add-stop")).toBeOnTheScreen();
  });

  it.each([
    [
      "outside_region",
      "estimate",
      { status: 422, body: { status: 422, message: "x", code: "outside_region" } },
      "This trip is outside our service area.",
    ],
    [
      "too_many_stops",
      "estimate",
      { status: 422, body: { status: 422, message: "x", code: "too_many_stops" } },
      "You can add up to 3 stops.",
    ],
    [
      "service_type_unavailable",
      "book",
      {
        status: 422,
        body: { status: 422, message: "x", code: "service_type_unavailable" },
      },
      "This service isn't available here right now. Choose another one.",
    ],
    [
      "active_ride_exists",
      "book",
      { status: 409, body: { status: 409, message: "x", code: "active_ride_exists" } },
      "You already have an active ride.",
    ],
    [
      "rider_suspended (403)",
      "book",
      {
        status: 403,
        body: {
          status: 403,
          message: "x",
          code: "rider_suspended",
          details: { suspensionReason: "unpaid_balance" },
        },
      },
      "Your rider account is suspended (unpaid_balance).",
    ],
    [
      "payment_method_unavailable",
      "book",
      {
        status: 422,
        body: { status: 422, message: "x", code: "payment_method_unavailable" },
      },
      "Only cash is available right now.",
    ],
  ])("explains %s from the %s call", async (_name, step, reply, message) => {
    mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate":
        step === "estimate" ? reply : { status: 200, body: estimateResponse() },
      "POST /api/v1/rides": reply,
    });
    await renderBooking();
    await planToWork();
    if (step === "estimate") {
      expect(await screen.findByTestId("booking-error")).toHaveTextContent(message);
      expect(screen.queryByText("Choose a ride")).toBeNull();
      return;
    }
    await fireEvent.press(await screen.findByTestId("booking-confirm"));
    expect(await screen.findByTestId("booking-error")).toHaveTextContent(message);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("starts from a saved place tapped on home", async () => {
    mockApi(BASE_ROUTES);
    await renderBooking({ destinationId: savedHome.id });
    await waitFor(() =>
      expect(screen.getByTestId("booking-input-destination").props.value).toBe(
        "Home",
      ),
    );
  });

  it("edits the trip of a no-driver ride", async () => {
    mockApi({
      ...BASE_ROUTES,
      "GET /api/v1/rides/active": {
        status: 200,
        body: ride({
          state: "offering",
          stops: [{ lat: 33.51, lng: 36.28, label: "Abu Rummaneh" }],
        }),
      },
    });
    await renderBooking({ edit: true });
    await waitFor(() =>
      expect(screen.getByTestId("booking-input-stop-0").props.value).toBe(
        "Abu Rummaneh",
      ),
    );
    expect(screen.getByTestId("booking-input-destination").props.value).toBe(
      "Umayyad Square",
    );
  });
});

describe("booking in Arabic (RTL)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    FakeSocket.reset();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    grantLocation();
  });

  it("renders the plan and choose steps in Arabic with a mirrored layout", async () => {
    mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
    });
    await renderBooking();

    expect(await screen.findByText("خطّط لرحلتك")).toBeOnTheScreen();
    expect(screen.getByText("نقطة الانطلاق")).toBeOnTheScreen();
    expect(screen.getByText("إلى أين؟")).toBeOnTheScreen();
    expect(screen.getByText("عرض الأسعار")).toBeOnTheScreen();
    expect(await screen.findByText("السائقون القريبون فقط")).toBeOnTheScreen();
    expect(screen.getByText("تغيير")).toBeOnTheScreen();

    // Rows mirror (the test host launched LTR, so they flip by hand), text
    // runs right-to-left and inputs align right.
    expect(flat(screen.getByTestId("booking-field-destination").props.style).flexDirection).toBe(
      "row-reverse",
    );
    expect(flat(screen.getByTestId("booking-matching").props.style).flexDirection).toBe(
      "row-reverse",
    );
    const title = flat(screen.getByText("خطّط لرحلتك").props.style);
    expect(title.writingDirection).toBe("rtl");
    expect(title.textAlign).toBe("right");
    const input = flat(screen.getByTestId("booking-input-destination").props.style);
    expect(input.writingDirection).toBe("rtl");
    expect(input.textAlign).toBe("right");
    // The back button points right in RTL.
    expect(
      within(screen.getByTestId("booking-back")).getByTestId(
        "icon-chevron-forward",
      ),
    ).toBeOnTheScreen();

    await waitFor(() =>
      expect(screen.getByTestId("booking-input-pickup").props.value).toBe(
        "موقعك الحالي",
      ),
    );
    await fireEvent.press(screen.getByTestId(`booking-saved-${savedWork.id}`));
    await fireEvent.press(screen.getByTestId("booking-submit"));

    expect(await screen.findByText("اختر رحلتك")).toBeOnTheScreen();
    expect(screen.getByText("اقتصادية")).toBeOnTheScreen();
    // Western digits in an LTR isolate, currency "ل.س" (owner ruling).
    expect(screen.getByTestId(`booking-price-${ECONOMY_ID}`)).toHaveTextContent(
      "⁦22,000⁩ ل.س تقديريًا",
    );
    expect(
      screen.getByText("أسعار تقديرية — تُحتسب الأجرة النهائية حسب المسار الفعلي."),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("booking-payment")).toHaveTextContent("نقدًا");
    expect(screen.getByTestId("booking-confirm")).toHaveTextContent("اختر اقتصادية");
    expect(flat(screen.getByTestId(`booking-option-${ECONOMY_ID}`).props.style).flexDirection).toBe(
      "row-reverse",
    );
  });
});

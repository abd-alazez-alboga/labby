/**
 * M9-T2 rider surge (PRC-02, UC-R-04 A2) against rides-v1.yaml mocks —
 * approved artboards RiderSurgeChoose(+Ar) and RiderSurgeChanged:
 * - the choose step explains an active surge (banner, per-option "1.5×",
 *   locked-rate note, "Choose <type> · 1.5×") and is unchanged at 1.0;
 * - booking always sends the shown multiplier as `expectedSurgeMultiplier`;
 * - 409 `surge_changed` (the backend's real ErrorResponse shape) re-fetches
 *   the estimate and opens the price-changed sheet (up / down), whose
 *   confirm books again with the new value; back closes it on the refreshed
 *   options; a second 409 repeats the sheet with the newer value.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { StyleSheet } from "react-native";

import {
  LANGUAGE_STORAGE_KEY,
  LocaleProvider,
} from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  COMFORT_ID,
  ECONOMY_ID,
  estimateResponse,
  FakeSocket,
  fakeSocketFactory,
  preferencesFixture,
  ride,
  savedHome,
  savedWork,
  surgeEstimate,
} from "../../../test-utils/ride-fixtures";
import BookingScreen from "../booking-screen";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: jest.fn() }),
}));

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
const ESTIMATE = "POST /api/v1/rides/estimate";
const BOOK = "POST /api/v1/rides";

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

/** The backend's ErrorResponse for 409 surge_changed (RiderRideServiceImpl). */
function surgeChanged(current: number) {
  return {
    status: 409,
    body: {
      timestamp: "2026-10-13T10:00:00Z",
      status: 409,
      error: "Conflict",
      message: "The surge multiplier has changed; please review the new price",
      code: "surge_changed",
      details: { surgeMultiplier: current },
    },
  };
}

function renderBooking() {
  return render(
    <LocaleProvider>
      <RideProvider socketFactory={fakeSocketFactory}>
        <BookingScreen />
      </RideProvider>
    </LocaleProvider>,
  );
}

async function planToWork(pickupLabel = "Current location") {
  await waitFor(() =>
    expect(screen.getByTestId("booking-input-pickup").props.value).toBe(
      pickupLabel,
    ),
  );
  await fireEvent.press(await screen.findByTestId(`booking-saved-${savedWork.id}`));
  await fireEvent.press(screen.getByTestId("booking-submit"));
}

function flat(style: unknown) {
  return StyleSheet.flatten(style as never) as Record<string, unknown>;
}

async function setUp(language?: "ar") {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  if (language) await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  grantLocation();
}

describe("surge on the choose step (UC-R-04 A2)", () => {
  beforeEach(() => setUp());

  it("explains an active surge and books with the shown multiplier", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: { status: 200, body: surgeEstimate(1.5) },
      [BOOK]: { status: 201, body: ride({ surgeMultiplier: 1.5 }) },
    });
    await renderBooking();
    await planToWork();

    expect(await screen.findByTestId("booking-surge")).toBeOnTheScreen();
    expect(screen.getByTestId("booking-surge-chip")).toHaveTextContent("1.5×");
    expect(screen.getByTestId("icon-trending-up")).toBeOnTheScreen();
    expect(screen.getByTestId("booking-surge-title")).toHaveTextContent(
      "High demand in Mazzeh",
    );
    expect(screen.getByTestId("booking-surge-body")).toHaveTextContent(
      "More riders than drivers nearby, so fares are 1.5× right now. The rate is locked when you book.",
    );
    expect(screen.getByTestId(`booking-price-${ECONOMY_ID}`)).toHaveTextContent(
      "SYP 33,000 est.",
    );
    expect(screen.getByTestId(`booking-surge-${ECONOMY_ID}`)).toHaveTextContent("1.5×");
    expect(screen.getByTestId(`booking-surge-${COMFORT_ID}`)).toHaveTextContent("1.5×");
    expect(screen.getByTestId("booking-estimate-note")).toHaveTextContent(
      "Estimated fares — the final fare is metered on the actual route at the locked 1.5× rate.",
    );
    expect(screen.getByTestId("booking-confirm")).toHaveTextContent(
      "Choose Economy · 1.5×",
    );

    await fireEvent.press(screen.getByTestId("booking-confirm"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", "/api/v1/rides")[0].body).toEqual(
      expect.objectContaining({
        serviceTypeId: ECONOMY_ID,
        expectedSurgeMultiplier: 1.5,
      }),
    );
  });

  it("uses a generic title without a zone and formats two decimals", async () => {
    mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: { status: 200, body: surgeEstimate(1.25, null) },
    });
    await renderBooking();
    await planToWork();

    expect(await screen.findByTestId("booking-surge-title")).toHaveTextContent(
      "High demand nearby",
    );
    expect(screen.getByTestId("booking-surge-chip")).toHaveTextContent("1.25×");
    expect(screen.getByTestId("booking-confirm")).toHaveTextContent(
      "Choose Economy · 1.25×",
    );
  });

  it("shows the screen unchanged without surge and still sends 1.0", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: { status: 200, body: estimateResponse() },
      [BOOK]: { status: 201, body: ride() },
    });
    await renderBooking();
    await planToWork();

    expect(await screen.findByText("Choose a ride")).toBeOnTheScreen();
    expect(screen.queryByTestId("booking-surge")).toBeNull();
    expect(screen.queryByTestId(`booking-surge-${ECONOMY_ID}`)).toBeNull();
    expect(screen.queryByText(/×/)).toBeNull();
    expect(screen.getByTestId("booking-estimate-note")).toHaveTextContent(
      "Estimated fares — the final fare is metered on the actual route.",
    );
    expect(screen.getByTestId("booking-confirm")).toHaveTextContent(
      /^Choose Economy$/,
    );
    await fireEvent.press(screen.getByTestId("booking-confirm"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", "/api/v1/rides")[0].body).toEqual(
      expect.objectContaining({ expectedSurgeMultiplier: 1 }),
    );
  });
});

describe("price changed at booking (409 surge_changed)", () => {
  beforeEach(() => setUp());

  it("shows the price went up, refreshes the estimate and confirms at the new value", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: [
        { status: 200, body: surgeEstimate(1.5) },
        { status: 200, body: surgeEstimate(2) },
      ],
      [BOOK]: [surgeChanged(2), { status: 201, body: ride({ surgeMultiplier: 2 }) }],
    });
    await renderBooking();
    await planToWork();
    await fireEvent.press(await screen.findByTestId("booking-confirm"));

    expect(await screen.findByTestId("surge-changed-sheet")).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
    expect(api.callsTo("POST", "/api/v1/rides/estimate")).toHaveLength(2);
    expect(screen.getByTestId("surge-changed-chip")).toHaveTextContent(/2\.0×$/);
    expect(screen.getByTestId("surge-changed-title")).toHaveTextContent(
      "The price just went up",
    );
    expect(screen.getByTestId("surge-changed-body")).toHaveTextContent(
      "Demand in Mazzeh rose while you were choosing. Fares are now 2.0× instead of 1.5×. Nothing was booked yet.",
    );
    expect(screen.getByText("Economy · before")).toBeOnTheScreen();
    const before = screen.getByTestId("surge-changed-before");
    expect(before).toHaveTextContent("SYP 33,000");
    expect(flat(before.props.style).textDecorationLine).toBe("line-through");
    expect(screen.getByText("Economy · now")).toBeOnTheScreen();
    expect(screen.getByTestId("surge-changed-now")).toHaveTextContent("SYP 44,000");
    expect(
      screen.getByText("Estimate. The 2.0× rate is locked once you confirm."),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("surge-changed-confirm")).toHaveTextContent(
      "Confirm at 2.0×",
    );

    await fireEvent.press(screen.getByTestId("surge-changed-confirm"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const bookings = api.callsTo("POST", "/api/v1/rides");
    expect(bookings).toHaveLength(2);
    expect(bookings[0].body).toEqual(
      expect.objectContaining({ expectedSurgeMultiplier: 1.5 }),
    );
    expect(bookings[1].body).toEqual({
      pickup: { ...HERE, label: null },
      stops: [],
      destination: { lat: savedWork.lat, lng: savedWork.lng, label: "Work" },
      serviceTypeId: ECONOMY_ID,
      paymentMethod: "cash",
      expectedSurgeMultiplier: 2,
    });
  });

  it("says the price went down when the new multiplier is lower", async () => {
    mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: [
        { status: 200, body: surgeEstimate(1.5) },
        { status: 200, body: estimateResponse() },
      ],
      [BOOK]: surgeChanged(1),
    });
    await renderBooking();
    await planToWork();
    await fireEvent.press(await screen.findByTestId("booking-confirm"));

    expect(await screen.findByTestId("surge-changed-title")).toHaveTextContent(
      "The price just went down",
    );
    expect(screen.getByTestId("icon-trending-down")).toBeOnTheScreen();
    // The refreshed estimate has no zone any more: the shown one names it.
    expect(screen.getByTestId("surge-changed-body")).toHaveTextContent(
      "Demand in Mazzeh dropped while you were choosing. Fares are now 1.0× instead of 1.5×. Nothing was booked yet.",
    );
    expect(screen.getByTestId("surge-changed-before")).toHaveTextContent("SYP 33,000");
    expect(screen.getByTestId("surge-changed-now")).toHaveTextContent("SYP 22,000");
    expect(screen.getByTestId("surge-changed-confirm")).toHaveTextContent(
      "Confirm at 1.0×",
    );
  });

  it("goes back to the refreshed options", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: [
        { status: 200, body: surgeEstimate(1.5) },
        { status: 200, body: surgeEstimate(2) },
      ],
      [BOOK]: surgeChanged(2),
    });
    await renderBooking();
    await planToWork();
    await fireEvent.press(await screen.findByTestId(`booking-option-${COMFORT_ID}`));
    await fireEvent.press(screen.getByTestId("booking-confirm"));
    expect(await screen.findByText("Comfort · before")).toBeOnTheScreen();
    expect(screen.getByTestId("surge-changed-before")).toHaveTextContent("SYP 49,500");
    expect(screen.getByTestId("surge-changed-now")).toHaveTextContent("SYP 66,000");

    await fireEvent.press(screen.getByTestId("surge-changed-back"));
    await waitFor(() =>
      expect(screen.queryByTestId("surge-changed-sheet")).toBeNull(),
    );
    expect(mockBack).not.toHaveBeenCalled();
    expect(api.callsTo("POST", "/api/v1/rides")).toHaveLength(1);
    expect(screen.queryByTestId("booking-error")).toBeNull();
    // The options now show the refreshed estimate; the selection is kept.
    expect(screen.getByTestId("booking-surge-chip")).toHaveTextContent("2.0×");
    expect(screen.getByTestId(`booking-price-${ECONOMY_ID}`)).toHaveTextContent(
      "SYP 44,000 est.",
    );
    expect(screen.getByTestId("booking-confirm")).toHaveTextContent(
      "Choose Comfort · 2.0×",
    );
  });

  it("repeats the sheet with the newer value on a second 409", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: [
        { status: 200, body: surgeEstimate(1.5) },
        { status: 200, body: surgeEstimate(2) },
        { status: 200, body: surgeEstimate(2.5) },
      ],
      [BOOK]: [
        surgeChanged(2),
        surgeChanged(2.5),
        { status: 201, body: ride({ surgeMultiplier: 2.5 }) },
      ],
    });
    await renderBooking();
    await planToWork();
    await fireEvent.press(await screen.findByTestId("booking-confirm"));
    expect(await screen.findByTestId("surge-changed-confirm")).toHaveTextContent(
      "Confirm at 2.0×",
    );

    await fireEvent.press(screen.getByTestId("surge-changed-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("surge-changed-confirm")).toHaveTextContent(
        "Confirm at 2.5×",
      ),
    );
    expect(screen.getByTestId("surge-changed-body")).toHaveTextContent(
      /Fares are now 2\.5× instead of 2\.0×\./,
    );
    expect(screen.getByTestId("surge-changed-before")).toHaveTextContent("SYP 44,000");
    expect(screen.getByTestId("surge-changed-now")).toHaveTextContent("SYP 55,000");
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("surge-changed-confirm"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(
      api
        .callsTo("POST", "/api/v1/rides")
        .map((call) => (call.body as { expectedSurgeMultiplier: number })
          .expectedSurgeMultiplier),
    ).toEqual([1.5, 2, 2.5]);
  });
});

const SERVER_ERROR = {
  status: 500,
  body: { status: 500, error: "Internal Server Error", message: "Boom" },
};

describe("price changed — defensive branches", () => {
  beforeEach(() => setUp());

  it("offers the reported multiplier when the re-fetch fails, without a comparison", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: [{ status: 200, body: surgeEstimate(1.5) }, SERVER_ERROR],
      [BOOK]: [surgeChanged(2), { status: 201, body: ride({ surgeMultiplier: 2 }) }],
    });
    await renderBooking();
    await planToWork();
    await fireEvent.press(await screen.findByTestId("booking-confirm"));

    expect(await screen.findByTestId("surge-changed-sheet")).toBeOnTheScreen();
    expect(api.callsTo("POST", "/api/v1/rides/estimate")).toHaveLength(2);
    expect(screen.getByTestId("surge-changed-chip")).toHaveTextContent(/2\.0×$/);
    expect(screen.getByTestId("surge-changed-body")).toHaveTextContent(
      "Demand in Mazzeh rose while you were choosing. Fares are now 2.0× instead of 1.5×. Nothing was booked yet.",
    );
    expect(screen.queryByTestId("surge-changed-compare")).toBeNull();
    expect(screen.getByTestId("surge-changed-confirm")).toHaveTextContent(
      "Confirm at 2.0×",
    );

    await fireEvent.press(screen.getByTestId("surge-changed-confirm"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", "/api/v1/rides")[1].body).toEqual(
      expect.objectContaining({
        serviceTypeId: ECONOMY_ID,
        expectedSurgeMultiplier: 2,
      }),
    );
  });

  it("drops the stale prices on back after a failed re-fetch so they are requested again", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: [
        { status: 200, body: surgeEstimate(1.5) },
        SERVER_ERROR,
        { status: 200, body: surgeEstimate(2) },
      ],
      [BOOK]: surgeChanged(2),
    });
    await renderBooking();
    await planToWork();
    await fireEvent.press(await screen.findByTestId("booking-confirm"));
    await fireEvent.press(await screen.findByTestId("surge-changed-back"));

    // Back on the planner (same trip), not on the 1.5× options.
    expect(await screen.findByTestId("booking-submit")).toBeOnTheScreen();
    expect(screen.queryByTestId("booking-choose")).toBeNull();
    expect(screen.queryByTestId("surge-changed-sheet")).toBeNull();

    await fireEvent.press(screen.getByTestId("booking-submit"));
    expect(await screen.findByTestId("booking-surge-chip")).toHaveTextContent("2.0×");
    expect(screen.getByTestId(`booking-price-${ECONOMY_ID}`)).toHaveTextContent(
      "SYP 44,000 est.",
    );
    expect(api.callsTo("POST", "/api/v1/rides/estimate")).toHaveLength(3);
    expect(api.callsTo("POST", "/api/v1/rides")).toHaveLength(1);
  });

  it("returns to the refreshed options when the selected service is gone", async () => {
    const withoutComfort = surgeEstimate(2);
    withoutComfort.options = withoutComfort.options.filter(
      (item) => item.serviceTypeId !== COMFORT_ID,
    );
    const api = mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: [
        { status: 200, body: surgeEstimate(1.5) },
        { status: 200, body: withoutComfort },
      ],
      [BOOK]: surgeChanged(2),
    });
    await renderBooking();
    await planToWork();
    await fireEvent.press(await screen.findByTestId(`booking-option-${COMFORT_ID}`));
    await fireEvent.press(screen.getByTestId("booking-confirm"));

    expect(await screen.findByTestId("booking-error")).toHaveTextContent(
      "This service isn't available here right now. Choose another one.",
    );
    expect(screen.queryByTestId("surge-changed-sheet")).toBeNull();
    expect(screen.queryByTestId(`booking-option-${COMFORT_ID}`)).toBeNull();
    expect(screen.getByTestId("booking-confirm")).toHaveTextContent(
      "Choose Economy · 2.0×",
    );
    expect(api.callsTo("POST", "/api/v1/rides")).toHaveLength(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("closes the sheet and explains a non-surge error from its confirm", async () => {
    mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: [
        { status: 200, body: surgeEstimate(1.5) },
        { status: 200, body: surgeEstimate(2) },
      ],
      [BOOK]: [
        surgeChanged(2),
        {
          status: 409,
          body: { status: 409, message: "Active", code: "active_ride_exists" },
        },
      ],
    });
    await renderBooking();
    await planToWork();
    await fireEvent.press(await screen.findByTestId("booking-confirm"));
    await fireEvent.press(await screen.findByTestId("surge-changed-confirm"));

    expect(await screen.findByTestId("booking-error")).toHaveTextContent(
      "You already have an active ride.",
    );
    expect(screen.queryByTestId("surge-changed-sheet")).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe("surge in Arabic (RTL)", () => {
  beforeEach(() => setUp("ar"));

  it("renders the surge choose step and the changed sheet in Arabic with Western digits", async () => {
    mockApi({
      ...BASE_ROUTES,
      [ESTIMATE]: [
        { status: 200, body: surgeEstimate(1.5, "المزة") },
        { status: 200, body: surgeEstimate(2, "المزة") },
      ],
      [BOOK]: surgeChanged(2),
    });
    await renderBooking();
    await planToWork("موقعك الحالي");

    const banner = await screen.findByTestId("booking-surge");
    expect(flat(banner.props.style).flexDirection).toBe("row-reverse");
    expect(screen.getByTestId("booking-surge-chip")).toHaveTextContent("⁦1.5×⁩");
    expect(screen.getByTestId("booking-surge-title")).toHaveTextContent(
      "طلب مرتفع في المزة",
    );
    expect(screen.getByTestId("booking-surge-body")).toHaveTextContent(
      "عدد الركاب أكبر من عدد السائقين القريبين، لذلك الأجرة الآن ⁦1.5×⁩. يُثبَّت السعر لحظة الحجز.",
    );
    expect(flat(screen.getByTestId("booking-surge-title").props.style).writingDirection).toBe(
      "rtl",
    );
    expect(screen.getByTestId(`booking-price-${ECONOMY_ID}`)).toHaveTextContent(
      "⁦33,000⁩ ل.س تقديريًا",
    );
    expect(screen.getByTestId(`booking-surge-${ECONOMY_ID}`)).toHaveTextContent("⁦1.5×⁩");
    expect(screen.getByTestId("booking-estimate-note")).toHaveTextContent(
      "أجور تقديرية — تُحسب الأجرة النهائية حسب المسار الفعلي بسعر ⁦1.5×⁩ المثبَّت.",
    );
    expect(screen.getByTestId("booking-confirm")).toHaveTextContent(
      "اختر اقتصادية · ⁦1.5×⁩",
    );
    expect(screen.getByTestId("booking-choose")).not.toHaveTextContent(/[٠-٩]/);

    await fireEvent.press(screen.getByTestId("booking-confirm"));
    const sheet = await screen.findByTestId("surge-changed-sheet");
    expect(screen.getByTestId("surge-changed-title")).toHaveTextContent(
      "ارتفع السعر للتو",
    );
    expect(screen.getByTestId("surge-changed-body")).toHaveTextContent(
      "ارتفع الطلب في المزة أثناء اختيارك. الأجرة الآن ⁦2.0×⁩ بدلًا من ⁦1.5×⁩. لم يُحجز أي شيء بعد.",
    );
    expect(screen.getByText("اقتصادية · قبل")).toBeOnTheScreen();
    expect(screen.getByTestId("surge-changed-before")).toHaveTextContent("⁦33,000⁩ ل.س");
    expect(screen.getByText("اقتصادية · الآن")).toBeOnTheScreen();
    expect(screen.getByTestId("surge-changed-now")).toHaveTextContent("⁦44,000⁩ ل.س");
    expect(screen.getByTestId("surge-changed-confirm")).toHaveTextContent(
      "تأكيد بسعر ⁦2.0×⁩",
    );
    expect(screen.getByTestId("surge-changed-back")).toHaveTextContent(
      "العودة إلى الخيارات",
    );
    expect(flat(screen.getByTestId("surge-changed-chip").props.style).flexDirection).toBe(
      "row-reverse",
    );
    expect(sheet).not.toHaveTextContent(/[٠-٩]/);
  });
});

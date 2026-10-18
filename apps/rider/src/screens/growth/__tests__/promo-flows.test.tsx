/**
 * M13-T3 promo entry in on-demand booking (UC-R-04 A1, GRW-01/02) against
 * growth-v1 mocks — approved artboards R13PromoChoose and R13PromoErrors:
 * validate before booking (the estimate stays promo-free), the applied chip
 * with terms + Remove, ONE refusal message at a time per contract code,
 * `promoCode` on POST /rides, a booking-time promo refusal explained, and
 * the stored `discount` component on the receipt.
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

import { LocaleProvider } from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import { promoValidation } from "../../../test-utils/growth-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  components,
  ECONOMY_ID,
  estimateResponse,
  FakeSocket,
  fakeSocketFactory,
  preferencesFixture,
  receiptFixture,
  ride,
  RIDE_ID,
  savedHome,
  savedWork,
} from "../../../test-utils/ride-fixtures";
import ReceiptScreen from "../../ride/receipt-screen";
import BookingScreen from "../../ride/booking-screen";

jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: MockText } = require("react-native");
  return {
    Ionicons: ({ name }: { name: string }) => (
      <MockText testID={`icon-${name}`}>{name}</MockText>
    ),
  };
});

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
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

const BASE_ROUTES = {
  "GET /api/v1/rides/active": { status: 204 },
  "GET /api/v1/rider/preferences": { status: 200, body: preferencesFixture() },
  "GET /api/v1/rider/saved-locations": {
    status: 200,
    body: [savedHome, savedWork],
  },
  "GET /api/v1/scheduled-rides": { status: 200, body: [] },
};

function renderBooking() {
  return render(
    <LocaleProvider>
      <RideProvider socketFactory={fakeSocketFactory}>
        <BookingScreen />
      </RideProvider>
    </LocaleProvider>,
  );
}

async function planToWork() {
  await waitFor(() =>
    expect(screen.getByTestId("booking-input-pickup").props.value).toBe(
      "Current location",
    ),
  );
  await fireEvent.press(
    await screen.findByTestId(`booking-saved-${savedWork.id}`),
  );
  await fireEvent.press(screen.getByTestId("booking-submit"));
}

async function applyCode(code: string) {
  await fireEvent.press(await screen.findByTestId("booking-promo-add"));
  await fireEvent.changeText(
    await screen.findByTestId("booking-promo-input"),
    code,
  );
  await fireEvent.press(screen.getByTestId("booking-promo-apply"));
}

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  grantLocation();
});

describe("promo in on-demand booking (UC-R-04 A1)", () => {
  it("validates, shows the chip with terms, books with promoCode", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/promos/validate": { status: 200, body: promoValidation() },
      "POST /api/v1/rides": { status: 201, body: ride() },
    });
    renderBooking();
    await planToWork();
    await applyCode("welcome20");

    // Chip per R13PromoChoose: code + terms; the option price is untouched.
    const chip = await screen.findByTestId("booking-promo-applied");
    expect(chip).toHaveTextContent(/WELCOME20 applied/);
    expect(chip).toHaveTextContent(
      /20% off, up to SYP 10,000 — taken off the final fare at the end of the ride\./,
    );
    expect(screen.getByTestId(`booking-price-${ECONOMY_ID}`)).toHaveTextContent(
      "SYP 22,000 est.",
    );
    // The validate call carried the full booking context.
    expect(api.callsTo("POST", "/api/v1/promos/validate")[0].body).toEqual({
      code: "welcome20",
      regionId: "44444444-4444-4444-8444-444444444444",
      serviceTypeId: ECONOMY_ID,
      estimateTotal: 22000,
    });

    await fireEvent.press(screen.getByTestId("booking-confirm"));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/v1/rides").length).toBe(1),
    );
    expect(api.callsTo("POST", "/api/v1/rides")[0].body).toMatchObject({
      serviceTypeId: ECONOMY_ID,
      promoCode: "WELCOME20",
    });
  });

  it("books WITHOUT promoCode after Remove", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/promos/validate": { status: 200, body: promoValidation() },
      "POST /api/v1/rides": { status: 201, body: ride() },
    });
    renderBooking();
    await planToWork();
    await applyCode("WELCOME20");
    await fireEvent.press(await screen.findByTestId("booking-promo-remove"));
    expect(screen.queryByTestId("booking-promo-applied")).toBeNull();

    await fireEvent.press(screen.getByTestId("booking-confirm"));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/v1/rides").length).toBe(1),
    );
    expect(
      (api.callsTo("POST", "/api/v1/rides")[0].body as Record<string, unknown>)
        .promoCode,
    ).toBeUndefined();
  });

  it("shows one refusal message at a time, by contract code", async () => {
    const refusals: [number, string, string][] = [
      [404, "promo_not_found", "We don't know this code. Check the spelling and try again."],
      [409, "promo_window", "This code isn't available right now."],
      [409, "promo_exhausted", "This code has run out. All its uses are taken."],
      [409, "promo_user_limit", "You've already used this code the most times it allows."],
      [409, "promo_first_ride_only", "This code is for first rides only."],
      [409, "promo_wrong_region", "This code doesn't work in this area."],
      [409, "promo_wrong_service", "This code doesn't work for this ride type."],
    ];
    mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/promos/validate": refusals.map(([status, code]) => ({
        status,
        body: { status, message: code, code },
      })),
    });
    renderBooking();
    await planToWork();
    await applyCode("SUMMER10");
    for (const [, , message] of refusals) {
      expect(await screen.findByText(message)).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId("booking-promo-apply"));
    }
    // No chip was ever applied.
    expect(screen.queryByTestId("booking-promo-applied")).toBeNull();
  });

  it("explains a booking-time promo refusal without booking", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/promos/validate": { status: 200, body: promoValidation() },
      "POST /api/v1/rides": {
        status: 409,
        body: { status: 409, message: "exhausted", code: "promo_exhausted" },
      },
    });
    renderBooking();
    await planToWork();
    await applyCode("WELCOME20");
    await screen.findByTestId("booking-promo-applied");
    await fireEvent.press(screen.getByTestId("booking-confirm"));

    expect(await screen.findByTestId("booking-error")).toHaveTextContent(
      "This code has run out. All its uses are taken.",
    );
    expect(api.callsTo("POST", "/api/v1/rides").length).toBe(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("re-validates when another service type is picked", async () => {
    const estimate = estimateResponse();
    const comfortId = estimate.options[1].serviceTypeId;
    const api = mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimate },
      "POST /api/v1/promos/validate": [
        { status: 200, body: promoValidation() },
        {
          status: 409,
          body: { status: 409, message: "wrong", code: "promo_wrong_service" },
        },
      ],
    });
    renderBooking();
    await planToWork();
    await applyCode("WELCOME20");
    await screen.findByTestId("booking-promo-applied");

    await fireEvent.press(screen.getByTestId(`booking-option-${comfortId}`));
    // The code doesn't fit the new option: chip dropped, explained inline.
    expect(await screen.findByTestId("booking-promo-row-error")).toHaveTextContent(
      "This code doesn't work for this ride type.",
    );
    expect(screen.queryByTestId("booking-promo-applied")).toBeNull();
    expect(
      api.callsTo("POST", "/api/v1/promos/validate")[1].body,
    ).toMatchObject({ code: "WELCOME20", serviceTypeId: comfortId });
  });
});

describe("promo discount on the receipt (GRW-02)", () => {
  it("renders the stored discount component as its own line", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/rides/${RIDE_ID}/receipt`]: {
        status: 200,
        body: receiptFixture({
          fare: {
            distanceMeters: 5200,
            durationSeconds: 840,
            components: components({ discount: 4400, total: 17400 }),
          },
        }),
      },
      [`GET /api/v1/rides/${RIDE_ID}`]: { status: 200, body: ride() },
    });
    await render(
      <LocaleProvider>
        <ReceiptScreen rideId={RIDE_ID} />
      </LocaleProvider>,
    );
    const line = await screen.findByTestId("receipt-fare-discount");
    expect(line).toHaveTextContent(/Discount/);
    expect(line).toHaveTextContent(/SYP -4,400/);
    expect(screen.getByTestId("receipt-fare-total")).toHaveTextContent(
      /SYP 17,400/,
    );
  });
});

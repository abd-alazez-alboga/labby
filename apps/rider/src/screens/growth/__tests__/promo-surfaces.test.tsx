/**
 * M13-T3 promo on the other booking surfaces (growth-v1 rulings 2 + 3):
 * - scheduling: validated with `scheduledAt` (no estimate — the amount is
 *   worked out at ride time, the chip says so), `promoCode` on
 *   POST /scheduled-rides;
 * - shared create: `promoCode` on POST /shared-rides (creator's own seat);
 * - shared join: `promoCode` on the join call, and the one-promo-per-ride
 *   409 `promo_already_applied` explained.
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
import { member, SHARED_ID, sharedRide } from "../../../test-utils/m12-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  ECONOMY_ID,
  estimateResponse,
  FakeSocket,
  fakeSocketFactory,
  ride,
  savedWork,
} from "../../../test-utils/ride-fixtures";
import ScheduleScreen from "../../scheduled/schedule-screen";
import SharedCreateScreen from "../../shared/shared-create-screen";
import SharedRideScreen from "../../shared/shared-ride-screen";

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

async function applyCode(prefix: string, code: string) {
  await fireEvent.press(await screen.findByTestId(`${prefix}-add`));
  await fireEvent.changeText(await screen.findByTestId(`${prefix}-input`), code);
  await fireEvent.press(screen.getByTestId(`${prefix}-apply`));
  await screen.findByTestId(`${prefix}-applied`);
}

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  grantLocation();
});

describe("promo on a scheduled booking (ruling 3)", () => {
  // Friday 16 Oct 2026, 10:00 local — only Date is faked.
  const NOW = new Date(2026, 9, 16, 10, 0, 0);

  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
        "queueMicrotask",
        "hrtime",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
      ],
    });
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("validates with scheduledAt and schedules with promoCode", async () => {
    const scheduledAt = new Date(2026, 9, 17, 10, 30, 0).toISOString();
    const api = mockApi({
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedWork] },
      "POST /api/v1/rides/estimate": {
        status: 200,
        body: estimateResponse({ pricedAtRideTime: true }),
      },
      "POST /api/v1/promos/validate": {
        status: 200,
        body: promoValidation({ discountPreview: null }),
      },
      "POST /api/v1/scheduled-rides": {
        status: 201,
        body: ride({ state: "scheduled", kind: "scheduled" }),
      },
    });
    await render(
      <LocaleProvider>
        <ScheduleScreen />
      </LocaleProvider>,
    );
    await fireEvent.press(await screen.findByTestId("schedule-when-day-1"));
    await fireEvent.press(screen.getByTestId("schedule-when-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("schedule-plan-input-pickup").props.value).toBe(
        "Current location",
      ),
    );
    await fireEvent.press(
      await screen.findByTestId(`schedule-plan-saved-${savedWork.id}`),
    );
    await fireEvent.press(screen.getByTestId("schedule-plan-submit"));

    await applyCode("schedule-promo", "WELCOME20");
    // Ruling 3: reserved now, the amount worked out at ride time.
    expect(screen.getByTestId("schedule-promo-applied")).toHaveTextContent(
      /reserved now, worked out against the price at ride time\./,
    );
    expect(api.callsTo("POST", "/api/v1/promos/validate")[0].body).toEqual({
      code: "WELCOME20",
      regionId: "44444444-4444-4444-8444-444444444444",
      serviceTypeId: ECONOMY_ID,
      scheduledAt,
    });

    await fireEvent.press(screen.getByTestId("schedule-confirm"));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/v1/scheduled-rides").length).toBe(1),
    );
    expect(
      api.callsTo("POST", "/api/v1/scheduled-rides")[0].body,
    ).toMatchObject({ scheduledAt, promoCode: "WELCOME20" });
  });
});

describe("promo on a shared ride (ruling 2)", () => {
  it("creates a shared ride with promoCode on the creator's seat", async () => {
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/rider/saved-locations": { status: 200, body: [savedWork] },
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/promos/validate": { status: 200, body: promoValidation() },
      "POST /api/v1/shared-rides": {
        status: 201,
        body: sharedRide({ isCreator: true, me: member({ isCreator: true }) }),
      },
    });
    await withProviders(<SharedCreateScreen />);
    await waitFor(() =>
      expect(
        screen.getByTestId("shared-create-route-input-pickup").props.value,
      ).toBe("Current location"),
    );
    await fireEvent.press(
      await screen.findByTestId(`shared-create-route-saved-${savedWork.id}`),
    );
    await fireEvent.press(screen.getByTestId("shared-create-route-submit"));

    await applyCode("shared-create-promo", "WELCOME20");
    // Ruling 2: the chip says the discount is on the member's own seat.
    expect(screen.getByTestId("shared-create-promo-applied")).toHaveTextContent(
      /taken off your own seat share at the end of the ride\./,
    );
    await fireEvent.press(screen.getByTestId("shared-create-publish"));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/v1/shared-rides").length).toBe(1),
    );
    expect(api.callsTo("POST", "/api/v1/shared-rides")[0].body).toMatchObject({
      promoCode: "WELCOME20",
    });
  });

  it("joins with promoCode and explains promo_already_applied", async () => {
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [`GET /api/v1/shared-rides/${SHARED_ID}`]: {
        status: 200,
        body: sharedRide(),
      },
      "POST /api/v1/promos/validate": { status: 200, body: promoValidation() },
      [`POST /api/v1/shared-rides/${SHARED_ID}/join`]: {
        status: 409,
        body: {
          status: 409,
          message: "already",
          code: "promo_already_applied",
        },
      },
    });
    await withProviders(<SharedRideScreen rideId={SHARED_ID} />);
    await screen.findByTestId("shared-ride-join");

    await applyCode("shared-ride-promo", "WELCOME20");
    await fireEvent.press(screen.getByTestId("shared-ride-join"));

    expect(
      await screen.findByTestId("shared-ride-error-banner"),
    ).toHaveTextContent(/This ride already has a promo code\./);
    expect(
      api.callsTo("POST", `/api/v1/shared-rides/${SHARED_ID}/join`)[0].body,
    ).toEqual({ partySize: 1, paymentMethod: "cash", promoCode: "WELCOME20" });
  });
});

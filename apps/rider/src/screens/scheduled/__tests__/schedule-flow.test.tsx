/**
 * M12-T3 scheduling (UC-R-10, RIDE-S1) against scheduled-shared-v1.yaml
 * mocks: the pickup-time sheet (≥ 30 min ahead, "Other date" with no
 * horizon), the estimate for that time flagged "priced at ride time",
 * `POST /scheduled-rides`, and E1 — too soon (client check and the
 * backend's 422 `scheduled_too_soon`) never books on demand silently: "Book
 * now instead" hands the planned route to booking.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  estimateResponse,
  ride,
  savedHome,
  savedWork,
} from "../../../test-utils/ride-fixtures";
import ScheduleScreen from "../schedule-screen";

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const locationMock = Location as jest.Mocked<typeof Location>;

// Friday 16 Oct 2026, 10:00 local — only Date is faked.
const NOW = new Date(2026, 9, 16, 10, 0, 0);

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

const BASE = {
  "GET /api/v1/rider/saved-locations": { status: 200, body: [savedHome, savedWork] },
};

function renderSchedule() {
  return render(
    <LocaleProvider>
      <ScheduleScreen />
    </LocaleProvider>,
  );
}

/** Tomorrow 10:30 picked, then Current location → Work, "See prices". */
async function pickTomorrowAndPlan() {
  await fireEvent.press(await screen.findByTestId("schedule-when-day-1"));
  expect(screen.getByTestId("schedule-when-submit")).toHaveTextContent(
    /Pick up tomorrow · 10:30/,
  );
  await fireEvent.press(screen.getByTestId("schedule-when-submit"));
  await waitFor(() =>
    expect(screen.getByTestId("schedule-plan-input-pickup").props.value).toBe(
      "Current location",
    ),
  );
  await fireEvent.press(await screen.findByTestId(`schedule-plan-saved-${savedWork.id}`));
  await fireEvent.press(screen.getByTestId("schedule-plan-submit"));
}

describe("schedule a ride (UC-R-10)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
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
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
    grantLocation();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("schedules for tomorrow with the estimate priced at ride time", async () => {
    const scheduledAt = new Date(2026, 9, 17, 10, 30, 0).toISOString();
    const api = mockApi({
      ...BASE,
      "POST /api/v1/rides/estimate": {
        status: 200,
        body: estimateResponse({ pricedAtRideTime: true }),
      },
      "POST /api/v1/scheduled-rides": {
        status: 201,
        body: ride({ state: "scheduled", kind: "scheduled" }),
      },
    });
    await renderSchedule();

    expect(await screen.findByText("When should we pick you up?")).toBeOnTheScreen();
    // Earliest slot by default: now + 30 min.
    expect(screen.getByTestId("schedule-when-submit")).toHaveTextContent(
      /Pick up today · 10:30/,
    );
    expect(
      screen.getByText(
        "Book at least 30 minutes ahead. A driver can claim your ride any time before pickup.",
      ),
    ).toBeOnTheScreen();

    await pickTomorrowAndPlan();

    expect(await screen.findByTestId("schedule-priced-at-ride-time")).toHaveTextContent(
      /Priced at ride time/,
    );
    expect(api.callsTo("POST", "/api/v1/rides/estimate")[0].body).toEqual({
      pickup: { lat: 33.5138, lng: 36.2765, label: "Current location" },
      destination: { lat: savedWork.lat, lng: savedWork.lng, label: "Work" },
      stops: [],
      scheduledAt,
    });
    expect(screen.getByTestId("schedule-time-chip")).toHaveTextContent(
      /Pickup tomorrow · 10:30/,
    );
    expect(screen.getAllByText("at ride time").length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByTestId("schedule-payment-change"));
    expect(screen.getByTestId("schedule-payment")).toHaveTextContent("Wallet");
    await fireEvent.press(screen.getByTestId("schedule-confirm"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/scheduled"));
    const body = api.callsTo("POST", "/api/v1/scheduled-rides")[0].body as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      serviceTypeId: estimateResponse().options[0].serviceTypeId,
      paymentMethod: "wallet",
      scheduledAt,
    });
    expect(body).not.toHaveProperty("expectedSurgeMultiplier");
  });

  it("rejects a time under 30 min ahead before planning (client check)", async () => {
    mockApi(BASE);
    await renderSchedule();

    await fireEvent.press(await screen.findByTestId("schedule-when-hour-prev"));
    expect(screen.getByTestId("schedule-when-submit")).toHaveTextContent(
      /Pick up today · 9:30/,
    );
    await fireEvent.press(screen.getByTestId("schedule-when-submit"));

    expect(await screen.findByText("That's too soon to schedule")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Scheduled rides need at least 30 minutes' notice. Book now and we'll find you a driver right away.",
      ),
    ).toBeOnTheScreen();
    // "Pick another time" reopens the sheet; nothing was planned.
    await fireEvent.press(screen.getByTestId("schedule-pick-another"));
    expect(await screen.findByTestId("schedule-when-submit")).toBeOnTheScreen();
    expect(screen.queryByTestId("schedule-plan-submit")).toBeNull();
  });

  it("422 scheduled_too_soon offers booking now with the planned route", async () => {
    mockApi({
      ...BASE,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/scheduled-rides": {
        status: 422,
        body: {
          status: 422,
          message: "Too soon",
          code: "scheduled_too_soon",
          details: { minLeadMinutes: 45 },
        },
      },
    });
    await renderSchedule();
    await pickTomorrowAndPlan();
    await fireEvent.press(await screen.findByTestId("schedule-confirm"));

    expect(
      await screen.findByText(
        "Scheduled rides need at least 45 minutes' notice. Book now and we'll find you a driver right away.",
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("schedule-book-now"));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const href = String(mockReplace.mock.calls[0][0]);
    expect(href.startsWith("/booking?route=")).toBe(true);
    const route = JSON.parse(decodeURIComponent(href.slice("/booking?route=".length)));
    expect(route.destination).toEqual({
      lat: savedWork.lat,
      lng: savedWork.lng,
      label: "Work",
    });
  });

  it("403 rider_suspended opens the booking-refused sheet (W39)", async () => {
    mockApi({
      ...BASE,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "POST /api/v1/scheduled-rides": {
        status: 403,
        body: {
          status: 403,
          message: "x",
          code: "rider_suspended",
          details: { suspensionReason: "low_rating" },
        },
      },
    });
    await renderSchedule();
    await pickTomorrowAndPlan();
    await fireEvent.press(await screen.findByTestId("schedule-confirm"));

    expect(await screen.findByTestId("booking-refused-body")).toHaveTextContent(
      "Your rider account is suspended. Your average rider rating fell below the minimum allowed in your area.",
    );
    expect(screen.getByTestId("booking-refused-support")).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("booking-refused-close"));
    expect(screen.queryByTestId("booking-refused")).toBeNull();
  });

  it("'Ride now instead' goes to on-demand booking", async () => {
    mockApi(BASE);
    await renderSchedule();
    await fireEvent.press(await screen.findByTestId("schedule-when-secondary"));
    expect(mockReplace).toHaveBeenCalledWith("/booking");
  });

  it("'Other date' steps day by day with no horizon limit", async () => {
    mockApi(BASE);
    await renderSchedule();
    await fireEvent.press(await screen.findByTestId("schedule-when-other-date"));
    expect(screen.getByTestId("schedule-when-day-label")).toHaveTextContent(/19/);
    for (let i = 0; i < 40; i += 1) {
      await fireEvent.press(screen.getByTestId("schedule-when-day-next"));
    }
    // 16 Oct + 3 + 40 days = 28 Nov.
    expect(screen.getByTestId("schedule-when-day-label")).toHaveTextContent(/Nov 28/);
    expect(screen.getByTestId("schedule-when-submit")).toHaveTextContent(/Nov 28/);
  });
});

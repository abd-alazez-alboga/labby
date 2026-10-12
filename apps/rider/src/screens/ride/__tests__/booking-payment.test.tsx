/**
 * M8-T3 booking payment choice (PAY-02, UC-R-04) against money-v1.yaml
 * mocks: cash ⇄ wallet toggle, the wallet-shortfall preview from GET /wallet
 * vs the selected estimate (approved artboard RiderWalletShort), the
 * wallet-covers-all and balance-failed states, booking with
 * paymentMethod=wallet, and the pickup-distance fee disclosure card shown
 * only for accept_distant_fee riders.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import { walletView } from "../../../test-utils/money-fixtures";
import {
  components,
  estimateResponse,
  FakeSocket,
  fakeSocketFactory,
  preferencesFixture,
  ride,
  savedHome,
  savedWork,
} from "../../../test-utils/ride-fixtures";
import BookingScreen from "../booking-screen";

// The real icon component re-renders after its async font load, which this
// jest env cannot flush safely — icons render as their name instead (same
// pattern as booking-screen.test).
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
};

/** One Economy option at SYP 29,750 (the artboard's wallet-short figures). */
function shortEstimate() {
  const estimate = estimateResponse();
  estimate.options = [estimate.options[0]];
  estimate.options[0].estimate.components = components({ total: 29750 });
  return estimate;
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

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  grantLocation();
});

describe("booking payment choice (PAY-02)", () => {
  it("previews the wallet shortfall and books with paymentMethod=wallet", async () => {
    const api = mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: shortEstimate() },
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      "POST /api/v1/rides": {
        status: 201,
        body: ride({ paymentMethod: "wallet" }),
      },
    });
    await renderBooking();
    await planToWork();

    // Cash is the default; Change switches to the wallet.
    expect(await screen.findByTestId("booking-payment")).toHaveTextContent(
      "Cash",
    );
    expect(screen.queryByTestId("booking-wallet-preview")).toBeNull();
    await fireEvent.press(screen.getByTestId("booking-payment-change"));
    expect(screen.getByTestId("booking-payment")).toHaveTextContent(
      "Paying with wallet",
    );

    // Balance 15,000 vs estimate 29,750 → covers / remaining preview.
    expect(await screen.findByTestId("booking-wallet-covers")).toHaveTextContent(
      "SYP 15,000",
    );
    expect(screen.getByTestId("booking-wallet-remaining")).toHaveTextContent(
      "~SYP 14,750",
    );
    expect(
      screen.getByText(
        "Your wallet doesn't cover the full estimate — the rest is due in cash at the end.",
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("booking-confirm"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", "/api/v1/rides")[0].body).toEqual(
      expect.objectContaining({ paymentMethod: "wallet" }),
    );
  });

  it("says when the wallet covers the whole estimate", async () => {
    mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "GET /api/v1/wallet": {
        status: 200,
        body: walletView({ balances: [{ currency: "SYP", balance: 50000 }] }),
      },
    });
    await renderBooking();
    await planToWork();

    await fireEvent.press(await screen.findByTestId("booking-payment-change"));
    expect(
      await screen.findByText("Your wallet covers this ride's estimate."),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("booking-wallet-covers")).toBeNull();
  });

  it("notes when the balance couldn't be read and can switch back to cash", async () => {
    mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
      "GET /api/v1/wallet": { status: 500, body: { status: 500 } },
    });
    await renderBooking();
    await planToWork();

    await fireEvent.press(await screen.findByTestId("booking-payment-change"));
    expect(
      await screen.findByText("Couldn't check your wallet balance."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("booking-payment-change"));
    expect(screen.getByTestId("booking-payment")).toHaveTextContent("Cash");
    expect(screen.queryByTestId("booking-wallet-preview")).toBeNull();
  });

  it("shows the pickup-distance fee disclosure card only for accept_distant_fee riders", async () => {
    const distant = estimateResponse({
      pickupDistanceMode: "accept_distant_fee",
      pickupFeeRule: { thresholdKm: 10, perKm: 500 },
    });
    mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: distant },
    });
    await renderBooking();
    await planToWork();

    expect(
      await screen.findByTestId("booking-pickup-fee-disclosure"),
    ).toHaveTextContent(
      /You accept distant drivers: beyond 10 km a pickup fee of SYP 500\/km is added\. It shows on your receipt\./,
    );
  });

  it("hides the disclosure card for nearby-only riders", async () => {
    mockApi({
      ...BASE_ROUTES,
      "POST /api/v1/rides/estimate": { status: 200, body: estimateResponse() },
    });
    await renderBooking();
    await planToWork();

    expect(await screen.findByText("Choose a ride")).toBeOnTheScreen();
    expect(screen.queryByTestId("booking-pickup-fee-disclosure")).toBeNull();
  });
});

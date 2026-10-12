/**
 * M8-T3 tip sheet (PAY-04, UC-R-08) against money-v1.yaml mocks: suggested
 * chips + custom amount, the wallet-balance and window lines, posting the
 * tip, the client-side insufficient-balance guard, and a distinct message
 * for each contract 409 (window expired / already tipped / insufficient
 * balance / not tippable).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import { tipResponse, walletView } from "../../../test-utils/money-fixtures";
import { RIDE_ID } from "../../../test-utils/ride-fixtures";
import { TipSheet } from "../tip-sheet";

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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const TIP_URL = `POST /api/v1/rides/${RIDE_ID}/tip`;

async function renderSheet(
  overrides: Partial<React.ComponentProps<typeof TipSheet>> = {},
) {
  const onTipped = jest.fn();
  const onClose = jest.fn();
  await render(
    <LocaleProvider>
      <TipSheet
        visible
        onClose={onClose}
        rideId={RIDE_ID}
        currency="SYP"
        driverName="Samer"
        completedAt={new Date(Date.now() - 60 * 60 * 1000).toISOString()}
        rideLine="Sat 11 Oct · Umayyad Square · SYP 27,250"
        onTipped={onTipped}
        {...overrides}
      />
    </LocaleProvider>,
  );
  return { onTipped, onClose };
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
});

describe("tip sheet (UC-R-08)", () => {
  it("shows the window, balance and 100%-to-driver lines and sends a suggested tip", async () => {
    const api = mockApi({
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      [TIP_URL]: { status: 201, body: tipResponse({ amount: 2000 }) },
    });
    const { onTipped, onClose } = await renderSheet();

    expect(await screen.findByTestId("tip-title")).toHaveTextContent(
      "Tip Samer",
    );
    expect(await screen.findByTestId("tip-balance")).toHaveTextContent(
      "From your wallet · balance SYP 15,000",
    );
    expect(screen.getByTestId("tip-window")).toHaveTextContent(
      /You can tip until/,
    );
    expect(
      screen.getByText("100% goes to Samer — Labby takes nothing"),
    ).toBeOnTheScreen();

    // The middle chip (5,000) starts selected and names the button.
    expect(screen.getByTestId("tip-send")).toHaveTextContent(
      "Send SYP 5,000 tip",
    );
    await fireEvent.press(screen.getByTestId("tip-amount-2000"));
    expect(screen.getByTestId("tip-send")).toHaveTextContent(
      "Send SYP 2,000 tip",
    );
    await fireEvent.press(screen.getByTestId("tip-send"));

    expect(await screen.findByTestId("tip-sheet")).toBeOnTheScreen();
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/tip`)[0].body).toEqual(
      { amount: 2000 },
    );
    expect(onTipped).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000 }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("sends a custom amount", async () => {
    const api = mockApi({
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      [TIP_URL]: { status: 201, body: tipResponse({ amount: 7500 }) },
    });
    await renderSheet();

    await fireEvent.changeText(await screen.findByTestId("tip-custom"), "7500");
    expect(screen.getByTestId("tip-send")).toHaveTextContent(
      "Send SYP 7,500 tip",
    );
    await fireEvent.press(screen.getByTestId("tip-send"));
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/tip`)[0].body).toEqual(
      { amount: 7500 },
    );
  });

  it("catches an insufficient balance client-side before posting", async () => {
    const api = mockApi({
      "GET /api/v1/wallet": {
        status: 200,
        body: walletView({ balances: [{ currency: "SYP", balance: 1000 }] }),
      },
    });
    const { onTipped } = await renderSheet();

    expect(await screen.findByTestId("tip-balance")).toHaveTextContent(
      /SYP 1,000/,
    );
    await fireEvent.press(screen.getByTestId("tip-amount-2000"));
    await fireEvent.press(screen.getByTestId("tip-send"));
    expect(await screen.findByTestId("tip-error")).toHaveTextContent(
      "Your wallet balance doesn't cover this tip.",
    );
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/tip`)).toHaveLength(0);
    expect(onTipped).not.toHaveBeenCalled();
  });

  it.each([
    ["Tip window expired", "The tip window has ended — tips are possible up to 24 hours after a ride."],
    ["Ride already tipped", "You already tipped for this ride."],
    ["Insufficient wallet balance", "Your wallet balance doesn't cover this tip."],
    ["Ride is not tippable", "This ride can't be tipped."],
  ])("explains the contract 409 '%s' distinctly", async (serverMessage, shown) => {
    mockApi({
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      [TIP_URL]: {
        status: 409,
        body: { status: 409, message: serverMessage },
      },
    });
    const { onTipped } = await renderSheet();

    await screen.findByTestId("tip-balance");
    await fireEvent.press(screen.getByTestId("tip-send"));
    expect(await screen.findByTestId("tip-error")).toHaveTextContent(shown);
    expect(onTipped).not.toHaveBeenCalled();
  });

  it("requires a positive amount", async () => {
    mockApi({
      "GET /api/v1/wallet": { status: 200, body: walletView() },
    });
    await renderSheet();

    await fireEvent.changeText(await screen.findByTestId("tip-custom"), "0");
    const send = screen.getByTestId("tip-send");
    expect(send.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });
});

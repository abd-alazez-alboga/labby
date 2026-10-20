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
import { StyleSheet } from "react-native";

import {
  LANGUAGE_STORAGE_KEY,
  LocaleProvider,
} from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import { tipResponse, walletView } from "../../../test-utils/money-fixtures";
import { RIDE_ID } from "../../../test-utils/ride-fixtures";
import { parseTipAmount, suggestedTips, TipSheet } from "../tip-sheet";

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
    ["tip_window_closed", "The tip window for this ride has closed", "The tip window has ended — tips are possible up to 24 hours after a ride."],
    ["already_tipped", "This ride already has a tip", "You already tipped for this ride."],
    ["insufficient_balance", "Your wallet balance is not enough for this tip", "Your wallet balance doesn't cover this tip."],
    ["not_tippable", "This ride cannot be tipped", "This ride can't be tipped."],
  ])("explains the contract 409 '%s' distinctly", async (code, serverMessage, shown) => {
    mockApi({
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      [TIP_URL]: {
        status: 409,
        body: { status: 409, code, message: serverMessage },
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

  it("accepts a grouped and an Arabic-Indic custom amount", async () => {
    const api = mockApi({
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      [TIP_URL]: { status: 201, body: tipResponse({ amount: 5000 }) },
    });
    await renderSheet();

    await fireEvent.changeText(await screen.findByTestId("tip-custom"), "5,000");
    expect(screen.getByTestId("tip-send")).toHaveTextContent(
      "Send SYP 5,000 tip",
    );
    await fireEvent.changeText(screen.getByTestId("tip-custom"), "٥٠٠٠");
    expect(screen.getByTestId("tip-send")).toHaveTextContent(
      "Send SYP 5,000 tip",
    );
    await fireEvent.press(screen.getByTestId("tip-send"));
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/tip`)[0].body).toEqual(
      { amount: 5000 },
    );
  });

  it("rejects more than 2 decimals with the invalid-amount error", async () => {
    mockApi({
      "GET /api/v1/wallet": { status: 200, body: walletView() },
    });
    await renderSheet();

    await fireEvent.changeText(await screen.findByTestId("tip-custom"), "1.234");
    expect(screen.getByTestId("tip-custom-error")).toHaveTextContent(
      "Enter a tip amount.",
    );
    expect(screen.getByTestId("tip-send").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it("offers no chips for a currency without suggestions (custom only)", async () => {
    const api = mockApi({
      "GET /api/v1/wallet": {
        status: 200,
        body: walletView({ balances: [{ currency: "USD", balance: 40 }] }),
      },
      [TIP_URL]: {
        status: 201,
        body: tipResponse({ amount: 12.5, currency: "USD" }),
      },
    });
    await renderSheet({ currency: "USD" });

    expect(await screen.findByTestId("tip-balance")).toHaveTextContent(/USD 40/);
    expect(screen.queryByTestId(/^tip-amount-/)).toBeNull();
    expect(screen.getByTestId("tip-send").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.changeText(screen.getByTestId("tip-custom"), "12٫5");
    await fireEvent.press(screen.getByTestId("tip-send"));
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/tip`)[0].body).toEqual(
      { amount: 12.5 },
    );
  });

  it("shows the whole Arabic title with the driver's name (W2)", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({ "GET /api/v1/wallet": { status: 200, body: walletView() } });
    await renderSheet();

    const title = await screen.findByTestId("tip-title");
    expect(title).toHaveTextContent("إكرامية لـ⁨Samer⁩");
    expect(title.props.textBreakStrategy).toBe("simple");
    expect(StyleSheet.flatten(title.props.style)).toMatchObject({
      lineHeight: 39,
    });
  });
});

describe("parseTipAmount", () => {
  it.each([
    ["5,000", 5000],
    ["٥٠٠٠", 5000],
    ["۵۰۰۰", 5000],
    ["5٬000", 5000],
    ["5 000", 5000],
    ["12٫5", 12.5],
    ["12.5", 12.5],
    ["12.50", 12.5],
    ["1.234", null],
    ["1.2.3", null],
    ["abc", null],
    ["0", null],
    ["-5", null],
    ["", null],
  ])("parses %p as %p", (text, expected) => {
    expect(parseTipAmount(text)).toBe(expected);
  });
});

describe("suggestedTips", () => {
  it("keys the chips by currency", () => {
    expect(suggestedTips("SYP")).toEqual([2000, 5000, 10000]);
    expect(suggestedTips("USD")).toEqual([]);
  });
});

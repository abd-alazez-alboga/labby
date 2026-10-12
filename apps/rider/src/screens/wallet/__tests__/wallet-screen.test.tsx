/**
 * M8-T3 wallet screen (UC-R-17, PAY-01) against money-v1.yaml mocks:
 * per-currency balance card, pending-due banner ("added to your next ride"),
 * typed activity with signed currency-formatted amounts (NFR-I2), paging,
 * empty and error states, the Settings entry, and the Arabic rendering
 * (Western digits, "ل.س", amounts in an LTR isolate).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";

import { LANGUAGE_STORAGE_KEY, LocaleProvider } from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  riderDue,
  transactionsPage,
  walletTransaction,
  walletView,
} from "../../../test-utils/money-fixtures";
import { renderWithProviders } from "../../../test-utils/render";
import SettingsScreen from "../../settings-screen";
import WalletScreen from "../wallet-screen";

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
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => false,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

function renderWallet() {
  return render(
    <LocaleProvider>
      <WalletScreen />
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
});

describe("wallet screen (UC-R-17)", () => {
  it("shows the balance card, the pending-due banner and the typed activity", async () => {
    const refund = walletTransaction({
      id: "tx-refund",
      amount: 20000,
      type: "refund",
      reason: "by support",
      createdAt: "2026-10-09T10:00:00Z",
    });
    const farePayment = walletTransaction({
      id: "tx-fare",
      amount: -27250,
      type: "fare_payment",
      createdAt: "2026-10-08T09:49:00Z",
    });
    const tip = walletTransaction({
      id: "tx-tip",
      amount: -2000,
      type: "tip",
      createdAt: "2026-10-08T10:00:00Z",
    });
    const fee = walletTransaction({
      id: "tx-fee",
      amount: -4000,
      type: "cancellation_fee",
      createdAt: "2026-10-02T10:00:00Z",
    });
    const promo = walletTransaction({
      id: "tx-promo",
      amount: 12250,
      type: "promo",
      reason: "welcome credit",
      createdAt: "2026-10-05T10:00:00Z",
    });
    mockApi({
      "GET /api/v1/wallet": {
        status: 200,
        body: walletView({ dues: [riderDue()] }),
      },
      "GET /api/v1/wallet/transactions": {
        status: 200,
        body: transactionsPage([refund, farePayment, tip, fee, promo]),
      },
    });
    await renderWallet();

    expect(await screen.findByTestId("wallet-balance-SYP")).toHaveTextContent(
      "SYP 15,000",
    );
    expect(
      screen.getByText(
        "Credits come from refunds, promotions and rewards. No top-ups.",
      ),
    ).toBeOnTheScreen();

    // Pending due (owner ruling (a)): carried to the next ride.
    expect(screen.getByTestId(`wallet-due-${riderDue().id}`)).toHaveTextContent(
      /SYP 10,000 cancellation fee from .* will be added to your next ride\./,
    );

    // Typed, localized entries with signed currency-formatted amounts.
    expect(screen.getByTestId("wallet-tx-tx-refund")).toHaveTextContent(/Refund/);
    expect(screen.getByTestId("wallet-tx-tx-refund")).toHaveTextContent(
      /by support/,
    );
    expect(screen.getByTestId("wallet-tx-amount-tx-refund")).toHaveTextContent(
      "+SYP 20,000",
    );
    expect(screen.getByTestId("wallet-tx-tx-fare")).toHaveTextContent(
      /Ride payment/,
    );
    expect(screen.getByTestId("wallet-tx-amount-tx-fare")).toHaveTextContent(
      "−SYP 27,250",
    );
    expect(screen.getByTestId("wallet-tx-tx-tip")).toHaveTextContent(/Tip/);
    expect(screen.getByTestId("wallet-tx-tx-fee")).toHaveTextContent(
      /Cancellation fee/,
    );
    expect(screen.getByTestId("wallet-tx-tx-fee")).toHaveTextContent(
      /taken from wallet/,
    );
    expect(screen.getByTestId("wallet-tx-tx-promo")).toHaveTextContent(
      /Promotion/,
    );
    expect(screen.queryByTestId("wallet-load-more")).toBeNull();
  });

  it("pages older activity with Load more", async () => {
    const first = walletTransaction({ id: "tx-a", amount: 1000 });
    const second = walletTransaction({ id: "tx-b", amount: -500, type: "tip" });
    mockApi({
      "GET /api/v1/wallet": { status: 200, body: walletView() },
      "GET /api/v1/wallet/transactions": [
        {
          status: 200,
          body: transactionsPage([first], { totalItems: 2, totalPages: 2 }),
        },
        {
          status: 200,
          body: transactionsPage([second], {
            page: 1,
            totalItems: 2,
            totalPages: 2,
          }),
        },
      ],
    });
    await renderWallet();

    expect(await screen.findByTestId("wallet-tx-tx-a")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("wallet-load-more"));
    expect(await screen.findByTestId("wallet-tx-tx-b")).toBeOnTheScreen();
    expect(screen.queryByTestId("wallet-load-more")).toBeNull();
  });

  it("explains an empty wallet (no balance rows, no transactions)", async () => {
    mockApi({
      "GET /api/v1/wallet": {
        status: 200,
        body: walletView({ balances: [], dues: [] }),
      },
      "GET /api/v1/wallet/transactions": {
        status: 200,
        body: transactionsPage([]),
      },
    });
    await renderWallet();

    // A zero balance card still renders (region currency fallback).
    expect(await screen.findByTestId("wallet-balance-SYP")).toHaveTextContent(
      "SYP 0",
    );
    expect(screen.getByTestId("wallet-empty")).toHaveTextContent(
      /No activity yet/,
    );
    expect(screen.queryByTestId(/wallet-due-/)).toBeNull();
  });

  it("recovers from a failed load with retry", async () => {
    mockApi({
      "GET /api/v1/wallet": [
        { status: 500, body: { status: 500 } },
        { status: 200, body: walletView() },
      ],
      "GET /api/v1/wallet/transactions": {
        status: 200,
        body: transactionsPage([]),
      },
    });
    await renderWallet();

    await fireEvent.press(await screen.findByTestId("error-retry"));
    expect(await screen.findByTestId("wallet-balance-SYP")).toBeOnTheScreen();
  });

  it("renders Arabic with Western digits, the ل.س label and LTR-isolated amounts", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    const debit = walletTransaction({
      id: "tx-fare",
      amount: -27250,
      type: "fare_payment",
    });
    mockApi({
      "GET /api/v1/wallet": {
        status: 200,
        body: walletView({ dues: [riderDue()] }),
      },
      "GET /api/v1/wallet/transactions": {
        status: 200,
        body: transactionsPage([debit]),
      },
    });
    await renderWallet();

    const balance = await screen.findByTestId("wallet-balance-SYP");
    // "⁦15,000⁩ ل.س" — Western digits inside an LTR isolate, currency ل.س.
    expect(balance).toHaveTextContent("⁦15,000⁩ ل.س");
    expect(screen.getByTestId(`wallet-due-${riderDue().id}`)).toHaveTextContent(
      /سيُضاف إلى رحلتك القادمة/,
    );
    expect(screen.getByTestId("wallet-tx-tx-fare")).toHaveTextContent(
      /دفع رحلة/,
    );
    expect(screen.getByTestId("wallet-tx-amount-tx-fare")).toHaveTextContent(
      "⁦−27,250⁩ ل.س",
    );
  });
});

describe("settings → wallet", () => {
  it("opens the wallet from the Wallet section", async () => {
    mockApi({});
    await renderWithProviders(<SettingsScreen />);
    await fireEvent.press(await screen.findByTestId("settings-wallet"));
    expect(mockPush).toHaveBeenCalledWith("/wallet");
  });
});

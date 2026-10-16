/**
 * M11-T3 ride history rating states (approved artboard RiderHistoryRate)
 * from the history page alone (`RideSummary.myRating` +
 * `counterpartFirstName`, no per-ride reads): "Rate Samer · N days
 * left" (the newest as the filled pill), "You rated N", "Rating window
 * closed"; a rating stored meanwhile updates the row at once.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { StyleSheet } from "react-native";

import type { RideSummary } from "../../../api/rides";
import { LANGUAGE_STORAGE_KEY, LocaleProvider } from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  destinationPlace,
  pickupPlace,
  RIDE_ID,
} from "../../../test-utils/ride-fixtures";
import {
  pendingRating,
  RIDE_2,
  RIDE_3,
  RIDE_4,
} from "../../../test-utils/trust-fixtures";
import { emitRatingSubmitted } from "../../../trust/rating-events";
import { colors } from "../../../theme/tokens";
import RideHistoryScreen from "../../ride/ride-history-screen";

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
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

function summary(id: string, overrides: Partial<RideSummary> = {}): RideSummary {
  return {
    id,
    state: "completed",
    requestedAt: "2026-10-08T09:29:00Z",
    pickup: pickupPlace,
    destination: destinationPlace,
    serviceTypeNameEn: "Economy",
    serviceTypeNameAr: "اقتصادية",
    total: 27250,
    cancellationFee: null,
    currency: "SYP",
    ...overrides,
  };
}

const CANCELLED = "99999999-9999-4999-8999-999999999999";

function routes() {
  return {
    "GET /api/v1/rides": {
      status: 200,
      body: {
        items: [
          summary(RIDE_ID, {
            myRating: pendingRating(6.5),
            counterpartFirstName: "Samer",
          }),
          summary(RIDE_2, {
            myRating: pendingRating(2.5),
            counterpartFirstName: "Lina",
          }),
          summary(RIDE_3, {
            myRating: { state: "submitted", windowEndsAt: null, score: 5 },
            counterpartFirstName: "Omar",
          }),
          summary(RIDE_4, {
            myRating: { state: "expired", windowEndsAt: null, score: null },
            counterpartFirstName: "Rami",
          }),
          summary(CANCELLED, {
            state: "cancelled_by_rider",
            total: null,
            myRating: { state: "not_applicable", windowEndsAt: null, score: null },
            counterpartFirstName: null,
          }),
        ],
        page: 0,
        size: 20,
        totalItems: 5,
      },
    },
  } as Parameters<typeof mockApi>[0];
}

function renderHistory() {
  return render(
    <LocaleProvider>
      <RideHistoryScreen />
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
});

describe("history rating states (RiderHistoryRate)", () => {
  it("shows Rate · days left, You rated N and Rating window closed", async () => {
    const api = mockApi(routes());
    await renderHistory();

    const first = await screen.findByTestId(`history-rate-${RIDE_ID}`);
    expect(first).toHaveTextContent(/Rate Samer · 7 days left$/);
    expect(screen.getByTestId(`history-rate-${RIDE_2}`)).toHaveTextContent(
      "Rate Lina · 3 days left",
    );
    expect(screen.getByTestId(`history-rated-${RIDE_3}`)).toHaveTextContent(
      /You rated 5$/,
    );
    expect(
      screen.getByTestId(`history-rating-closed-${RIDE_4}`),
    ).toHaveTextContent("Rating window closed");
    // The driver joins the subtitle; no ride is read one by one.
    expect(screen.getAllByText(/· Samer · Economy$/).length).toBeGreaterThan(0);
    expect(
      api.calls.filter((c) => c.path.startsWith("/api/v1/rides/")),
    ).toHaveLength(0);
    expect(screen.getByTestId(`history-${CANCELLED}`)).toBeOnTheScreen();

    // One dominant action: only the newest pending pill is filled.
    expect(StyleSheet.flatten(first.props.style)).toMatchObject({
      backgroundColor: colors.accent,
    });
    expect(
      StyleSheet.flatten(screen.getByTestId(`history-rate-${RIDE_2}`).props.style),
    ).toMatchObject({ borderColor: colors.accent });

    await fireEvent.press(first);
    expect(mockPush).toHaveBeenCalledWith(`/rate/${RIDE_ID}`);
  });

  it("turns a row into You rated N once a rating is stored", async () => {
    mockApi(routes());
    await renderHistory();
    await screen.findByTestId(`history-rate-${RIDE_ID}`);

    await act(async () => emitRatingSubmitted(RIDE_ID, 4));
    expect(screen.getByTestId(`history-rated-${RIDE_ID}`)).toHaveTextContent(
      /You rated 4$/,
    );
    expect(screen.queryByTestId(`history-rate-${RIDE_ID}`)).toBeNull();
  });

  it("uses the Arabic day forms", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi(routes());
    await renderHistory();
    expect(
      await screen.findByTestId(`history-rate-${RIDE_ID}`),
    ).toHaveTextContent(/قيّم Samer · 7 أيام متبقية$/);
    expect(screen.getByTestId(`history-rated-${RIDE_3}`)).toHaveTextContent(
      /تقييمك: 5$/,
    );
    expect(
      screen.getByTestId(`history-rating-closed-${RIDE_4}`),
    ).toHaveTextContent("انتهت مهلة التقييم");
  });
});

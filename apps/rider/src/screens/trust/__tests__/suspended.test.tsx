/**
 * M11-T3 suspended state (USR-04..06, approved artboard RiderSuspended) on
 * home: rider role suspended for low rating (the rule) or manually (the
 * admin's note), whole account suspended (note), a 403 account_suspended
 * met by any call (profile re-read; without it the bare screen), and an
 * in-flight ride that keeps showing (SOS + finishing the ride stay
 * available). Also: the driver's rating badge (DriverSummary.rating, null
 * → nothing) and the in-ride "Report <driver>" entry.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import type { UserProfile } from "../../../api/auth";
import { AuthProvider } from "../../../auth/auth-context";
import { LANGUAGE_STORAGE_KEY, LocaleProvider } from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import { mockApi, sampleUser, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  acceptedRide,
  FakeSocket,
  fakeSocketFactory,
  RIDE_ID,
  sampleDriver,
} from "../../../test-utils/ride-fixtures";
import {
  accountSuspended,
  coded,
  riderRoleSuspended,
} from "../../../test-utils/trust-fixtures";
import { resetRatingPromptCheck } from "../../../trust/rating-prompts";
import HomeScreen from "../../home-screen";
import { DriverCard } from "../../ride/ride-parts";
import { SafetyActionsRow } from "../../ride/safety-actions";

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
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const ME = "GET /api/v1/users/me";
const ACTIVE = "GET /api/v1/rides/active";
const PENDING = "GET /api/v1/ratings/pending";

async function renderHome(user: UserProfile) {
  await seedSignedInSession(user);
  return render(
    <LocaleProvider>
      <AuthProvider>
        <RideProvider socketFactory={fakeSocketFactory}>
          <HomeScreen />
        </RideProvider>
      </AuthProvider>
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  resetRatingPromptCheck();
});

describe("suspended screen (USR-04..06)", () => {
  it("rider role suspended for low rating: the rating rule, no booking", async () => {
    const user = riderRoleSuspended("low_rating");
    const api = mockApi({
      [ME]: { status: 200, body: user },
      [ACTIVE]: { status: 204 },
    });
    await renderHome(user);

    expect(await screen.findByTestId("suspended-title")).toHaveTextContent(
      "Your rider account is suspended",
    );
    expect(
      screen.getByText(
        "You can't book rides while it's suspended. Your wallet balance and ride history are safe.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("suspended-rule")).toHaveTextContent(
      "ReasonYour average rider rating fell below the minimum allowed in your area.",
    );
    expect(screen.queryByTestId("suspended-note")).toBeNull();
    expect(screen.queryByTestId("home-where-to")).toBeNull();
    expect(screen.queryByText(/support/i)).toBeNull();
    expect(
      screen.getByText(
        "Your account will be reactivated if our team reviews it. You'll get a notification when that happens.",
      ),
    ).toBeOnTheScreen();
    // No rating prompt is fetched while suspended.
    expect(api.callsTo("GET", "/api/v1/ratings/pending")).toHaveLength(0);

    await fireEvent.press(screen.getByTestId("suspended-settings"));
    expect(mockPush).toHaveBeenCalledWith("/settings");
  });

  it("rider role suspended manually: the admin's note", async () => {
    const user = riderRoleSuspended(
      "manual",
      "Repeated abusive messages to drivers in ride chat.",
    );
    mockApi({ [ME]: { status: 200, body: user }, [ACTIVE]: { status: 204 } });
    await renderHome(user);

    expect(await screen.findByTestId("suspended-note")).toHaveTextContent(
      "Reason · from the Labby team“Repeated abusive messages to drivers in ride chat.”",
    );
    expect(screen.getByTestId("suspended-title")).toHaveTextContent(
      "Your rider account is suspended",
    );
    expect(screen.queryByTestId("suspended-rule")).toBeNull();
  });

  it("whole account suspended: the account title and the note", async () => {
    const user = accountSuspended("Payment fraud under investigation.");
    mockApi({ [ME]: { status: 200, body: user }, [ACTIVE]: { status: 204 } });
    await renderHome(user);

    expect(await screen.findByTestId("suspended-title")).toHaveTextContent(
      "Your Labby account is suspended",
    );
    expect(screen.getByTestId("suspended-note")).toHaveTextContent(
      /“Payment fraud under investigation\.”/,
    );
  });

  it("a 403 account_suspended from any call re-reads the profile", async () => {
    const suspended = accountSuspended("Abuse reports confirmed.");
    const api = mockApi({
      [ME]: [
        { status: 200, body: sampleUser },
        { status: 200, body: suspended },
      ],
      [ACTIVE]: { status: 204 },
      [PENDING]: coded(403, "account_suspended"),
    });
    await renderHome(sampleUser);

    expect(await screen.findByTestId("suspended-note")).toHaveTextContent(
      /Abuse reports confirmed\./,
    );
    expect(screen.getByTestId("suspended-title")).toHaveTextContent(
      "Your Labby account is suspended",
    );
    expect(api.callsTo("GET", "/api/v1/users/me").length).toBeGreaterThanOrEqual(2);
  });

  it("still shows the suspended screen when the profile can't be re-read", async () => {
    mockApi({
      [ME]: [
        { status: 200, body: sampleUser },
        { status: 500, body: { status: 500 } },
      ],
      [ACTIVE]: { status: 204 },
      [PENDING]: coded(403, "account_suspended"),
    });
    await renderHome(sampleUser);

    expect(await screen.findByTestId("suspended-title")).toHaveTextContent(
      "Your Labby account is suspended",
    );
    expect(screen.queryByTestId("suspended-note")).toBeNull();
  });

  it("keeps an in-flight ride on screen — SOS stays available", async () => {
    const user = accountSuspended("Abuse reports confirmed.");
    mockApi({
      [ME]: { status: 200, body: user },
      [ACTIVE]: { status: 200, body: acceptedRide() },
    });
    await renderHome(user);

    expect(await screen.findByTestId("ride-sos")).toBeOnTheScreen();
    expect(screen.getByText("Meet at pickup")).toBeOnTheScreen();
    expect(screen.queryByTestId("suspended-screen")).toBeNull();
  });

  it("renders in Arabic", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    const user = riderRoleSuspended("low_rating");
    mockApi({ [ME]: { status: 200, body: user }, [ACTIVE]: { status: 204 } });
    await renderHome(user);
    expect(await screen.findByText("حسابك كراكب موقوف")).toBeOnTheScreen();
    expect(
      screen.getByText("انخفض متوسط تقييمك كراكب عن الحد الأدنى المسموح به في منطقتك."),
    ).toBeOnTheScreen();
  });
});

describe("driver rating + in-ride report entry", () => {
  it("shows the snapshot average as 4.9 ★, nothing when null", async () => {
    const view = await render(
      <LocaleProvider>
        <DriverCard driver={{ ...sampleDriver, rating: 4.86 }} />
      </LocaleProvider>,
    );
    expect(await screen.findByTestId("driver-rating")).toHaveTextContent("4.9 ★");
    expect(screen.getByLabelText("Rated 4.9 out of 5")).toBeOnTheScreen();

    await view.rerender(
      <LocaleProvider>
        <DriverCard driver={{ ...sampleDriver, rating: null }} />
      </LocaleProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("driver-rating")).toBeNull());
  });

  it("opens the report flow from the in-ride safety row", async () => {
    await render(
      <LocaleProvider>
        <SafetyActionsRow ride={acceptedRide()} />
      </LocaleProvider>,
    );
    await fireEvent.press(await screen.findByText("Report Samer"));
    expect(mockPush).toHaveBeenCalledWith(`/report/${RIDE_ID}`);
  });
});

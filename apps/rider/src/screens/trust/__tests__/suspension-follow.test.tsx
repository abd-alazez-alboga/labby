/**
 * M11 review fixes (docs/reviews/review-M11.md):
 * - R-W1: the profile is re-read on an account-state push (received or
 *   tapped) and on foreground re-entry while suspended, so a reactivated
 *   rider leaves the suspended screen without a relaunch;
 * - R-W2: a WHOLE-account suspension offers no rating prompt, Rate pill or
 *   Report link (a role-only one keeps them), and a 403 account_suspended
 *   on rating / report / photo upload is a final notice;
 * - R-W3: the post-ride prompt counts as the launch's prompt — the
 *   cold-start check opens no second one;
 * - Ride.cancellationReason `account_suspended` reads as a suspension, not
 *   "you cancelled", on the ended ride and in history.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import React from "react";
import { AppState, type AppStateStatus } from "react-native";

import type { UserProfile } from "../../../api/auth";
import { AuthProvider } from "../../../auth/auth-context";
import { LocaleProvider } from "../../../i18n/locale-context";
import { NotificationsProvider } from "../../../notifications/notifications-context";
import { RideProvider } from "../../../ride/ride-context";
import { mockApi, sampleUser, seedSignedInSession } from "../../../test-utils/mock-api";
import { settledNavigationRef } from "../../../test-utils/navigation";
import {
  acceptedRide,
  destinationPlace,
  FakeSocket,
  fakeSocketFactory,
  pickupPlace,
  ride,
  RIDE_ID,
} from "../../../test-utils/ride-fixtures";
import {
  accountSuspended,
  coded,
  completedRide,
  pendingPrompt,
  pendingRating,
  RIDE_2,
  riderRoleSuspended,
} from "../../../test-utils/trust-fixtures";
import { resetRatingPromptCheck } from "../../../trust/rating-prompts";
import HomeScreen from "../../home-screen";
import SettingsScreen from "../../settings-screen";
import RideHistoryScreen from "../../ride/ride-history-screen";
import RideScreen from "../../ride/ride-screen";
import { SafetyActionsRow } from "../../ride/safety-actions";
import RateScreen from "../rate-screen";
import ReportScreen from "../report-screen";

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
  useNavigationContainerRef: () => mockNavigationRef,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockNavigationRef = require("../../../test-utils/navigation")
  .settledNavigationRef as typeof settledNavigationRef;

jest.mock("../../../notifications/push-support", () => ({
  isRemotePushSupported: jest.fn(() => true),
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibraryAsync(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const notificationsMock = Notifications as jest.Mocked<typeof Notifications>;

const ME = "GET /api/v1/users/me";
const ACTIVE = "GET /api/v1/rides/active";
const RIDE = `GET /api/v1/rides/${RIDE_ID}`;
const PENDING = "GET /api/v1/ratings/pending";

async function signedIn(user: UserProfile, ui: React.ReactElement) {
  await seedSignedInSession(user);
  return render(
    <LocaleProvider>
      <AuthProvider>
        <RideProvider socketFactory={fakeSocketFactory}>{ui}</RideProvider>
      </AuthProvider>
    </LocaleProvider>,
  );
}

function captureAppState() {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  const original = AppState.addEventListener;
  AppState.addEventListener = ((
    _type: string,
    listener: (state: AppStateStatus) => void,
  ) => {
    listeners.push(listener);
    return { remove: () => {} };
  }) as unknown as typeof AppState.addEventListener;
  return {
    restore() {
      AppState.addEventListener = original;
    },
    async reenterForeground() {
      await act(async () => listeners.forEach((l) => l("background")));
      await act(async () => listeners.forEach((l) => l("active")));
    },
  };
}

function pushData(event: string) {
  return {
    date: 0,
    request: {
      identifier: `n-${event}`,
      content: { data: { notificationId: "n1", category: "account", event } },
      trigger: null,
    },
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  resetRatingPromptCheck();
});

describe("R-W1 — the suspended screen follows reactivation", () => {
  function home() {
    return (
      <NotificationsProvider>
        <HomeScreen />
      </NotificationsProvider>
    );
  }

  it.each(["account.reactivated", "account.role_reactivated"])(
    "re-reads the profile when a %s push arrives",
    async (event) => {
      const user = riderRoleSuspended("manual", "Abuse.");
      const api = mockApi({
        [ME]: [{ status: 200, body: user }, { status: 200, body: sampleUser }],
        [ACTIVE]: { status: 204 },
        [PENDING]: { status: 200, body: [] },
      });
      await signedIn(user, home());
      expect(await screen.findByTestId("suspended-screen")).toBeOnTheScreen();
      await waitFor(() => expect(api.callsTo("GET", "/api/v1/users/me")).toHaveLength(1));

      const received = notificationsMock.addNotificationReceivedListener.mock
        .calls.at(-1)?.[0] as (n: unknown) => void;
      await act(async () => received(pushData(event)));

      expect(await screen.findByTestId("home-where-to")).toBeOnTheScreen();
      expect(screen.queryByTestId("suspended-screen")).toBeNull();
    },
  );

  it("re-reads the profile when an account-state push is tapped", async () => {
    const user = accountSuspended("Abuse.");
    mockApi({
      [ME]: [{ status: 200, body: user }, { status: 200, body: sampleUser }],
      [ACTIVE]: { status: 204 },
      [PENDING]: { status: 200, body: [] },
      "POST /api/v1/notifications/n1/read": { status: 204 },
    });
    await signedIn(user, home());
    expect(await screen.findByTestId("suspended-screen")).toBeOnTheScreen();

    const tapped = notificationsMock.addNotificationResponseReceivedListener
      .mock.calls.at(-1)?.[0] as (r: unknown) => void;
    await act(async () =>
      tapped({ actionIdentifier: "default", notification: pushData("account.reactivated") }),
    );
    expect(await screen.findByTestId("home-where-to")).toBeOnTheScreen();
  });

  it("re-reads the profile on foreground re-entry while suspended", async () => {
    const appState = captureAppState();
    try {
      const user = accountSuspended("Abuse.");
      const api = mockApi({
        [ME]: [
          { status: 200, body: user },
          { status: 200, body: sampleUser },
        ],
        [ACTIVE]: { status: 204 },
        [PENDING]: { status: 200, body: [] },
      });
      await signedIn(user, <HomeScreen />);
      expect(await screen.findByTestId("suspended-screen")).toBeOnTheScreen();
      await waitFor(() => expect(api.callsTo("GET", "/api/v1/users/me")).toHaveLength(1));

      await appState.reenterForeground();
      expect(await screen.findByTestId("home-where-to")).toBeOnTheScreen();
      expect(api.callsTo("GET", "/api/v1/users/me")).toHaveLength(2);
    } finally {
      appState.restore();
    }
  });
});

describe("R-W2 — no rating/reporting for a suspended account", () => {
  it("shows no post-ride prompt for a suspended account", async () => {
    mockApi({
      [ME]: { status: 200, body: accountSuspended("x") },
      [ACTIVE]: { status: 204 },
      [RIDE]: { status: 200, body: completedRide() },
    });
    await signedIn(accountSuspended("x"), <RideScreen rideId={RIDE_ID} />);
    expect(await screen.findByTestId("ride-completed")).toBeOnTheScreen();
    expect(screen.queryByTestId("rating-screen")).toBeNull();
  });

  it("keeps the post-ride prompt for a role-only suspension", async () => {
    const user = riderRoleSuspended("low_rating");
    mockApi({
      [ME]: { status: 200, body: user },
      [ACTIVE]: { status: 204 },
      [RIDE]: { status: 200, body: completedRide() },
    });
    await signedIn(user, <RideScreen rideId={RIDE_ID} />);
    expect(await screen.findByTestId("rating-screen")).toBeOnTheScreen();
  });

  it("runs no cold-start check for a suspended account", async () => {
    const api = mockApi({
      [ME]: { status: 200, body: accountSuspended("x") },
      [ACTIVE]: { status: 204 },
      [PENDING]: { status: 200, body: [pendingPrompt()] },
    });
    await signedIn(accountSuspended("x"), <HomeScreen />);
    expect(await screen.findByTestId("suspended-screen")).toBeOnTheScreen();
    await act(async () => {});
    expect(api.callsTo("GET", "/api/v1/ratings/pending")).toHaveLength(0);
  });

  it("hides the in-ride Report link for a suspended account only", async () => {
    mockApi({ [ME]: { status: 200, body: accountSuspended("x") }, [ACTIVE]: { status: 204 } });
    const view = await signedIn(
      accountSuspended("x"),
      <SafetyActionsRow ride={acceptedRide()} />,
    );
    expect(await screen.findByTestId("safety-share")).toBeOnTheScreen();
    expect(screen.queryByTestId("safety-report")).toBeNull();
    view.unmount();

    const role = riderRoleSuspended("low_rating");
    mockApi({ [ME]: { status: 200, body: role }, [ACTIVE]: { status: 204 } });
    await signedIn(role, <SafetyActionsRow ride={acceptedRide()} />);
    expect(await screen.findByTestId("safety-report")).toBeOnTheScreen();
  });

  it("hides the history Rate pill for a suspended account", async () => {
    const page = {
      items: [
        {
          id: RIDE_ID,
          state: "completed",
          requestedAt: "2026-10-08T09:29:00Z",
          pickup: pickupPlace,
          destination: destinationPlace,
          serviceTypeNameEn: "Economy",
          serviceTypeNameAr: "اقتصادية",
          total: 27250,
          currency: "SYP",
          myRating: pendingRating(5),
          counterpartFirstName: "Samer",
        },
      ],
      page: 0,
      size: 20,
      totalItems: 1,
    };
    mockApi({
      [ME]: { status: 200, body: accountSuspended("x") },
      [ACTIVE]: { status: 204 },
      "GET /api/v1/rides": { status: 200, body: page },
    });
    await signedIn(accountSuspended("x"), <RideHistoryScreen />);
    expect(await screen.findByTestId(`history-${RIDE_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`history-rate-${RIDE_ID}`)).toBeNull();
  });

  it("maps a 403 account_suspended on rating to a final notice", async () => {
    mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [`POST /api/v1/rides/${RIDE_ID}/rating`]: coded(403, "account_suspended"),
    });
    await render(
      <LocaleProvider>
        <RateScreen rideId={RIDE_ID} />
      </LocaleProvider>,
    );
    await fireEvent.press(await screen.findByTestId("rating-star-4"));
    await fireEvent.press(screen.getByTestId("rating-submit"));
    expect(await screen.findByTestId("rating-blocked")).toHaveTextContent(
      "Your account is suspended, so this ride can't be rated.",
    );
    expect(screen.queryByTestId("rating-submit")).toBeNull();
    expect(screen.queryByTestId("rating-error")).toBeNull();
  });

  it("maps a 403 account_suspended on report send and photo upload to a final notice", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///p.jpg", fileName: "p.jpg", mimeType: "image/jpeg" }],
    });
    mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      "POST /api/v1/report-files": coded(403, "account_suspended"),
    });
    await render(
      <LocaleProvider>
        <ReportScreen rideId={RIDE_ID} />
      </LocaleProvider>,
    );
    await fireEvent.press(await screen.findByTestId("report-add-photo"));
    expect(await screen.findByTestId("report-blocked")).toHaveTextContent(
      "Your account is suspended, so reports can't be sent.",
    );
    expect(screen.queryByTestId("report-photo-error")).toBeNull();
    expect(screen.queryByTestId("report-add-photo")).toBeNull();
    await fireEvent.press(screen.getByTestId("report-category-other"));
    expect(screen.getByTestId("report-send")).toBeDisabled();
  });

  it("maps a 403 account_suspended on report send to the notice", async () => {
    mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [`POST /api/v1/rides/${RIDE_ID}/reports`]: coded(403, "account_suspended"),
    });
    await render(
      <LocaleProvider>
        <ReportScreen rideId={RIDE_ID} />
      </LocaleProvider>,
    );
    await fireEvent.press(await screen.findByTestId("report-category-other"));
    await fireEvent.press(screen.getByTestId("report-send"));
    expect(await screen.findByTestId("report-blocked")).toHaveTextContent(
      "Your account is suspended, so reports can't be sent.",
    );
    expect(screen.queryByTestId("report-error")).toBeNull();
  });
});

describe("R-W2 — Settings 'Your reports' row", () => {
  it("is hidden while the whole account is suspended", async () => {
    mockApi({ [ME]: { status: 200, body: accountSuspended("x") }, [ACTIVE]: { status: 204 } });
    await signedIn(accountSuspended("x"), <SettingsScreen />);
    expect(await screen.findByTestId("settings-rides")).toBeOnTheScreen();
    expect(screen.queryByTestId("settings-reports")).toBeNull();
  });

  it("stays for a role-only suspension", async () => {
    const role = riderRoleSuspended("manual", "x");
    mockApi({ [ME]: { status: 200, body: role }, [ACTIVE]: { status: 204 } });
    await signedIn(role, <SettingsScreen />);
    await fireEvent.press(await screen.findByTestId("settings-reports"));
    expect(mockPush).toHaveBeenCalledWith("/reports");
  });
});

describe("R-W3 — at most one rating prompt per launch", () => {
  it("skips the cold-start check after the post-ride prompt was shown", async () => {
    mockApi({
      [ME]: { status: 200, body: sampleUser },
      [ACTIVE]: { status: 204 },
      [RIDE]: { status: 200, body: completedRide() },
    });
    const view = await signedIn(sampleUser, <RideScreen rideId={RIDE_ID} />);
    expect(await screen.findByTestId("rating-screen")).toBeOnTheScreen();
    view.unmount();

    const api = mockApi({
      [ME]: { status: 200, body: sampleUser },
      [ACTIVE]: { status: 204 },
      [PENDING]: { status: 200, body: [pendingPrompt({ rideId: RIDE_2 })] },
    });
    await signedIn(sampleUser, <HomeScreen />);
    expect(await screen.findByTestId("home-screen")).toBeOnTheScreen();
    await act(async () => {});
    expect(api.callsTo("GET", "/api/v1/ratings/pending")).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalledWith(`/rate/${RIDE_2}`);
  });
});

describe("cancellationReason account_suspended", () => {
  it("reads as a suspension on the ended ride, not 'you cancelled'", async () => {
    const cancelled = ride({
      state: "cancelled_by_rider",
      cancellationReason: "account_suspended",
      cancellationFee: null,
    });
    mockApi({
      [ME]: { status: 200, body: sampleUser },
      [ACTIVE]: { status: 204 },
      [RIDE]: { status: 200, body: cancelled },
    });
    await signedIn(sampleUser, <RideScreen rideId={RIDE_ID} />);
    expect(await screen.findByTestId("ride-ended-title")).toHaveTextContent(
      "Ride cancelled",
    );
    expect(screen.getByTestId("ride-ended-suspended")).toHaveTextContent(
      "Cancelled because your account was suspended.",
    );
  });

  it("reads as a suspension in history", async () => {
    mockApi({
      [ME]: { status: 200, body: sampleUser },
      [ACTIVE]: { status: 204 },
      "GET /api/v1/rides": {
        status: 200,
        body: {
          items: [
            {
              id: RIDE_ID,
              state: "cancelled_by_rider",
              requestedAt: "2026-10-08T09:29:00Z",
              pickup: pickupPlace,
              destination: destinationPlace,
              serviceTypeNameEn: "Economy",
              serviceTypeNameAr: "اقتصادية",
              total: null,
              cancellationFee: null,
              currency: "SYP",
              cancellationReason: "account_suspended",
              myRating: { state: "not_applicable", windowEndsAt: null, score: null },
              counterpartFirstName: null,
            },
          ],
          page: 0,
          size: 20,
          totalItems: 1,
        },
      },
    });
    await signedIn(sampleUser, <RideHistoryScreen />);
    expect(await screen.findByText(/Cancelled · account suspended$/)).toBeOnTheScreen();
    expect(screen.queryByText(/Cancelled by you/)).toBeNull();
  });
});

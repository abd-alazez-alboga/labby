/**
 * M11-T3 — UC-S-17 for the driver against trust-v1.yaml mocks: the
 * post-trip rating prompt (cold start via GET /ratings/pending and right
 * after a ride), submit / skip, the 409 exceptions (window closed, already
 * rated), "Submit and go online", re-access from Trips within the window,
 * Arabic with Western digits.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { driverUser } from "../test-utils/contract";
import { initI18n, setAppLanguage } from "../i18n";
import { todayIso } from "../onboarding/dates";
import { RATING_SKIPS_KEY } from "../trust/RatingPromptProvider";
import { formatDayMonth } from "../trust/format";
import {
  EARNINGS,
  earningPage,
  summaryFixture,
  summaryRoute,
  tripEarningFixture,
} from "../test-utils/money";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import { mockLocationGranted } from "../test-utils/ride-harness";
import { availabilityFixture } from "../test-utils/realtime";
import { completedRide, RIDE_ID, rideFixture } from "../test-utils/rides";
import {
  coded,
  ok,
  PENDING,
  pendingFixture,
  RATE,
  renderTrustApp,
} from "../test-utils/trust";

const ACTIVE_RIDE = "GET /api/v1/driver/rides/active";
const CASH_CONFIRM = `POST /api/v1/driver/rides/${RIDE_ID}/cash-confirm`;
const SET_AVAILABILITY = "PUT /api/v1/driver/availability";
const MARK_UNPAID = `POST /api/v1/driver/rides/${RIDE_ID}/mark-unpaid`;
const CANCEL = `POST /api/v1/driver/rides/${RIDE_ID}/cancel`;

describe("rating the rider (UC-S-17)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("prompts on a cold start from GET /ratings/pending (newest pending ride)", async () => {
    const pending = pendingFixture();
    await renderTrustApp({ [PENDING]: ok([pending]) });

    expect(await screen.findByTestId("rate-rider-screen")).toBeTruthy();
    expect(screen.getByTestId("rate-title")).toHaveTextContent(
      "How was Rana as a rider?",
    );
    expect(screen.getByTestId("rate-subtitle")).toHaveTextContent(/^Trip ended /);
    expect(screen.getByTestId("rate-skipped-hint")).toHaveTextContent(
      `Skipped? Rate it from Trips until ${formatDayMonth(pending.windowEndsAt, "en")}.`,
    );
    expect(screen.getByText("Anonymous: Rana only sees an overall average.")).toBeTruthy();
    // Nothing to submit before a star is chosen.
    expect(screen.getByTestId("rate-submit").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("rate-score-label")).toHaveTextContent("Tap a star to rate");
  });

  it("submits the score + comment, then goes online when offline (\"Submit and go online\")", async () => {
    mockLocationGranted();
    const contract = await renderTrustApp({
      [PENDING]: ok([pendingFixture()]),
      [RATE]: { status: 204 },
      [SET_AVAILABILITY]: ok(availabilityFixture({ online: true })),
    });

    await screen.findByTestId("rate-rider-screen");
    fireEvent.press(screen.getByTestId("rate-star-5"));
    expect(screen.getByTestId("rate-score-label")).toHaveTextContent("Excellent");
    expect(screen.getByTestId("rate-star-5").props.accessibilityState.checked).toBe(true);
    fireEvent.changeText(screen.getByTestId("rate-comment"), "  Friendly and on time  ");
    expect(screen.getByTestId("rate-submit")).toHaveTextContent("Submit and go online");
    fireEvent.press(screen.getByTestId("rate-submit"));

    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    expect(contract.requestsTo(RATE)[0].body).toEqual({
      score: 5,
      comment: "Friendly and on time",
    });
    await waitFor(() =>
      expect(contract.requestsTo(SET_AVAILABILITY)[0]?.body).toEqual({ online: true }),
    );
  });

  it("sends a null comment and does not toggle availability when already online", async () => {
    const contract = await renderTrustApp({
      "GET /api/v1/driver/availability": ok(availabilityFixture({ online: true })),
      [PENDING]: ok([pendingFixture()]),
      [RATE]: { status: 204 },
    });
    await screen.findByTestId("rate-rider-screen");
    fireEvent.press(screen.getByTestId("rate-star-2"));
    expect(screen.getByTestId("rate-score-label")).toHaveTextContent("Bad");
    fireEvent.press(screen.getByTestId("rate-submit"));

    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    expect(contract.requestsTo(RATE)[0].body).toEqual({ score: 2, comment: null });
    expect(contract.requestsTo(SET_AVAILABILITY)).toHaveLength(0);
  });

  it("skip closes the prompt, is remembered, and a cold start does not ask again", async () => {
    const contract = await renderTrustApp({ [PENDING]: ok([pendingFixture()]) });
    await screen.findByTestId("rate-rider-screen");

    fireEvent.press(screen.getByTestId("rate-skip"));

    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    expect(contract.requestsTo(RATE)).toHaveLength(0);
    await waitFor(async () =>
      expect(JSON.parse((await AsyncStorage.getItem(RATING_SKIPS_KEY)) ?? "[]")).toEqual([
        RIDE_ID,
      ]),
    );

    // Next cold start: the same pending ride does not prompt again.
    screen.unmount();
    await renderTrustApp({ [PENDING]: ok([pendingFixture()]) });
    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("rate-rider-screen")).toBeNull());
  });

  it("409 rating_window_closed (E1): explains and ends with Done", async () => {
    await renderTrustApp({
      [PENDING]: ok([pendingFixture()]),
      [RATE]: coded(409, "rating_window_closed"),
    });
    await screen.findByTestId("rate-rider-screen");
    fireEvent.press(screen.getByTestId("rate-star-4"));
    fireEvent.press(screen.getByTestId("rate-submit"));

    expect(await screen.findByTestId("rate-error-windowClosed")).toHaveTextContent(
      "The 7-day rating window for this trip has closed.",
    );
    expect(screen.queryByTestId("rate-submit")).toBeNull();
    fireEvent.press(screen.getByTestId("rate-done"));
    expect(await screen.findByTestId("home-screen")).toBeTruthy();
  });

  it("409 rating_already_submitted (E2): ratings are immutable", async () => {
    await renderTrustApp({
      [PENDING]: ok([pendingFixture()]),
      [RATE]: coded(409, "rating_already_submitted"),
    });
    await screen.findByTestId("rate-rider-screen");
    fireEvent.press(screen.getByTestId("rate-star-3"));
    fireEvent.press(screen.getByTestId("rate-submit"));

    expect(await screen.findByTestId("rate-error-alreadyRated")).toHaveTextContent(
      "You've already rated this trip. Ratings can't be changed.",
    );
    // Stars are locked once the rating is closed.
    expect(screen.getByTestId("rate-star-5").props.accessibilityState.disabled).toBe(true);
  });

  it("403 account_suspended: a clear final notice, no retry (D-W2)", async () => {
    const contract = await renderTrustApp({
      [PENDING]: ok([pendingFixture()]),
      [RATE]: coded(403, "account_suspended"),
      "GET /api/v1/users/me": ok(driverUser()),
    });
    await screen.findByTestId("rate-rider-screen");
    fireEvent.press(screen.getByTestId("rate-star-5"));
    fireEvent.press(screen.getByTestId("rate-submit"));

    expect(await screen.findByTestId("rate-error-accountSuspended")).toHaveTextContent(
      "Your account is suspended, so this isn't available.",
    );
    expect(screen.queryByTestId("rate-submit")).toBeNull();
    fireEvent.press(screen.getByTestId("rate-done"));
    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    expect(contract.requestsTo(RATE)).toHaveLength(1);
  });

  it("a network failure keeps the score and can be retried", async () => {
    const contract = await renderTrustApp({
      [PENDING]: ok([pendingFixture()]),
      [RATE]: [{ status: 500, body: { status: 500, message: "x" } }, { status: 204 }],
    });
    await screen.findByTestId("rate-rider-screen");
    fireEvent.press(screen.getByTestId("rate-star-4"));
    fireEvent.press(screen.getByTestId("rate-submit"));
    expect(await screen.findByTestId("rate-error-server")).toBeTruthy();

    fireEvent.press(screen.getByTestId("rate-submit"));
    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    expect(contract.requestsTo(RATE)).toHaveLength(2);
    expect(contract.requestsTo(RATE)[1].body).toEqual({ score: 4, comment: null });
  });

  it("prompts right after a ride: cash confirmed → earnings breakdown → rating", async () => {
    const contract = await renderTrustApp({
      [ACTIVE_RIDE]: ok(completedRide()),
      [CASH_CONFIRM]: ok(completedRide({ paymentStatus: "paid_cash" })),
      [EARNINGS]: ok(earningPage([tripEarningFixture()])),
      // Activation: nothing pending yet; after the ride: this ride.
      [PENDING]: [ok([]), ok([pendingFixture()])],
    });

    fireEvent.press(await screen.findByTestId("cash-received"));
    fireEvent.press(await screen.findByTestId("trip-earnings-done"));

    expect(await screen.findByTestId("rate-rider-screen")).toBeTruthy();
    expect(screen.getByTestId("rate-subtitle")).toHaveTextContent("· cash collected", {
      exact: false,
    });
    expect(contract.requestsTo(PENDING).length).toBeGreaterThanOrEqual(2);
  });

  it("prompts after the cash is marked unpaid (no breakdown) — says so", async () => {
    await renderTrustApp({
      [ACTIVE_RIDE]: ok(completedRide()),
      [MARK_UNPAID]: ok(completedRide({ paymentStatus: "unpaid" })),
      [PENDING]: [ok([]), ok([pendingFixture()])],
    });

    fireEvent.press(await screen.findByTestId("mark-unpaid"));

    expect(await screen.findByTestId("rate-rider-screen")).toBeTruthy();
    expect(screen.getByTestId("rate-subtitle")).toHaveTextContent("· marked unpaid", {
      exact: false,
    });
  });

  it("never prompts for a cancelled ride (the server does not list it)", async () => {
    const contract = await renderTrustApp({
      [ACTIVE_RIDE]: ok(rideFixture()),
      [CANCEL]: ok(rideFixture({ state: "cancelled_by_driver" })),
      [PENDING]: ok([]),
    });

    fireEvent.press(await screen.findByTestId("ride-cancel-open"));
    fireEvent.press(await screen.findByTestId("cancel-reason-vehicle_issue"));
    fireEvent.press(screen.getByTestId("cancel-confirm"));

    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    // Asked once at activation and once after the ride ended — no prompt.
    await waitFor(() => expect(contract.requestsTo(PENDING)).toHaveLength(2));
    expect(screen.queryByTestId("rate-rider-screen")).toBeNull();
  });

  it("re-accessible from Trips within the window: chip → rate → back", async () => {
    const contract = await renderTrustApp(
      {
        // Activation + the Trips list; once rated, the server drops it.
        [PENDING]: [ok([pendingFixture()]), ok([pendingFixture()]), ok([])],
        [summaryRoute("weekly", todayIso())]: ok(summaryFixture()),
        [EARNINGS]: ok(earningPage([tripEarningFixture()])),
        "GET /api/v1/driver/balance": { status: 500, body: {} },
        [RATE]: { status: 204 },
      },
      { initialUrl: "/earnings" },
    );

    const chip = await screen.findByTestId(`trip-rate-${RIDE_ID}`);
    expect(chip).toHaveTextContent("Rate Rana · 7 days left", { exact: false });
    fireEvent.press(chip);

    expect(await screen.findByTestId("rate-rider-screen")).toBeTruthy();
    expect(screen.getByTestId("rate-submit")).toHaveTextContent("Submit rating");
    expect(screen.queryByTestId("rate-skipped-hint")).toBeNull();
    fireEvent.press(screen.getByTestId("rate-star-5"));
    fireEvent.press(screen.getByTestId("rate-submit"));

    expect(await screen.findByTestId("earnings-screen")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByTestId(`trip-rate-${RIDE_ID}`)).toBeNull(),
    );
    expect(contract.requestsTo(RATE)).toHaveLength(1);
  });

  it("a ride whose window closed is no longer rateable from history", async () => {
    await renderTrustApp(
      { [PENDING]: ok([]) },
      { initialUrl: `/rate-rider?rideId=${RIDE_ID}` },
    );
    expect(await screen.findByText("This trip can no longer be rated.")).toBeTruthy();
  });

  it("renders in Arabic, right to left, with Western digits", async () => {
    const restore = simulateArabicIndicIcu();
    try {
      await setAppLanguage("ar");
      await renderTrustApp({ [PENDING]: ok([pendingFixture()]) }, { language: "ar" });
      expect(await screen.findByTestId("rate-title")).toHaveTextContent(
        "كيف كان Rana كراكب؟",
      );
      expect(screen.getByTestId("rate-submit")).toHaveTextContent("إرسال وبدء الاتصال");
      fireEvent.press(screen.getByTestId("rate-star-5"));
      expect(screen.getByTestId("rate-score-label")).toHaveTextContent("ممتاز");
      expect(screen.getByTestId("rate-subtitle").props.children).not.toMatch(
        NON_WESTERN_DIGITS,
      );
      expect(JSON.stringify(screen.getByTestId("rate-skipped-hint").props.children)).not.toMatch(
        NON_WESTERN_DIGITS,
      );
    } finally {
      restore();
    }
  });
});

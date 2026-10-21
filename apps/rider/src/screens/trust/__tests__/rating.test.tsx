/**
 * M11-T3 rating (UC-S-17, RATE-01) against trust-v1.yaml mocks: the rating
 * screen (stars, score word, optional comment, anonymity note, window
 * line), submit → 204, skip, each 409 (window closed / already rated / not
 * completed) and a generic failure; a ride whose own state is no longer
 * `pending` opens as the notice; the post-ride prompt comes before the
 * ride-complete screen and is skippable; the cold-start prompt opens the
 * newest pending ride never prompted; Arabic / RTL rendering.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { StyleSheet } from "react-native";

import { LANGUAGE_STORAGE_KEY, LocaleProvider } from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  FakeSocket,
  fakeSocketFactory,
  RIDE_ID,
  sampleDriver,
} from "../../../test-utils/ride-fixtures";
import {
  coded,
  completedRide,
  inDays,
  pendingPrompt,
  RIDE_2,
} from "../../../test-utils/trust-fixtures";
import {
  PROMPTED_RATINGS_KEY,
  resetRatingPromptCheck,
} from "../../../trust/rating-prompts";
import HomeScreen from "../../home-screen";
import RideScreen from "../../ride/ride-screen";
import RateScreen from "../rate-screen";

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

const RIDE = `GET /api/v1/rides/${RIDE_ID}`;
const RATE = `POST /api/v1/rides/${RIDE_ID}/rating`;

function renderRate() {
  return render(
    <LocaleProvider>
      <RateScreen rideId={RIDE_ID} />
    </LocaleProvider>,
  );
}

async function prompted(): Promise<string[]> {
  return JSON.parse((await AsyncStorage.getItem(PROMPTED_RATINGS_KEY)) ?? "[]");
}

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  resetRatingPromptCheck();
});

describe("rating screen (UC-S-17)", () => {
  it("rates the driver: stars, score word, comment, anonymity, 204", async () => {
    const windowEndsAt = "2026-10-22T09:43:00Z";
    const api = mockApi({
      [RIDE]: {
        status: 200,
        body: completedRide({ state: "pending", windowEndsAt }),
      },
      [RATE]: { status: 204 },
    });
    await renderRate();

    expect(
      await screen.findByText("How was your ride with \u2068Samer\u2069?"),
    ).toBeOnTheScreen();
    expect(screen.getByText(/Umayyad Square/)).toBeOnTheScreen();
    expect(screen.getByTestId("rating-anonymous")).toHaveTextContent(
      "Your rating is anonymous. \u2068Samer\u2069 only ever sees an overall average, never who rated or for which ride.",
    );
    expect(screen.getByTestId("rating-window")).toHaveTextContent(
      "You can rate this ride from Your rides until Oct 22.",
    );
    // Nothing chosen yet: Submit is disabled.
    expect(screen.getByTestId("rating-submit")).toBeDisabled();
    expect(screen.getByLabelText("4 stars")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("rating-star-4"));
    expect(screen.getByTestId("rating-score-label")).toHaveTextContent("Good");
    expect(screen.getByTestId("rating-star-4")).toBeChecked();
    expect(screen.getAllByTestId("icon-star")).toHaveLength(4);
    expect(screen.getAllByTestId("icon-star-outline")).toHaveLength(1);

    await fireEvent.changeText(
      screen.getByTestId("rating-comment"),
      "  Clean car, a little late to pickup.  ",
    );
    await fireEvent.press(screen.getByTestId("rating-submit"));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/rating`)[0].body).toEqual({
      score: 4,
      comment: "Clean car, a little late to pickup.",
    });
    expect(await prompted()).toEqual([RIDE_ID]);
  });

  it("sends a null comment when none was typed", async () => {
    const api = mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [RATE]: { status: 204 },
    });
    await renderRate();
    await fireEvent.press(await screen.findByTestId("rating-star-5"));
    expect(screen.getByTestId("rating-score-label")).toHaveTextContent("Great");
    await fireEvent.press(screen.getByTestId("rating-submit"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/rating`)[0].body).toEqual({
      score: 5,
      comment: null,
    });
  });

  it("skips without rating", async () => {
    const api = mockApi({ [RIDE]: { status: 200, body: completedRide() } });
    await renderRate();
    await fireEvent.press(await screen.findByTestId("rating-skip"));
    expect(mockBack).toHaveBeenCalled();
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/rating`)).toHaveLength(0);
    await waitFor(async () => expect(await prompted()).toEqual([RIDE_ID]));
  });

  it.each([
    [
      "rating_window_closed",
      "The rating window for this ride has closed — rides can be rated for 7 days after they end.",
    ],
    [
      "rating_already_submitted",
      "You've already rated this ride. Ratings can't be changed.",
    ],
    ["ride_not_completed", "Only completed rides can be rated."],
  ])("explains a 409 %s and closes", async (code, copy) => {
    mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [RATE]: coded(409, code),
    });
    await renderRate();
    await fireEvent.press(await screen.findByTestId("rating-star-3"));
    await fireEvent.press(screen.getByTestId("rating-submit"));

    expect(await screen.findByTestId("rating-blocked")).toHaveTextContent(copy);
    // The form is gone: no stars, no Skip — only Close.
    expect(screen.queryByTestId("rating-stars")).toBeNull();
    expect(screen.queryByTestId("rating-skip")).toBeNull();
    await fireEvent.press(screen.getByTestId("rating-close"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("keeps the form after a generic failure for another try", async () => {
    const api = mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [RATE]: [{ status: 500, body: { status: 500, message: "boom" } }, { status: 204 }],
    });
    await renderRate();
    await fireEvent.press(await screen.findByTestId("rating-star-2"));
    await fireEvent.press(screen.getByTestId("rating-submit"));
    expect(await screen.findByTestId("rating-error")).toHaveTextContent(
      "Couldn't send your rating. Please try again.",
    );
    expect(mockBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("rating-submit"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/rating`)).toHaveLength(2);
  });

  it.each([
    [{ state: "submitted" as const, score: 5 }, "You've already rated this ride."],
    [{ state: "expired" as const }, "The rating window for this ride has closed"],
  ])("opens a ride already %j as the notice", async (myRating, copy) => {
    mockApi({ [RIDE]: { status: 200, body: completedRide(myRating) } });
    await renderRate();
    expect(await screen.findByTestId("rating-blocked")).toHaveTextContent(
      new RegExp(copy),
    );
    expect(screen.queryByTestId("rating-submit")).toBeNull();
  });

  it("renders in Arabic, right to left, with Western digits", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({
      [RIDE]: {
        status: 200,
        body: completedRide({
          state: "pending",
          windowEndsAt: "2026-10-22T09:43:00Z",
        }),
      },
    });
    await renderRate();

    // W2: the whole title, the name in a first-strong isolate.
    const title = await screen.findByText("كيف كانت رحلتك مع ⁨Samer⁩؟");
    expect(StyleSheet.flatten(title.props.style)).toMatchObject({
      writingDirection: "rtl",
    });
    expect(screen.getByText("تخطي")).toBeOnTheScreen();
    expect(screen.getByText("إرسال التقييم")).toBeOnTheScreen();
    expect(screen.getByTestId("rating-anonymous")).toHaveTextContent(
      "تقييمك مجهول الهوية. يرى \u2068Samer\u2069 متوسطاً عاماً فقط، ولا يعرف أبداً من قيّمه أو في أي رحلة.",
    );
    // Star 1 sits at the reading start: the row mirrors in RTL.
    expect(
      StyleSheet.flatten(screen.getByTestId("rating-stars").props.style),
    ).toMatchObject({ flexDirection: "row-reverse" });
    expect(screen.getByLabelText("نجمتان")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("rating-star-4"));
    expect(screen.getByTestId("rating-score-label")).toHaveTextContent("جيدة");
    // Western digits in the window line (NFR-I2).
    expect(screen.getByTestId("rating-window")).toHaveTextContent(/22/);
    expect(screen.getByTestId("rating-window")).not.toHaveTextContent(/[٠-٩]/);
  });

  it("never clips the driver's name off the Arabic title (W2)", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({
      [RIDE]: {
        status: 200,
        body: completedRide(undefined, {
          driver: {
            ...sampleDriver,
            firstName: "عبد الرحمن",
            photoUrl: "https://cdn.example/broken.jpg",
          },
        }),
      },
    });
    await renderRate();

    const title = await screen.findByTestId("rating-title");
    expect(title).toHaveTextContent("كيف كانت رحلتك مع ⁨عبد الرحمن⁩؟");
    // Full width, an explicit Arabic line height and the simple Android
    // break strategy: the last word is never pushed onto an undrawn line.
    expect(title.props.textBreakStrategy).toBe("simple");
    expect(StyleSheet.flatten(title.props.style)).toMatchObject({
      alignSelf: "stretch",
      fontSize: 26,
      lineHeight: 39,
    });
    // A photo that fails to load falls back to the initials.
    await fireEvent(screen.getByTestId("driver-photo"), "error");
    expect(screen.queryByTestId("driver-photo")).toBeNull();
    expect(screen.getByText("عا")).toBeOnTheScreen();
  });
});

describe("post-ride prompt (RATE-01)", () => {
  function renderRide() {
    return render(
      <LocaleProvider>
        <RideProvider socketFactory={fakeSocketFactory}>
          <RideScreen rideId={RIDE_ID} />
        </RideProvider>
      </LocaleProvider>,
    );
  }

  it("asks for the rating first; Skip shows the ride-complete screen", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [RIDE]: { status: 200, body: completedRide() },
    });
    await renderRide();

    expect(
      await screen.findByText("How was your ride with \u2068Samer\u2069?"),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-completed")).toBeNull();

    await fireEvent.press(screen.getByTestId("rating-skip"));
    expect(await screen.findByTestId("ride-completed")).toBeOnTheScreen();
    expect(screen.getByText("You've arrived")).toBeOnTheScreen();
    await waitFor(async () => expect(await prompted()).toEqual([RIDE_ID]));
  });

  it("goes on to the ride-complete screen after submitting", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [RIDE]: { status: 200, body: completedRide() },
      [RATE]: { status: 204 },
    });
    await renderRide();
    await fireEvent.press(await screen.findByTestId("rating-star-5"));
    await fireEvent.press(screen.getByTestId("rating-submit"));
    expect(await screen.findByTestId("ride-completed")).toBeOnTheScreen();
  });

  it("does not prompt when the ride was already rated", async () => {
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      [RIDE]: {
        status: 200,
        body: completedRide({ state: "submitted", score: 4 }),
      },
    });
    await renderRide();
    expect(await screen.findByTestId("ride-completed")).toBeOnTheScreen();
    expect(screen.queryByTestId("rating-screen")).toBeNull();
  });
});

describe("cold-start prompt (GET /ratings/pending)", () => {
  function renderHome() {
    return render(
      <LocaleProvider>
        <RideProvider socketFactory={fakeSocketFactory}>
          <HomeScreen />
        </RideProvider>
      </LocaleProvider>,
    );
  }

  it("opens the newest pending ride once per launch", async () => {
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/ratings/pending": {
        status: 200,
        body: [pendingPrompt(), pendingPrompt({ rideId: RIDE_2, completedAt: inDays(-3) })],
      },
    });
    await renderHome();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/rate/${RIDE_ID}`));
    expect(api.callsTo("GET", "/api/v1/ratings/pending")[0].query).toEqual({
      as: "rider",
    });
    expect(await prompted()).toEqual([RIDE_ID]);

    // A second home mount in the same launch does not ask again.
    mockPush.mockClear();
    await renderHome();
    await act(async () => {});
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("skips rides already prompted on this device", async () => {
    await AsyncStorage.setItem(PROMPTED_RATINGS_KEY, JSON.stringify([RIDE_ID]));
    mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/ratings/pending": {
        status: 200,
        body: [pendingPrompt(), pendingPrompt({ rideId: RIDE_2 })],
      },
    });
    await renderHome();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/rate/${RIDE_2}`));
  });

  it("stays on home with nothing pending", async () => {
    const api = mockApi({
      "GET /api/v1/rides/active": { status: 204 },
      "GET /api/v1/ratings/pending": { status: 200, body: [] },
    });
    await renderHome();
    await waitFor(() =>
      expect(api.callsTo("GET", "/api/v1/ratings/pending")).toHaveLength(1),
    );
    await act(async () => {});
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId("home-screen")).toBeOnTheScreen();
  });
});

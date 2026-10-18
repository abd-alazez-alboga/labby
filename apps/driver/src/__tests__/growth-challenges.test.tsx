/**
 * M13-T4 — GAME-02 (UC-S-24) against growth-v1.yaml mocks: the challenges
 * screen (artboards "D13Challenges" / "D13ChallengesAr"): live progress on a
 * running challenge, the credited card once completed, upcoming and ended
 * states, the empty state, Arabic with Western digits, the settings link.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import {
  CHALLENGE_ID,
  CHALLENGES,
  challengeFixture,
  ok,
  renderGrowthApp,
} from "../test-utils/growth";

const DONE_ID = "7d000000-0000-4000-8000-000000000002";
const SOON_ID = "7d000000-0000-4000-8000-000000000003";
const OVER_ID = "7d000000-0000-4000-8000-000000000004";

function text(testID: string): string {
  const node = screen.getByTestId(testID);
  const collect = (value: unknown): string =>
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : Array.isArray(value)
        ? value.map(collect).join("")
        : value && typeof value === "object" && "props" in value
          ? collect((value as { props: { children?: unknown } }).props.children)
          : "";
  return collect(node.props.children);
}

describe("challenges (GAME-02)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("shows a running challenge with live progress, reward and region", async () => {
    await renderGrowthApp(
      { [CHALLENGES]: ok([challengeFixture()]) },
      { initialUrl: "/challenges" },
    );

    expect(await screen.findByTestId("challenges-subtitle")).toHaveTextContent(
      "Points count toward your level. They don't change payouts.",
    );
    const card = await screen.findByTestId(`challenge-${CHALLENGE_ID}`);
    expect(card).toHaveTextContent(/Weekly 40/);
    expect(card).toHaveTextContent(/40 trips · Damascus/);
    expect(card).toHaveTextContent(/\+500 pts/);
    expect(screen.getByTestId(`challenge-${CHALLENGE_ID}-count`)).toHaveTextContent(
      "26 of 40 trips",
    );
    expect(card).toHaveTextContent(/Ends /);
    // 26 of 40 → 65%.
    expect(
      screen.getByTestId(`challenge-${CHALLENGE_ID}-progress`).props
        .accessibilityValue.now,
    ).toBe(65);
    expect(screen.getByTestId("challenges-note")).toHaveTextContent(
      "Challenges count trips inside their dates in your region. If one is ended early, what you already finished still pays out.",
    );
  });

  it("a five-star-ratings goal counts ratings; upcoming and ended states show their dates", async () => {
    const now = Date.now();
    await renderGrowthApp(
      {
        [CHALLENGES]: ok([
          challengeFixture({
            challengeId: CHALLENGE_ID,
            titleEn: "Five-star streak",
            titleAr: "سلسلة 5 نجوم",
            goalType: "five_star_ratings",
            goalTarget: 10,
            rewardPoints: 350,
            myProgress: 7,
          }),
          challengeFixture({
            challengeId: SOON_ID,
            titleEn: "Next week",
            startsAt: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
            endsAt: new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString(),
            myProgress: 0,
          }),
          challengeFixture({
            challengeId: OVER_ID,
            titleEn: "September sprint",
            startsAt: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
            endsAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
            ended: true,
            myProgress: 12,
          }),
        ]),
      },
      { initialUrl: "/challenges" },
    );

    expect(
      await screen.findByTestId(`challenge-${CHALLENGE_ID}-count`),
    ).toHaveTextContent("7 of 10 five-star ratings");
    expect(screen.getByTestId(`challenge-${SOON_ID}`)).toHaveTextContent(/Starts /);
    expect(screen.getByTestId(`challenge-${OVER_ID}`)).toHaveTextContent(/Ended /);
  });

  it("a completed challenge shows the credited points exactly as paid", async () => {
    await renderGrowthApp(
      {
        [CHALLENGES]: ok([
          challengeFixture({
            challengeId: DONE_ID,
            myProgress: 40,
            myCompleted: true,
          }),
        ]),
      },
      { initialUrl: "/challenges" },
    );

    const done = await screen.findByTestId(`challenge-done-${DONE_ID}`);
    expect(done).toHaveTextContent(/Weekly 40 · Damascus/);
    expect(done).toHaveTextContent(/500 points added/);
    expect(done).toHaveTextContent(/\+500/);
  });

  it("no challenges shows the empty state", async () => {
    await renderGrowthApp(
      { [CHALLENGES]: ok([]) },
      { initialUrl: "/challenges" },
    );

    expect(await screen.findByTestId("challenges-empty")).toHaveTextContent(
      "No challenges right now — new ones will show up here.",
    );
  });

  it("renders in Arabic with Western digits (artboard \"D13ChallengesAr\")", async () => {
    const restore = simulateArabicIndicIcu();
    try {
      await setAppLanguage("ar");
      await renderGrowthApp(
        { [CHALLENGES]: ok([challengeFixture()]) },
        { initialUrl: "/challenges", language: "ar" },
      );

      expect(await screen.findByTestId("challenges-subtitle")).toHaveTextContent(
        "النقاط تحتسب لمستواك ولا تغيّر أرباحك.",
      );
      const card = await screen.findByTestId(`challenge-${CHALLENGE_ID}`);
      expect(card).toHaveTextContent(/40 في الأسبوع/);
      expect(text(`challenge-${CHALLENGE_ID}-count`)).toBe("⁦26⁩ من ⁦40⁩ رحلة");
      expect(card).toHaveTextContent(/نقطة/);
      expect(text(`challenge-${CHALLENGE_ID}-count`)).not.toMatch(
        NON_WESTERN_DIGITS,
      );
    } finally {
      restore();
    }
  });

  it("is reachable from the settings driving links", async () => {
    await renderGrowthApp(
      { [CHALLENGES]: ok([challengeFixture()]) },
      { initialUrl: "/settings" },
    );

    fireEvent.press(await screen.findByTestId("challenges-link"));
    expect(await screen.findByTestId("challenges-subtitle")).toBeTruthy();
  });
});

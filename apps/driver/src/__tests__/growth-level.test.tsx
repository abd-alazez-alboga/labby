/**
 * M13-T4 — UC-S-23/24 against growth-v1.yaml mocks: the level & badges screen
 * (artboard "D13Badges"): the level hero with progress to the next rung, the
 * trips / challenge-points split, the full badge catalog earned/unearned, the
 * payouts/dispatch note; Arabic with Western digits; the settings link.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import {
  GAMIFICATION,
  gamificationFixture,
  ok,
  renderGrowthApp,
} from "../test-utils/growth";

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

describe("level & badges (UC-S-23/24)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("shows the level hero, the trips / challenge-points split and all six badges", async () => {
    await renderGrowthApp({ [GAMIFICATION]: ok(gamificationFixture()) });

    expect(await screen.findByTestId("level-name")).toHaveTextContent("Gold");
    expect(screen.getByTestId("level-to-next")).toHaveTextContent(
      "2,160 to Platinum · your level never goes down",
    );
    // 2,840 of the 2,000 → 5,000 rung: (2840-2000)/3000 = 28%.
    expect(
      screen.getByTestId("level-progress").props.accessibilityValue.now,
    ).toBe(28);
    expect(screen.getByTestId("level-trips-value")).toHaveTextContent("612");
    expect(screen.getByTestId("level-challenge-points-value")).toHaveTextContent(
      "2,228",
    );
    expect(screen.getByTestId("level-badges-count")).toHaveTextContent(
      "Badges · 4 of 6",
    );
    for (const code of [
      "ride_10",
      "ride_50",
      "ride_100",
      "first_shared_ride",
      "first_referral",
      "five_star_week",
    ]) {
      expect(screen.getByTestId(`badge-${code}`)).toBeTruthy();
    }
    expect(screen.getByTestId("level-note")).toHaveTextContent(
      "5-star week: at least 3 ratings within 7 days, all of them 5★. Badges and levels never affect your payouts or dispatch.",
    );
  });

  it("at Platinum the hero shows the highest-level copy and a full bar", async () => {
    await renderGrowthApp({
      [GAMIFICATION]: ok(
        gamificationFixture({ level: "platinum", lifetime: 6100 }),
      ),
    });

    expect(await screen.findByTestId("level-name")).toHaveTextContent("Platinum");
    expect(screen.getByTestId("level-to-next")).toHaveTextContent(
      "Highest level · your level never goes down",
    );
    expect(
      screen.getByTestId("level-progress").props.accessibilityValue.now,
    ).toBe(100);
  });

  it("a server failure shows the retry state", async () => {
    await renderGrowthApp({
      [GAMIFICATION]: { status: 500, body: { status: 500, message: "boom" } },
    });

    expect(await screen.findByTestId("level-error")).toBeTruthy();
  });

  it("renders in Arabic with Western digits (owner ruling 2026-10-11)", async () => {
    const restore = simulateArabicIndicIcu();
    try {
      await setAppLanguage("ar");
      await renderGrowthApp(
        { [GAMIFICATION]: ok(gamificationFixture()) },
        { language: "ar" },
      );

      expect(await screen.findByTestId("level-name")).toHaveTextContent("ذهبي");
      expect(text("level-badges-count")).toBe("الشارات · ⁦4⁩ من ⁦6⁩");
      for (const id of [
        "level-to-next",
        "level-trips-value",
        "level-challenge-points-value",
        "level-badges-count",
      ]) {
        expect(text(id)).not.toMatch(NON_WESTERN_DIGITS);
      }
    } finally {
      restore();
    }
  });

  it("is reachable from the settings driving links", async () => {
    await renderGrowthApp(
      { [GAMIFICATION]: ok(gamificationFixture()) },
      { initialUrl: "/settings" },
    );

    fireEvent.press(await screen.findByTestId("level-link"));
    expect(await screen.findByTestId("level-name")).toHaveTextContent("Gold");
  });
});

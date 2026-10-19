/**
 * M15-T3 — DRV-08 (UC-D-17) against incentives-v1.yaml mocks: the driver's
 * incentives screen (boards "D15Incentives" / "D15IncentivesAr" /
 * "D15IncentivesEmpty"): weekly tier progress with the next-tier marker,
 * the live peak chip and day-grouped windows (overnight included), the
 * rating reward, the latest award, the empty region, Arabic RTL with
 * Western digits, the settings row ("D15SettingsIncentives") and the
 * `incentives` deep link of `incentive.awarded`.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { hrefForLink, parsePushPayload } from "../notifications/deep-links";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import {
  INCENTIVES,
  incentivesFixture,
  renderIncentivesApp,
  unconfiguredFixture,
} from "../test-utils/incentives";
import { ok } from "../test-utils/growth";

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

/** testIDs in render order (depth-first over the rendered tree). */
function testIdsInOrder(pattern: RegExp): string[] {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const element = node as {
      props?: { testID?: string };
      children?: unknown;
    };
    const id = element.props?.testID;
    if (id && pattern.test(id) && !ids.includes(id)) ids.push(id);
    walk(element.children);
  };
  walk(screen.toJSON());
  return ids;
}

describe("incentives (DRV-08)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("shows this week's tier, peak and rating progress with the last award", async () => {
    await renderIncentivesApp({ [INCENTIVES]: ok(incentivesFixture()) });

    expect(await screen.findByTestId("incentives-week")).toHaveTextContent(
      "This week · Mon 19 – Sun 25 Oct · Damascus",
    );

    // Weekly trip bonus: 26 of the 60 top tier, marker at the next (40).
    expect(screen.getByTestId("incentives-weekly-chip")).toHaveTextContent(
      "26 trips",
    );
    expect(
      screen.getByTestId("incentives-weekly-progress").props.accessibilityValue
        .now,
    ).toBe(43);
    expect(
      screen.getByTestId("incentives-weekly-progress-marker").props.style,
    ).toEqual(expect.arrayContaining([{ start: "67%" }]));
    expect(screen.getByTestId("incentives-weekly-tier")).toHaveTextContent(
      "40 trips → SYP 50,000",
    );
    expect(screen.getByTestId("incentives-weekly-following")).toHaveTextContent(
      "60 → SYP 100,000",
    );
    expect(screen.getByTestId("incentives-weekly-next")).toHaveTextContent(
      "14 more trips for SYP 50,000",
    );

    // Peak hours: live chip, earnings so far, windows grouped by days.
    expect(screen.getByTestId("incentives-peak")).toHaveTextContent(
      /\+SYP 1,000 per trip requested in a window/,
    );
    expect(screen.getByTestId("incentives-peak-chip")).toHaveTextContent(
      "9 trips · SYP 9,000",
    );
    expect(screen.getByTestId("incentives-peak-now")).toHaveTextContent(
      "Peak now · until 09:30",
    );
    expect(screen.getByTestId("incentives-peak-window-0")).toHaveTextContent(
      "Mon – Thu07:00 – 09:30",
    );
    // Overnight: the window reads as configured, past midnight.
    expect(screen.getByTestId("incentives-peak-window-1")).toHaveTextContent(
      "Fri – Sat22:00 – 02:00",
    );

    // Rating reward.
    expect(screen.getByTestId("incentives-rating")).toHaveTextContent(
      /Avg 4\.8\+ with 30\+ trips this week/,
    );
    expect(screen.getByTestId("incentives-rating-chip")).toHaveTextContent(
      "SYP 20,000",
    );
    expect(screen.getByTestId("incentives-rating-average")).toHaveTextContent(
      "4.86 average · 21 ratings",
    );
    expect(screen.getByTestId("incentives-rating-trips")).toHaveTextContent(
      "26 of 30 trips",
    );
    expect(
      screen.getByTestId("incentives-rating-progress").props.accessibilityValue
        .now,
    ).toBe(87);

    // The latest award and the payout note.
    expect(screen.getByTestId("incentives-award-title")).toHaveTextContent(
      "Last week · weekly trip bonus",
    );
    expect(screen.getByTestId("incentives-award-paid")).toHaveTextContent(
      "44 trips · paid Mon 19 Oct",
    );
    expect(screen.getByTestId("incentives-award-amount")).toHaveTextContent(
      "+SYP 50,000",
    );
    expect(screen.getByTestId("incentives-note")).toHaveTextContent(
      "Paid into your balance Monday morning for the week before.",
    );
  });

  it("every tier reached shows the reached amount; no chip outside peak; day lists", async () => {
    const base = incentivesFixture();
    await renderIncentivesApp({
      [INCENTIVES]: ok(
        incentivesFixture({
          weeklyTrips: {
            trips: 63,
            tiers: base.weeklyTrips!.tiers,
            reachedTier: { trips: 60, amount: 100000 },
            nextTier: null,
          },
          peak: {
            ...base.peak!,
            activeNow: false,
            activeUntil: null,
            windows: [
              // Not contiguous → a comma list.
              {
                daysOfWeek: [5, 1, 3],
                startsAt: "07:00:00",
                endsAt: "09:00:00",
              },
              // Contiguous across Sunday → a run.
              {
                daysOfWeek: [6, 7, 1],
                startsAt: "23:00:00",
                endsAt: "01:30:00",
              },
            ],
          },
          rating: { ...base.rating!, average: null, ratingCount: 0 },
          recentAwards: [
            {
              ...base.recentAwards[0],
              weekStart: "2026-10-05",
              kind: "peak_hours",
              amount: 12000,
              trips: 12,
              threshold: null,
              awardedAt: "2026-10-12T06:00:00Z",
            },
          ],
        }),
      ),
    });

    expect(
      await screen.findByTestId("incentives-weekly-next"),
    ).toHaveTextContent("Top tier reached · SYP 100,000");
    expect(screen.getByTestId("incentives-weekly-tier")).toHaveTextContent(
      "60 trips → SYP 100,000",
    );
    expect(screen.queryByTestId("incentives-weekly-following")).toBeNull();
    expect(
      screen.queryByTestId("incentives-weekly-progress-marker"),
    ).toBeNull();
    expect(
      screen.getByTestId("incentives-weekly-progress").props.accessibilityValue
        .now,
    ).toBe(100);

    expect(screen.queryByTestId("incentives-peak-now")).toBeNull();
    expect(screen.getByTestId("incentives-peak-window-0")).toHaveTextContent(
      "Mon, Wed, Fri07:00 – 09:00",
    );
    expect(screen.getByTestId("incentives-peak-window-1")).toHaveTextContent(
      "Sat – Mon23:00 – 01:30",
    );

    expect(screen.getByTestId("incentives-rating-average")).toHaveTextContent(
      "No ratings yet this week",
    );
    // An older award is named by its week, not "Last week".
    expect(screen.getByTestId("incentives-award-title")).toHaveTextContent(
      "Week of Mon 5 Oct · peak hours bonus",
    );
    expect(screen.getByTestId("incentives-award-paid")).toHaveTextContent(
      "12 trips · paid Mon 12 Oct",
    );
  });

  it("a region without incentives shows the empty state", async () => {
    await renderIncentivesApp({ [INCENTIVES]: ok(unconfiguredFixture()) });

    const empty = await screen.findByTestId("incentives-empty");
    expect(empty).toHaveTextContent(/No incentives in Damascus yet/);
    expect(empty).toHaveTextContent(
      /When Labby turns on weekly bonuses, peak hours or rating rewards for your region, your progress shows here\./,
    );
    expect(screen.queryByTestId("incentives-week")).toBeNull();
    expect(screen.queryByTestId("incentives-weekly")).toBeNull();
    expect(screen.queryByTestId("incentives-note")).toBeNull();
  });

  it('renders in Arabic RTL with Western digits (board "D15IncentivesAr")', async () => {
    const restore = simulateArabicIndicIcu();
    try {
      await setAppLanguage("ar");
      await renderIncentivesApp(
        { [INCENTIVES]: ok(incentivesFixture()) },
        { language: "ar" },
      );

      expect(await screen.findByTestId("incentives-week")).toHaveTextContent(
        /^هذا الأسبوع · الاثنين .*19.* – الأحد .*25.* أكتوبر · Damascus$/,
      );
      expect(text("incentives-weekly-chip")).toBe("⁦26⁩ رحلة");
      expect(text("incentives-weekly-tier")).toBe("⁦40⁩ رحلة ← ⁦50,000⁩ ل.س");
      expect(text("incentives-weekly-following")).toBe("⁦60⁩ ← ⁦100,000⁩ ل.س");
      expect(text("incentives-weekly-next")).toBe(
        "⁦14⁩ رحلة إضافية للحصول على ⁦50,000⁩ ل.س",
      );
      expect(text("incentives-peak-chip")).toBe("⁦9⁩ رحلات · ⁦9,000⁩ ل.س");
      expect(screen.getByTestId("incentives-peak-now")).toHaveTextContent(
        "ذروة الآن · حتى ⁦09:30⁩",
      );
      expect(screen.getByTestId("incentives-peak-window-0")).toHaveTextContent(
        "الاثنين – الخميس⁦07:00 – 09:30⁩",
      );
      expect(text("incentives-rating-average")).toBe(
        "متوسط ⁦4.86⁩ · ⁦21⁩ تقييماً",
      );
      expect(text("incentives-rating-trips")).toBe("⁦26⁩ من ⁦30⁩ رحلة");
      expect(text("incentives-award-title")).toBe(
        "الأسبوع الماضي · مكافأة الرحلات",
      );
      expect(text("incentives-award-amount")).toBe("⁦+50,000⁩ ل.س");
      expect(screen.getByTestId("incentives-note")).toHaveTextContent(
        "تُضاف إلى رصيدك صباح الاثنين عن الأسبوع السابق.",
      );
      // Rows are reversed by hand and the marker measures from the right.
      expect(
        screen.getByTestId("incentives-weekly-progress-marker").props.style,
      ).toEqual(expect.arrayContaining([{ end: "67%" }]));
      for (const id of [
        "incentives-week",
        "incentives-weekly-tier",
        "incentives-award-paid",
        "incentives-peak-window-1",
      ]) {
        expect(text(id)).not.toMatch(NON_WESTERN_DIGITS);
      }
      expect(screen.getByTestId("incentives-week")).not.toHaveTextContent(
        NON_WESTERN_DIGITS,
      );
    } finally {
      restore();
    }
  });

  it("sits right after Balance in the settings menu and opens the screen", async () => {
    await renderIncentivesApp(
      { [INCENTIVES]: ok(incentivesFixture()) },
      { initialUrl: "/settings" },
    );

    const link = await screen.findByTestId("incentives-link");
    expect(link).toHaveTextContent(/Incentives/);
    const order = testIdsInOrder(
      /^(earnings|balance|incentives|performance)-link$/,
    );
    expect(order).toEqual([
      "earnings-link",
      "balance-link",
      "incentives-link",
      "performance-link",
    ]);

    fireEvent.press(link);
    expect(await screen.findByTestId("incentives-week")).toBeTruthy();
  });

  it("maps the incentive.awarded deep link to the screen", () => {
    const payload = parsePushPayload({
      notificationId: "n-1",
      category: "account",
      event: "incentive.awarded",
      screen: "incentives",
      params: "{}",
    });
    expect(payload.event).toBe("incentive.awarded");
    expect(hrefForLink(payload.link, { isDriver: true })).toBe("/incentives");
    // The screen lives behind the driver gate.
    expect(hrefForLink(payload.link, { isDriver: false })).toBe(
      "/notifications",
    );
  });
});

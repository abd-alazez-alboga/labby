/**
 * M15-T3 — DRV-08 (UC-D-17) against incentives-v1.yaml mocks: the driver's
 * incentives screen (boards "D15Incentives" / "D15IncentivesAr" /
 * "D15IncentivesEmpty" / "D15IncentivesSecured" / "D15IncentivesSecuredAr"):
 * weekly tier progress with the next-tier marker and the tier secured
 * between tiers, the live peak chip and day-grouped windows (overnight
 * included), the rating reward, the latest paid week's awards, the loading,
 * error, no-region and empty states (incentives switched off included),
 * Arabic RTL with Western digits, the settings row ("D15SettingsIncentives")
 * and the `incentives` deep link of `incentive.awarded`.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import type { IncentiveProgress } from "../api/incentives-types";
import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { dateInZone } from "../incentives/format";
import { hrefForLink, parsePushPayload } from "../notifications/deep-links";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import {
  INCENTIVES,
  incentivesFixture,
  renderIncentivesApp,
  unconfiguredFixture,
} from "../test-utils/incentives";
import { ok, RESOLVE_REGION } from "../test-utils/growth";

/** The 45-trip state between the 40 and 60 tiers (board "D15IncentivesSecured"). */
function securedFixture(): IncentiveProgress {
  const base = incentivesFixture();
  return incentivesFixture({
    weeklyTrips: {
      trips: 45,
      tiers: base.weeklyTrips!.tiers,
      reachedTier: { trips: 40, amount: 50000 },
      nextTier: { trips: 60, amount: 100000 },
    },
  });
}

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
    // No tier reached yet: nothing is secured.
    expect(screen.queryByTestId("incentives-weekly-secured")).toBeNull();
    // The bars announce their counts, not just a percentage.
    expect(
      screen.getByTestId("incentives-weekly-progress").props.accessibilityLabel,
    ).toBe("26 of 60 trips");
    expect(
      screen.getByTestId("incentives-rating-progress").props.accessibilityLabel,
    ).toBe("26 of 30 trips");

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
      /Weekly average 4\.8\+ with 30\+ trips/,
    );
    expect(screen.getByTestId("incentives-rating-chip")).toHaveTextContent(
      "SYP 20,000",
    );
    // Nightly average only — never a count (RATE-02, V1FD15IncentivesNightly).
    expect(screen.getByTestId("incentives-rating-status")).toHaveTextContent(
      "Not yet · 4 more trips",
    );
    expect(screen.getByTestId("incentives-rating-target")).toHaveTextContent(
      "Target 4.8",
    );
    expect(screen.getByTestId("incentives-rating-average")).toHaveTextContent(
      /^Weekly average\s*4\.86/,
    );
    expect(screen.getByTestId("incentives-rating-average-met")).toBeTruthy();
    expect(screen.getByTestId("incentives-rating-trips")).toHaveTextContent(
      "26 / 30 trips",
    );
    expect(screen.getByTestId("incentives-rating-note")).toHaveTextContent(
      "Average as of last night · updated daily, not after each ride.",
    );
    expect(screen.getByTestId("incentives-rating")).not.toHaveTextContent(
      /ratings?\b/,
    );
    expect(
      screen.getByTestId("incentives-rating-progress").props.accessibilityValue
        .now,
    ).toBe(87);

    // The latest award and the payout note.
    expect(screen.getByTestId("incentives-award-0-title")).toHaveTextContent(
      "Last week · weekly trip bonus",
    );
    expect(screen.getByTestId("incentives-award-0-paid")).toHaveTextContent(
      "44 trips · paid Mon 19 Oct",
    );
    expect(screen.getByTestId("incentives-award-0-amount")).toHaveTextContent(
      "+SYP 50,000",
    );
    // Last week paid one award: one row.
    expect(screen.queryByTestId("incentives-award-1")).toBeNull();
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
          rating: { ...base.rating!, average: null, averageAsOf: null },
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
    // The top tier line already names the amount; no separate secured line.
    expect(screen.queryByTestId("incentives-weekly-secured")).toBeNull();

    expect(screen.queryByTestId("incentives-peak-now")).toBeNull();
    expect(screen.getByTestId("incentives-peak-window-0")).toHaveTextContent(
      "Mon, Wed, Fri07:00 – 09:00",
    );
    expect(screen.getByTestId("incentives-peak-window-1")).toHaveTextContent(
      "Sat – Mon23:00 – 01:30",
    );

    expect(screen.getByTestId("incentives-rating-average")).toHaveTextContent(
      "No weekly average yet",
    );
    expect(screen.queryByTestId("incentives-rating-average-met")).toBeNull();
    // An older award is named by its week, not "Last week".
    expect(screen.getByTestId("incentives-award-0-title")).toHaveTextContent(
      "Week of Mon 5 Oct · peak hours bonus",
    );
    expect(screen.getByTestId("incentives-award-0-paid")).toHaveTextContent(
      "12 trips · paid Mon 12 Oct",
    );
  });

  it('between tiers shows the secured tier under the next-tier progress (board "D15IncentivesSecured")', async () => {
    await renderIncentivesApp({ [INCENTIVES]: ok(securedFixture()) });

    expect(
      await screen.findByTestId("incentives-weekly-chip"),
    ).toHaveTextContent("45 trips");
    expect(
      screen.getByTestId("incentives-weekly-progress").props.accessibilityValue
        .now,
    ).toBe(75);
    expect(
      screen.getByTestId("incentives-weekly-progress").props.accessibilityLabel,
    ).toBe("45 of 60 trips");
    // The next tier is the top one: no marker, nothing greyed beside it.
    expect(
      screen.queryByTestId("incentives-weekly-progress-marker"),
    ).toBeNull();
    expect(screen.queryByTestId("incentives-weekly-following")).toBeNull();
    expect(screen.getByTestId("incentives-weekly-tier")).toHaveTextContent(
      "60 trips → SYP 100,000",
    );
    expect(screen.getByTestId("incentives-weekly-next")).toHaveTextContent(
      "15 more trips for SYP 100,000",
    );
    expect(
      screen.getByTestId("incentives-weekly-secured-text"),
    ).toHaveTextContent("SYP 50,000 secured · paid Monday");
  });

  it('between tiers in Arabic RTL with Western digits (board "D15IncentivesSecuredAr")', async () => {
    const restore = simulateArabicIndicIcu();
    try {
      await setAppLanguage("ar");
      await renderIncentivesApp(
        { [INCENTIVES]: ok(securedFixture()) },
        { language: "ar" },
      );

      await screen.findByTestId("incentives-weekly-secured");
      expect(text("incentives-weekly-chip")).toBe("⁦45⁩ رحلة");
      expect(text("incentives-weekly-tier")).toBe("⁦60⁩ رحلة ← ⁦100,000⁩ ل.س");
      expect(text("incentives-weekly-next")).toBe(
        "⁦15⁩ رحلة إضافية للحصول على ⁦100,000⁩ ل.س",
      );
      expect(text("incentives-weekly-secured-text")).toBe(
        "⁦50,000⁩ ل.س مضمونة · تُدفع يوم الاثنين",
      );
      expect(
        screen.getByTestId("incentives-weekly-progress").props
          .accessibilityLabel,
      ).toBe("⁦45⁩ من ⁦60⁩ رحلة");
      // The check icon sits on the start (right) side in RTL.
      expect(
        screen.getByTestId("incentives-weekly-secured").props.style,
      ).toEqual(expect.arrayContaining([{ flexDirection: "row-reverse" }]));
      expect(text("incentives-weekly-secured-text")).not.toMatch(
        NON_WESTERN_DIGITS,
      );
    } finally {
      restore();
    }
  });

  it("shows every award of the most recent paid week", async () => {
    const base = incentivesFixture();
    await renderIncentivesApp({
      [INCENTIVES]: ok(
        incentivesFixture({
          recentAwards: [
            base.recentAwards[0],
            {
              ...base.recentAwards[0],
              kind: "peak_hours",
              amount: 9000,
              trips: 9,
              threshold: null,
            },
            // An older week: not shown.
            {
              ...base.recentAwards[0],
              weekStart: "2026-10-05",
              kind: "rating",
              amount: 20000,
              trips: 31,
              threshold: null,
              avgRating: 4.9,
              awardedAt: "2026-10-12T06:00:00Z",
            },
          ],
        }),
      ),
    });

    expect(
      await screen.findByTestId("incentives-award-0-title"),
    ).toHaveTextContent("Last week · weekly trip bonus");
    expect(screen.getByTestId("incentives-award-0-amount")).toHaveTextContent(
      "+SYP 50,000",
    );
    expect(screen.getByTestId("incentives-award-1-title")).toHaveTextContent(
      "Last week · peak hours bonus",
    );
    expect(screen.getByTestId("incentives-award-1-paid")).toHaveTextContent(
      "9 trips · paid Mon 19 Oct",
    );
    expect(screen.getByTestId("incentives-award-1-amount")).toHaveTextContent(
      "+SYP 9,000",
    );
    expect(screen.queryByTestId("incentives-award-2")).toBeNull();
  });

  it("dates an award paid just after local midnight in the region's zone (W9)", async () => {
    // Simulates an ICU whose whole-date pattern is not ISO (e.g. en-CA →
    // "10/19/2026"): the date must come from its year/month/day parts.
    const RealDateTimeFormat = Intl.DateTimeFormat;
    function NonIsoDateTimeFormat(
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      const formatter = new RealDateTimeFormat(locales, options);
      if (!options?.year) return formatter;
      return new Proxy(formatter, {
        get(target, property) {
          if (property === "format") {
            return (date: Date) =>
              formatter
                .formatToParts(date)
                .filter((part) => part.type !== "literal")
                .map((part) => part.value)
                .reverse()
                .join("/");
          }
          const member = Reflect.get(target, property) as unknown;
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
    }
    Intl.DateTimeFormat =
      NonIsoDateTimeFormat as unknown as typeof Intl.DateTimeFormat;
    try {
      // The Monday 00:30 Damascus job: still Sunday 18 Oct in UTC.
      expect(dateInZone("2026-10-18T21:30:00Z", "Asia/Damascus")).toBe(
        "2026-10-19",
      );
      expect(dateInZone("2026-10-18T21:30:00Z", "UTC")).toBe("2026-10-18");

      const base = incentivesFixture();
      await renderIncentivesApp({
        [INCENTIVES]: ok(
          incentivesFixture({
            recentAwards: [
              { ...base.recentAwards[0], awardedAt: "2026-10-18T21:30:00Z" },
            ],
          }),
        ),
      });
      expect(
        await screen.findByTestId("incentives-award-0-paid"),
      ).toHaveTextContent("44 trips · paid Mon 19 Oct");
    } finally {
      Intl.DateTimeFormat = RealDateTimeFormat;
    }
  });

  it("the rating status follows qualifies and the live trips, never a count", async () => {
    const base = incentivesFixture();
    await renderIncentivesApp({
      [INCENTIVES]: ok(
        incentivesFixture({
          rating: { ...base.rating!, trips: 31, qualifies: true },
        }),
      ),
    });
    expect(
      await screen.findByTestId("incentives-rating-status"),
    ).toHaveTextContent("Qualifies so far");
    expect(screen.getByTestId("incentives-rating-trips")).toHaveTextContent(
      "31 / 30 trips",
    );
  });

  it("enough trips under the target average reads Not yet", async () => {
    const base = incentivesFixture();
    await renderIncentivesApp({
      [INCENTIVES]: ok(
        incentivesFixture({
          rating: {
            ...base.rating!,
            average: 4.75,
            trips: 34,
            qualifies: false,
          },
        }),
      ),
    });
    expect(
      await screen.findByTestId("incentives-rating-status"),
    ).toHaveTextContent(/^Not yet$/);
    expect(screen.queryByTestId("incentives-rating-average-met")).toBeNull();
  });

  it("hides a card whose incentive is switched off", async () => {
    const base = incentivesFixture();
    await renderIncentivesApp({
      [INCENTIVES]: ok(
        incentivesFixture({
          weeklyTrips: { ...base.weeklyTrips!, tiers: [], nextTier: null },
          peak: { ...base.peak!, bonusPerTrip: 0 },
        }),
      ),
    });

    expect(await screen.findByTestId("incentives-rating")).toBeTruthy();
    expect(screen.queryByTestId("incentives-weekly")).toBeNull();
    expect(screen.queryByTestId("incentives-peak")).toBeNull();
    expect(screen.queryByTestId("incentives-empty")).toBeNull();
  });

  it("a configured region with every incentive switched off shows the empty state", async () => {
    const base = incentivesFixture();
    await renderIncentivesApp({
      [INCENTIVES]: ok(
        incentivesFixture({
          configured: true,
          weeklyTrips: { ...base.weeklyTrips!, tiers: [], nextTier: null },
          peak: { ...base.peak!, windows: [] },
          rating: { ...base.rating!, amount: 0 },
        }),
      ),
    });

    expect(await screen.findByTestId("incentives-empty")).toHaveTextContent(
      /No incentives in Damascus yet/,
    );
    expect(screen.queryByTestId("incentives-week")).toBeNull();
    expect(screen.queryByTestId("incentives-award-0")).toBeNull();
  });

  it("shows the loading state until the progress arrives", async () => {
    let release: (response: unknown) => void = () => undefined;
    const contract = await renderIncentivesApp({
      [INCENTIVES]: ok(incentivesFixture()),
    });
    const real = contract.fetchSpy.getMockImplementation()!;
    contract.fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      url.includes("/driver/incentives")
        ? new Promise((resolve) => {
            release = () => resolve(real(url, init));
          })
        : real(url, init),
    );

    expect(await screen.findByTestId("incentives-loading")).toBeTruthy();
    expect(screen.queryByTestId("incentives-week")).toBeNull();

    release(undefined);
    expect(await screen.findByTestId("incentives-week")).toBeTruthy();
    expect(screen.queryByTestId("incentives-loading")).toBeNull();
  });

  it("a failed load shows the failure state and Retry reloads", async () => {
    const contract = await renderIncentivesApp({
      [INCENTIVES]: [
        { status: 500, body: { status: 500 } },
        ok(incentivesFixture()),
      ],
    });

    expect(await screen.findByTestId("incentives-error")).toBeTruthy();
    expect(screen.queryByTestId("incentives-week")).toBeNull();

    fireEvent.press(screen.getByTestId("failure-retry"));
    expect(await screen.findByTestId("incentives-week")).toBeTruthy();
    expect(screen.queryByTestId("incentives-error")).toBeNull();
    expect(contract.requestsTo(INCENTIVES)).toHaveLength(2);
  });

  it("without a resolved region shows the no-region copy and never fetches", async () => {
    const contract = await renderIncentivesApp({
      [RESOLVE_REGION]: { status: 500, body: { status: 500 } },
      [INCENTIVES]: ok(incentivesFixture()),
    });

    expect(await screen.findByTestId("incentives-no-region")).toHaveTextContent(
      "Incentives follow your region. Turn on location to see them.",
    );
    expect(screen.queryByTestId("incentives-empty")).toBeNull();
    expect(contract.requestsTo(INCENTIVES)).toHaveLength(0);
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
      expect(screen.getByTestId("incentives-rating-status")).toHaveTextContent(
        "ليس بعد · ⁦4⁩ رحلات إضافية",
      );
      expect(screen.getByTestId("incentives-rating-target")).toHaveTextContent(
        "الهدف ⁦4.8⁩",
      );
      expect(screen.getByTestId("incentives-rating-average")).toHaveTextContent(
        /^المتوسط الأسبوعي\s*⁦4\.86⁩/,
      );
      expect(text("incentives-rating-trips")).toBe("⁦26⁩ / ⁦30⁩ رحلة");
      expect(text("incentives-award-0-title")).toBe(
        "الأسبوع الماضي · مكافأة الرحلات",
      );
      expect(text("incentives-award-0-amount")).toBe("⁦+50,000⁩ ل.س");
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
        "incentives-award-0-paid",
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

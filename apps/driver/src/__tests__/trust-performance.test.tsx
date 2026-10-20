/**
 * M11-T3 — UC-D-20 against trust-v1.yaml mocks: the performance dashboard
 * (7 / 30-day windows, the four tiles, null percentages when the
 * denominator is 0, active warnings with their rule — never a suspension —,
 * the lifetime rating, the rating-near-limit variant with the exact rule),
 * Arabic RTL with Western digits; and the rider's rating on the offer card.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import { MockSocket } from "../test-utils/realtime";
import {
  goLive,
  mockLocationGranted,
  receive,
  renderDriverApp,
  waitForResync,
} from "../test-utils/ride-harness";
import { offerFixture, offerNewFrame } from "../test-utils/rides";
import {
  ok,
  PERFORMANCE,
  performanceFixture,
  renderTrustApp,
  windowFixture,
} from "../test-utils/trust";

const warning = {
  metric: "acceptance" as const,
  valuePercent: 46.2,
  thresholdPercent: 50,
  comparison: "below" as const,
  windowDays: 30,
  sampleSize: 52,
  raisedAt: "2026-10-14T08:00:00Z",
};

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

describe("performance dashboard (UC-D-20)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("shows the 30-day window by default: the four tiles, lifetime rating and the on-time rule", async () => {
    await renderTrustApp(
      { [PERFORMANCE]: ok(performanceFixture()) },
      { initialUrl: "/performance" },
    );

    expect(await screen.findByTestId("performance-title")).toHaveTextContent("Performance");
    expect(
      screen.getByTestId("performance-window-30").props.accessibilityState.selected,
    ).toBe(true);
    expect(screen.getByTestId("tile-acceptance-value")).toHaveTextContent("46.2%");
    expect(screen.getByTestId("tile-acceptance-detail")).toHaveTextContent("24 of 52 offers");
    expect(screen.getByTestId("tile-cancellation-value")).toHaveTextContent("4.2%");
    expect(screen.getByTestId("tile-cancellation-detail")).toHaveTextContent("1 of 24 accepted");
    expect(screen.getByTestId("tile-on-time-value")).toHaveTextContent("91.3%");
    expect(screen.getByTestId("tile-on-time-detail")).toHaveTextContent("21 of 23 pickups");
    expect(screen.getByTestId("tile-trips-value")).toHaveTextContent("23");
    expect(screen.getByTestId("tile-trips-detail")).toHaveTextContent("SYP 512,000 earned");
    expect(screen.getByTestId("performance-rating-value")).toHaveTextContent("4.62");
    expect(screen.getByTestId("performance-rating-meta")).toHaveTextContent(
      "All-time · updated daily",
    );
    expect(screen.getByTestId("performance-on-time-note")).toHaveTextContent(
      "On time = you arrived no more than 5 min after the pickup time shown when you accepted.",
    );
    expect(screen.queryByTestId("performance-warning-acceptance")).toBeNull();
    expect(screen.queryByTestId("performance-rating-warning")).toBeNull();
  });

  it("switches to the 7-day window; the rating stays the lifetime one", async () => {
    await renderTrustApp(
      { [PERFORMANCE]: ok(performanceFixture()) },
      { initialUrl: "/performance" },
    );
    fireEvent.press(await screen.findByTestId("performance-window-7"));

    expect(screen.getByTestId("tile-acceptance-value")).toHaveTextContent("80%");
    expect(screen.getByTestId("tile-acceptance-detail")).toHaveTextContent("8 of 10 offers");
    expect(screen.getByTestId("tile-cancellation-value")).toHaveTextContent("12.5%");
    expect(screen.getByTestId("tile-on-time-value")).toHaveTextContent("100%");
    expect(screen.getByTestId("tile-trips-detail")).toHaveTextContent("SYP 140,000 earned");
    expect(screen.getByTestId("performance-rating-value")).toHaveTextContent("4.62");
  });

  it("a 0 denominator shows a dash, never 0%; no ratings yet shows the 5-rating rule", async () => {
    await renderTrustApp(
      {
        [PERFORMANCE]: ok(
          performanceFixture({
            windows: [
              windowFixture(7),
              windowFixture(30, {
                acceptance: { percent: null, numerator: 0, denominator: 0 },
                cancellation: { percent: null, numerator: 0, denominator: 0 },
                onTime: { percent: null, numerator: 0, denominator: 0 },
                trips: 0,
                earnings: [],
              }),
            ],
            rating: { role: "driver", average: null, snapshotAt: null },
            ratingRule: null,
          }),
        ),
      },
      { initialUrl: "/performance" },
    );

    expect(await screen.findByTestId("tile-acceptance-value")).toHaveTextContent("—");
    expect(screen.getByTestId("tile-acceptance-detail")).toHaveTextContent("No offers yet");
    expect(screen.getByTestId("tile-cancellation-detail")).toHaveTextContent(
      "No accepted rides yet",
    );
    expect(screen.getByTestId("tile-on-time-detail")).toHaveTextContent("No pickups yet");
    expect(screen.getByTestId("tile-trips-detail")).toHaveTextContent("No earnings yet");
    expect(screen.getByTestId("performance-rating-value")).toHaveTextContent("—");
    expect(screen.getByTestId("performance-rating-meta")).toHaveTextContent(
      "Your average shows after 5 ratings · updated daily",
    );
  });

  it("counts are plural-correct in English and Arabic (D-I4)", async () => {
    const small = performanceFixture({
      windows: [
        windowFixture(7),
        windowFixture(30, {
          acceptance: { percent: 100, numerator: 1, denominator: 1 },
          cancellation: { percent: 50, numerator: 1, denominator: 2 },
          onTime: { percent: 60, numerator: 3, denominator: 5 },
        }),
      ],
      warnings: [{ ...warning, sampleSize: 1, windowDays: 1 }],
    });
    await renderTrustApp({ [PERFORMANCE]: ok(small) }, { initialUrl: "/performance" });
    expect(await screen.findByTestId("tile-acceptance-detail")).toHaveTextContent(
      "1 of 1 offer",
    );
    expect(screen.getByTestId("tile-on-time-detail")).toHaveTextContent("3 of 5 pickups");
    expect(screen.getByTestId("performance-warning-acceptance")).toHaveTextContent(
      "You accepted 46.2% of 1 offer in the last 1 day.",
      { exact: false },
    );

    screen.unmount();
    await setAppLanguage("ar");
    await renderTrustApp(
      { [PERFORMANCE]: ok(small) },
      { initialUrl: "/performance", language: "ar" },
    );
    await screen.findByTestId("tile-acceptance-detail");
    expect(text("tile-acceptance-detail")).toBe("⁦1⁩ من عرض واحد");
    expect(text("tile-cancellation-detail")).toBe("⁦1⁩ من رحلتين مقبولتين");
    expect(text("tile-on-time-detail")).toBe("⁦3⁩ من ⁦5⁩ مرات وصول");
    expect(screen.getByTestId("performance-warning-acceptance")).toHaveTextContent(
      "من عرض واحد خلال آخر يوم واحد",
      { exact: false },
    );
  });

  it("shows an active warning with the rule that raised it — and that warnings never suspend", async () => {
    await renderTrustApp(
      { [PERFORMANCE]: ok(performanceFixture({ warnings: [warning] })) },
      { initialUrl: "/performance" },
    );

    const card = await screen.findByTestId("performance-warning-acceptance");
    expect(card).toHaveTextContent("Acceptance below 50%", { exact: false });
    expect(card).toHaveTextContent(
      "You accepted 46.2% of 52 offers in the last 30 days. Warnings never suspend your account — accept more offers to clear it.",
      { exact: false },
    );
    // The warned metric's tile is outlined.
    expect(screen.getByTestId("tile-acceptance").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderWidth: 2 })]),
    );
  });

  it("cancellation warning copy (above the threshold)", async () => {
    await renderTrustApp(
      {
        [PERFORMANCE]: ok(
          performanceFixture({
            warnings: [
              {
                ...warning,
                metric: "cancellation",
                comparison: "above",
                valuePercent: 18,
                thresholdPercent: 15,
                sampleSize: 40,
              },
            ],
          }),
        ),
      },
      { initialUrl: "/performance" },
    );
    expect(await screen.findByTestId("performance-warning-cancellation")).toHaveTextContent(
      "Cancellation above 15%You cancelled 18% of 40 accepted rides in the last 30 days. Warnings never suspend your account — cancel fewer rides to clear it.",
      { exact: false },
    );
  });

  it("the rating-near-limit variant states the exact suspension rule (UC-D-20 A1)", async () => {
    await renderTrustApp(
      {
        [PERFORMANCE]: ok(
          performanceFixture({
            rating: { role: "driver", average: 3.38, snapshotAt: null },
            ratingWarning: true,
          }),
        ),
      },
      { initialUrl: "/performance" },
    );

    const card = await screen.findByTestId("performance-rating-warning");
    expect(card).toHaveTextContent("Your rating is close to the limit", { exact: false });
    expect(screen.getByTestId("performance-rating-rule")).toHaveTextContent(
      "Your average is 3.38. Driver accounts are suspended when the average falls below 3.0 after 20 or more rated rides.",
    );
    expect(screen.getByTestId("performance-rating-meta")).toHaveTextContent(
      "All-time · updated daily",
    );
    expect(screen.getByTestId("performance-standing")).toHaveTextContent("3.0 limit", {
      exact: false,
    });
    // (3.38 − 1) / 4 of the 1–5 scale.
    expect(screen.getByTestId("performance-standing-marker").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ left: "59.5%" })]),
    );
    // I65 (board DriverRatingWarning): no window toggle, two compact tiles.
    expect(screen.queryByTestId("performance-window-7")).toBeNull();
    expect(screen.getByTestId("tile-acceptance")).toBeTruthy();
    expect(screen.queryByTestId("tile-acceptance-detail")).toBeNull();
    expect(screen.queryByTestId("tile-on-time")).toBeNull();
    expect(screen.queryByTestId("tile-trips")).toBeNull();
  });

  it("403 (not an approved driver) explains instead of failing", async () => {
    await renderTrustApp(
      { [PERFORMANCE]: { status: 403, body: { status: 403, message: "no" } } },
      { initialUrl: "/performance" },
    );
    expect(await screen.findByTestId("performance-unavailable")).toBeTruthy();
  });

  it("renders in Arabic RTL with Western digits (artboard \"Driver Performance AR\")", async () => {
    const restore = simulateArabicIndicIcu();
    try {
      await setAppLanguage("ar");
      await renderTrustApp(
        { [PERFORMANCE]: ok(performanceFixture({ warnings: [warning] })) },
        { initialUrl: "/performance", language: "ar" },
      );
      expect(await screen.findByTestId("performance-title")).toHaveTextContent("الأداء");
      expect(screen.getByTestId("performance-window-30")).toHaveTextContent("⁦30⁩ يوماً");
      expect(screen.getByTestId("performance-window-7")).toHaveTextContent("⁦7⁩ أيام");
      expect(text("tile-acceptance-detail")).toBe("⁦24⁩ من ⁦52⁩ عرضاً");
      expect(text("tile-acceptance-value")).toBe("⁦46.2%⁩");
      expect(text("tile-trips-detail")).toBe("أرباح ⁦512,000⁩ ل.س");
      expect(screen.getByTestId("performance-warning-acceptance")).toHaveTextContent(
        "التنبيهات لا توقف حسابك أبداً",
        { exact: false },
      );
      for (const id of [
        "tile-acceptance-value",
        "tile-cancellation-detail",
        "tile-on-time-detail",
        "performance-rating-value",
        "performance-rating-meta",
      ]) {
        expect(text(id)).not.toMatch(NON_WESTERN_DIGITS);
      }
    } finally {
      restore();
    }
  });
});

describe("rider rating on the offer card (RATE-02)", () => {
  const originalWebSocket = globalThis.WebSocket;
  beforeEach(async () => {
    jest.clearAllMocks();
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
    mockLocationGranted();
  });
  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("shows the snapshot rating next to the fare caption when the rider has one", async () => {
    const contract = await renderDriverApp();
    const socket = await goLive();
    await waitForResync(contract);
    const offer = offerFixture();
    receive(
      socket,
      offerNewFrame({ ...offer, rider: { ...offer.rider, rating: 4.8 } }),
    );
    expect(await screen.findByTestId("offer-fare-caption")).toHaveTextContent(
      "Estimated fare · rider rating 4.8 ★",
    );
  });
});

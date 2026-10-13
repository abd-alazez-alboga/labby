/**
 * M9-T2 — the demand heatmap on the ONLINE home map (owner-approved canvas
 * "Demand heatmap"): the layers toggle (top-right, Show/Hide), the zones
 * drawn on the map with their multiplier chips (level 0 not drawn), the
 * "Demand near you" sheet section (updated / next update, legend, the
 * explanation), the quiet 404, and Arabic: copy, mirrored rows and
 * Western digits.
 */
import { act, fireEvent } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

import type { Heatmap } from "../api/heatmap";
import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";
import { availabilityFixture, MockSocket } from "../test-utils/realtime";
import {
  AVAILABILITY,
  goLive,
  HEATMAP,
  mockLocationGranted,
  renderDriverApp,
  screen,
} from "../test-utils/ride-harness";
import type { MockResponse } from "../test-utils/contract";

const originalWebSocket = globalThis.WebSocket;
const ok = (body: unknown): MockResponse => ({ status: 200, body });
const injectJavaScript = (
  WebView as unknown as { injectJavaScriptMock: jest.Mock }
).injectJavaScriptMock;

function square(lng: number, lat: number) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [lng, lat],
        [lng + 0.01, lat],
        [lng + 0.01, lat + 0.01],
        [lng, lat + 0.01],
        [lng, lat],
      ],
    ],
  };
}

function heatmapFixture(): Heatmap {
  return {
    regionId: "r-1",
    computedAt: "2026-10-13T12:40:00Z",
    nextCycleAt: "2099-01-01T12:42:00Z",
    zones: [
      { id: "z1", name: "Mezzeh", polygon: square(36.25, 33.5), multiplier: 1.2, level: 1 },
      { id: "z2", name: "Malki", polygon: square(36.27, 33.51), multiplier: 1.5, level: 2 },
      { id: "z3", name: "Old City", polygon: square(36.3, 33.51), multiplier: 2, level: 3 },
      { id: "z0", name: "Kafr Sousa", polygon: square(36.28, 33.49), multiplier: 1, level: 0 },
    ],
  };
}

function flexDirectionOf(testID: string): unknown {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style)
    ?.flexDirection;
}

/** The map page reports ready — later states go through the bridge. */
function mapReady() {
  act(() => {
    screen.getByTestId("own-position-map-webview").props.onMessage({
      nativeEvent: { data: JSON.stringify({ type: "ready" }) },
    });
  });
}

/** Every map state the page was given (initial HTML + bridge updates). */
function mapPayloads(): string {
  const html: string =
    screen.queryByTestId("own-position-map-webview")?.props.source.html ?? "";
  return html + injectJavaScript.mock.calls.map((call) => call[0]).join("\n");
}

describe("demand heatmap on the online home (DRV-09, UC-D-14)", () => {
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

  it("draws the zones and shows the Demand near you section while online", async () => {
    const contract = await renderDriverApp(
      { [HEATMAP]: ok(heatmapFixture()) },
      { heatmap: true },
    );
    await goLive();

    const section = await screen.findByTestId("heatmap-sheet");
    expect(section).toHaveTextContent("Demand near you", { exact: false });
    expect(screen.getByTestId("heatmap-updated")).toHaveTextContent(
      /^Updated \d\d:\d\d · next update \d\d:\d\d$/,
    );
    expect(screen.getByTestId("heatmap-legend-1")).toHaveTextContent(
      "Busy \u20661.2×\u2069",
    );
    expect(screen.getByTestId("heatmap-legend-2")).toHaveTextContent(
      "Very busy \u20661.5×\u2069",
    );
    expect(screen.getByTestId("heatmap-legend-3")).toHaveTextContent(
      "Highest \u20662.0×\u2069",
    );
    expect(section).toHaveTextContent(
      "Shaded areas have more ride requests than free drivers, so fares there are higher. Moving there is your choice.",
      { exact: false },
    );
    expect(screen.queryByTestId("heatmap-calm")).toBeNull();
    // Legend swatches: dashed light → solid strong.
    expect(screen.getByTestId("heatmap-swatch-1")).toHaveStyle({
      borderStyle: "dashed",
      backgroundColor: "rgba(89,18,138,0.12)",
    });
    expect(screen.getByTestId("heatmap-swatch-3")).toHaveStyle({
      borderStyle: "solid",
      backgroundColor: "rgba(89,18,138,0.5)",
    });

    // The map layer: three zones with chips, the level-0 zone not drawn.
    mapReady();
    const payloads = mapPayloads();
    expect(payloads).toContain('"id":"z1"');
    expect(payloads).toContain('"label":"2.0×"');
    expect(payloads).not.toContain('"id":"z0"');
    expect(contract.requestsTo(HEATMAP).length).toBeGreaterThanOrEqual(1);

    // The toggle: on by default, top-right, Show/Hide labels.
    const toggle = screen.getByTestId("heatmap-toggle");
    expect(toggle.props.accessibilityLabel).toBe("Hide demand heatmap");
    expect(toggle.props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(toggle);
    expect(screen.queryByTestId("heatmap-sheet")).toBeNull();
    expect(screen.getByTestId("heatmap-toggle").props.accessibilityLabel).toBe(
      "Show demand heatmap",
    );
    expect(
      screen.getByTestId("heatmap-toggle").props.accessibilityState,
    ).toEqual({ selected: false });
    const lastState: string =
      injectJavaScript.mock.calls[injectJavaScript.mock.calls.length - 1]?.[0] ??
      "";
    expect(lastState).toContain('"zones":[]');

    fireEvent.press(screen.getByTestId("heatmap-toggle"));
    expect(await screen.findByTestId("heatmap-sheet")).toBeTruthy();
  });

  it("no toggle, no layer and no read while offline", async () => {
    const contract = await renderDriverApp(
      {
        [AVAILABILITY]: ok(availabilityFixture()),
        [HEATMAP]: ok(heatmapFixture()),
      },
      { heatmap: true },
    );
    expect(await screen.findByTestId("availability-offline")).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByTestId("heatmap-toggle")).toBeNull();
    expect(screen.queryByTestId("heatmap-sheet")).toBeNull();
    expect(contract.requestsTo(HEATMAP)).toHaveLength(0);
  });

  it("404 no_operating_region: quiet — no section, no error", async () => {
    const contract = await renderDriverApp(
      {
        [HEATMAP]: {
          status: 404,
          body: { status: 404, message: "none", code: "no_operating_region" },
        },
      },
      { heatmap: true },
    );
    await goLive();
    expect(await screen.findByTestId("heatmap-toggle")).toBeTruthy();
    await act(async () => {});
    expect(contract.requestsTo(HEATMAP).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId("heatmap-sheet")).toBeNull();
    expect(screen.getByTestId("availability-online")).toBeTruthy();
  });

  it("all zones calm: legend without multipliers + the calm line", async () => {
    const calm = heatmapFixture();
    calm.zones = calm.zones.map((zone) => ({ ...zone, level: 0, multiplier: 1 }));
    await renderDriverApp({ [HEATMAP]: ok(calm) }, { heatmap: true });
    await goLive();
    expect(await screen.findByTestId("heatmap-calm")).toHaveTextContent(
      "No busy areas right now.",
    );
    expect(screen.getByTestId("heatmap-legend-1")).toHaveTextContent("Busy");
  });

  it("Arabic: copy, mirrored rows and Western digits only", async () => {
    await setAppLanguage("ar");
    const restore = simulateArabicIndicIcu();
    try {
      await renderDriverApp(
        { [HEATMAP]: ok(heatmapFixture()) },
        { heatmap: true, language: "ar" },
      );
      await goLive();
      const section = await screen.findByTestId("heatmap-sheet");
      expect(section).toHaveTextContent("الطلب بالقرب منك", { exact: false });
      expect(screen.getByTestId("heatmap-updated")).toHaveTextContent(
        /^آخر تحديث \d\d:\d\d( م| ص)? · التحديث التالي \d\d:\d\d( م| ص)?$/,
      );
      expect(screen.getByTestId("heatmap-legend-1")).toHaveTextContent(
        "مزدحم \u20661.2×\u2069",
      );
      expect(screen.getByTestId("heatmap-legend-2")).toHaveTextContent(
        "مزدحم جداً \u20661.5×\u2069",
      );
      expect(screen.getByTestId("heatmap-legend-3")).toHaveTextContent(
        "الأعلى \u20662.0×\u2069",
      );
      expect(section).toHaveTextContent("الانتقال إليها خيارك", {
        exact: false,
      });
      expect(
        screen.getByTestId("heatmap-toggle").props.accessibilityLabel,
      ).toBe("إخفاء خريطة الطلب");
      expect(flexDirectionOf("heatmap-legend")).toBe("row-reverse");
      expect(flexDirectionOf("heatmap-legend-1")).toBe("row-reverse");
      expect(screen.getByText("الطلب بالقرب منك")).toHaveStyle({
        textAlign: "right",
      });
      // Western digits everywhere: sheet and map chips.
      for (const testID of [
        "heatmap-updated",
        "heatmap-legend-1",
        "heatmap-legend-2",
        "heatmap-legend-3",
      ]) {
        expect(screen.getByTestId(testID)).not.toHaveTextContent(
          NON_WESTERN_DIGITS,
        );
      }
      mapReady();
      expect(mapPayloads()).toContain('"label":"1.5×"');
      expect(mapPayloads()).not.toMatch(NON_WESTERN_DIGITS);
    } finally {
      restore();
    }
  });
});

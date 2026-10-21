/**
 * M9-T2 — the driver demand heatmap (DRV-09, UC-D-14), unit level: the
 * refresh schedule (read on visibility, then once per surge cycle at
 * `nextCycleAt` + grace, fallback when unknown/past, stop when offline /
 * toggled off / backgrounded / a ride owns the screen), the quiet 404,
 * levels → tiers → looks, the polygon → Leaflet conversion and the bridge.
 */
import { act, render } from "@testing-library/react-native";
import i18next from "i18next";
import React from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import type { Heatmap, HeatmapZone } from "../api/heatmap";
import { clearSession } from "../auth/session";
import {
  cyclePeriod,
  HEATMAP_FALLBACK_MS,
  HEATMAP_STALE_RETRY_MS,
  HeatmapProvider,
  INITIAL_REFRESH_TRACK,
  nextRefreshDelay,
  planNextRead,
  useOptionalHeatmap,
} from "../heatmap/HeatmapProvider";
import type { HeatmapContextValue } from "../heatmap/HeatmapProvider";
import {
  formatMultiplier,
  HEAT_TIER_STYLES,
  mapZones,
  tierMultiplierLabel,
  tierOf,
  withAlpha,
} from "../heatmap/levels";
import { initI18n, setAppLanguage } from "../i18n";
import { polygonToLatLngs, ringCentroid } from "../map/geojson";
import type { GeoJsonPolygon } from "../map/geojson";
import { applyStateScript, buildMapPage } from "../map/leaflet-bridge";
import { driverUser, installContractFetch, seedSession } from "../test-utils/contract";
import type { MockResponse } from "../test-utils/contract";
import { NON_WESTERN_DIGITS, simulateArabicIndicIcu } from "../test-utils/intl";

// The provider's inputs, controlled per test (auth, availability, ride).
let mockOnline = true;
let mockRide: unknown = null;
jest.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ status: "signedIn", isDriver: true }),
}));
jest.mock("../realtime/AvailabilityProvider", () => ({
  useOptionalAvailability: () => ({
    load: { status: "loaded", data: { online: mockOnline } },
  }),
}));
jest.mock("../rides/DriverRideProvider", () => ({
  useOptionalDriverRide: () => ({ offer: null, ride: mockRide }),
}));

const HEATMAP = "GET /api/v1/driver/heatmap";
const NOW = Date.parse("2026-10-13T12:40:00Z");

function square(lng: number, lat: number, size = 0.01): GeoJsonPolygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng, lat],
        [lng + size, lat],
        [lng + size, lat + size],
        [lng, lat + size],
        [lng, lat],
      ],
    ],
  };
}

function zone(overrides: Partial<HeatmapZone> = {}): HeatmapZone {
  return {
    id: "z-1",
    name: "Old City",
    polygon: square(36.3, 33.5),
    multiplier: 1.5,
    level: 2,
    ...overrides,
  };
}

function heatmapFixture(overrides: Partial<Heatmap> = {}): Heatmap {
  return {
    regionId: "r-1",
    computedAt: new Date(NOW).toISOString(),
    nextCycleAt: new Date(NOW + 60_000).toISOString(),
    zones: [zone()],
    ...overrides,
  };
}

const ok = (body: unknown): MockResponse => ({ status: 200, body });

const iso = (offset: number) => new Date(NOW + offset).toISOString();

describe("refresh schedule (nextRefreshDelay, planNextRead)", () => {
  it("reads a few seconds after the next cycle", () => {
    expect(nextRefreshDelay(iso(60_000), iso(-60_000), NOW)).toBe(65_000);
  });

  it("falls back to 120 s when the cycle time is null or unreadable", () => {
    expect(nextRefreshDelay(null, iso(0), NOW)).toBe(HEATMAP_FALLBACK_MS);
    expect(HEATMAP_FALLBACK_MS).toBe(120_000);
    expect(nextRefreshDelay("not a date", iso(0), NOW)).toBe(
      HEATMAP_FALLBACK_MS,
    );
  });

  it("takes the period from server timestamps, else 120 s", () => {
    expect(cyclePeriod(iso(0), iso(120_000))).toBe(120_000);
    expect(cyclePeriod(null, iso(120_000))).toBe(HEATMAP_FALLBACK_MS);
    expect(cyclePeriod(iso(0), iso(0))).toBe(HEATMAP_FALLBACK_MS);
  });

  it("clamps to [1 s, one period + grace] whatever the device clock says", () => {
    // Device clock 10 min behind the server: one period + grace, not 10 min.
    expect(nextRefreshDelay(iso(720_000), iso(600_000), NOW)).toBe(125_000);
    // Device clock ahead (cycle time already past): read again soon.
    expect(nextRefreshDelay(iso(-60_000), iso(-180_000), NOW)).toBe(1_000);
  });

  it("retries in 15 s while the awaited cycle has not written, for one period at most", () => {
    const fresh = planNextRead(
      { computedAt: iso(0), nextCycleAt: iso(60_000) },
      INITIAL_REFRESH_TRACK,
      NOW,
    );
    expect(fresh.delay).toBe(65_000);
    expect(fresh.track).toEqual({ awaited: iso(60_000), period: 60_000, retries: 0 });

    // The cycle at +60 s has not written: computedAt is still the old one.
    const stale = { computedAt: iso(0), nextCycleAt: iso(120_000) };
    let track = fresh.track;
    for (let i = 1; i <= 4; i += 1) {
      const plan = planNextRead(stale, track, NOW + 65_000);
      expect(plan.delay).toBe(HEATMAP_STALE_RETRY_MS);
      track = plan.track;
    }
    // A period's worth of retries spent: back to the normal schedule.
    expect(planNextRead(stale, track, NOW + 125_000).delay).toBe(
      HEATMAP_STALE_RETRY_MS,
    );
    expect(planNextRead(stale, track, NOW + 65_000).delay).toBe(60_000);

    // The cycle lands: fresh again.
    const landed = planNextRead(
      { computedAt: iso(120_300), nextCycleAt: iso(180_000) },
      track,
      NOW + 125_000,
    );
    expect(landed.track).toEqual({ awaited: iso(180_000), period: 59_700, retries: 0 });
    expect(landed.delay).toBe(60_000);
  });
});

describe("HeatmapProvider polling", () => {
  let latest: HeatmapContextValue | null = null;
  let appStateListener: ((state: AppStateStatus) => void) | null = null;

  function Probe() {
    latest = useOptionalHeatmap();
    return null;
  }

  function mount() {
    return render(
      <HeatmapProvider>
        <Probe />
      </HeatmapProvider>,
    );
  }

  async function advance(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await act(async () => {});
  }

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    mockOnline = true;
    mockRide = null;
    latest = null;
    appStateListener = null;
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_type, listener) => {
        appStateListener = listener as (state: AppStateStatus) => void;
        return { remove: jest.fn() } as never;
      });
    await clearSession();
    await seedSession(driverUser());
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("reads at once, then once per cycle at nextCycleAt + grace", async () => {
    const contract = installContractFetch({
      [HEATMAP]: [
        ok(heatmapFixture()),
        ok(
          heatmapFixture({
            computedAt: new Date(NOW + 60_200).toISOString(),
            nextCycleAt: new Date(NOW + 180_000).toISOString(),
            zones: [zone({ level: 3, multiplier: 2 })],
          }),
        ),
      ],
    });
    mount();
    await act(async () => {});
    expect(contract.requestsTo(HEATMAP)).toHaveLength(1);
    expect(latest?.heatmap?.zones[0].level).toBe(2);

    await advance(64_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(1);
    await advance(1_000); // nextCycleAt (+60 s) + 5 s grace
    expect(contract.requestsTo(HEATMAP)).toHaveLength(2);
    // The level change is on the map within one cycle.
    expect(latest?.heatmap?.zones[0].level).toBe(3);

    // Next read: (NOW + 180 s) + 5 s, i.e. 120 s after the second read.
    await advance(119_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(2);
    await advance(1_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(3);
  });

  it("a device clock 10 min behind still reads within one period + grace", async () => {
    // Server time is NOW + 10 min: the cycle ran at +600 s, the next at +720 s.
    const contract = installContractFetch({
      [HEATMAP]: [
        ok(heatmapFixture({ computedAt: iso(600_000), nextCycleAt: iso(720_000) })),
        ok(
          heatmapFixture({
            computedAt: iso(720_200),
            nextCycleAt: iso(840_000),
            zones: [zone({ level: 3, multiplier: 2 })],
          }),
        ),
      ],
    });
    mount();
    await act(async () => {});
    await advance(124_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(1);
    await advance(1_000); // 120 s period + 5 s grace
    expect(contract.requestsTo(HEATMAP)).toHaveLength(2);
    expect(latest?.heatmap?.zones[0].level).toBe(3);
  });

  it("a slow cycle (computedAt not advanced) is retried after 15 s", async () => {
    const contract = installContractFetch({
      [HEATMAP]: [
        ok(heatmapFixture()),
        // Read at +65 s: the +60 s cycle has not written yet.
        ok(heatmapFixture({ nextCycleAt: iso(120_000) })),
        ok(
          heatmapFixture({
            computedAt: iso(60_500),
            nextCycleAt: iso(120_000),
            zones: [zone({ level: 3, multiplier: 2 })],
          }),
        ),
      ],
    });
    mount();
    await act(async () => {});
    await advance(65_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(2);
    expect(latest?.heatmap?.zones[0].level).toBe(2);

    await advance(14_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(2);
    await advance(1_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(3);
    expect(latest?.heatmap?.zones[0].level).toBe(3);

    // Fresh again: the next read is at the following cycle (+120 s) + grace.
    await advance(44_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(3);
    await advance(1_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(4);
  });

  it("falls back to 120 s when nextCycleAt is null", async () => {
    const contract = installContractFetch({
      [HEATMAP]: ok(heatmapFixture({ nextCycleAt: null })),
    });
    mount();
    await act(async () => {});
    await advance(119_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(1);
    await advance(1_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(2);
  });

  it("stops when the driver goes offline and clears the layer", async () => {
    const contract = installContractFetch({ [HEATMAP]: ok(heatmapFixture()) });
    const view = mount();
    await act(async () => {});
    expect(latest?.heatmap).not.toBeNull();

    mockOnline = false;
    view.rerender(
      <HeatmapProvider>
        <Probe />
      </HeatmapProvider>,
    );
    await act(async () => {});
    expect(latest?.heatmap).toBeNull();
    expect(latest?.online).toBe(false);
    await advance(30 * 60_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(1);
  });

  it("toggle off stops reading and hides the layer; on reads again at once", async () => {
    const contract = installContractFetch({ [HEATMAP]: ok(heatmapFixture()) });
    mount();
    await act(async () => {});
    expect(latest?.enabled).toBe(true); // on by default

    act(() => latest?.toggle());
    expect(latest?.enabled).toBe(false);
    expect(latest?.heatmap).toBeNull();
    await advance(30 * 60_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(1);

    act(() => latest?.toggle());
    await act(async () => {});
    expect(contract.requestsTo(HEATMAP)).toHaveLength(2);
    expect(latest?.heatmap).not.toBeNull();
  });

  it("pauses in the background and reads again on return", async () => {
    const contract = installContractFetch({ [HEATMAP]: ok(heatmapFixture()) });
    mount();
    await act(async () => {});
    act(() => appStateListener?.("background"));
    await advance(30 * 60_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(1);
    act(() => appStateListener?.("active"));
    await act(async () => {});
    expect(contract.requestsTo(HEATMAP)).toHaveLength(2);
  });

  it("pauses while a ride owns the home screen", async () => {
    mockRide = { id: "ride-1" };
    const contract = installContractFetch({ [HEATMAP]: ok(heatmapFixture()) });
    mount();
    await advance(10 * 60_000);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(0);
  });

  it("404 no_operating_region: no layer, no error, retried on the fallback", async () => {
    const contract = installContractFetch({
      [HEATMAP]: [
        {
          status: 404,
          body: { status: 404, message: "x", code: "no_operating_region" },
        },
        ok(heatmapFixture()),
      ],
    });
    mount();
    await act(async () => {});
    expect(latest?.heatmap).toBeNull();
    await advance(HEATMAP_FALLBACK_MS);
    expect(contract.requestsTo(HEATMAP)).toHaveLength(2);
    expect(latest?.heatmap).not.toBeNull();
  });

  it("any other failure keeps the last view quietly", async () => {
    installContractFetch({
      [HEATMAP]: [
        ok(heatmapFixture()),
        { status: 503, body: { status: 503, message: "down" } },
      ],
    });
    mount();
    await act(async () => {});
    await advance(65_000);
    expect(latest?.heatmap?.zones).toHaveLength(1);
  });
});

describe("levels → tiers, looks and labels", () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await setAppLanguage("en");
  });

  it("level 0 is not drawn; 1, 2 and 3+ map to the three tiers", () => {
    expect(tierOf(0)).toBeNull();
    expect(tierOf(1)).toBe(1);
    expect(tierOf(2)).toBe(2);
    expect(tierOf(3)).toBe(3);
    expect(tierOf(5)).toBe(3);
  });

  it("the three tiers differ in strength AND border style", () => {
    expect(HEAT_TIER_STYLES[1]).toMatchObject({
      fillOpacity: 0.12,
      dashed: true,
      labelKey: "heatmap.level.busy",
    });
    expect(HEAT_TIER_STYLES[2]).toMatchObject({
      fillOpacity: 0.28,
      dashed: false,
      labelKey: "heatmap.level.veryBusy",
    });
    expect(HEAT_TIER_STYLES[3]).toMatchObject({
      fillOpacity: 0.5,
      strokeOpacity: 1,
      dashed: false,
      chipBackground: "#59128A",
      labelKey: "heatmap.level.highest",
    });
    expect(withAlpha("#59128A", 0.28)).toBe("rgba(89,18,138,0.28)");
  });

  it("formats multipliers with one decimal at least", () => {
    const t = i18next.t.bind(i18next);
    expect(formatMultiplier(t, 2, "en")).toBe("2.0×");
    expect(formatMultiplier(t, 1.25, "en")).toBe("1.25×");
    expect(
      tierMultiplierLabel(
        t,
        [zone({ level: 1, multiplier: 1.2 }), zone({ level: 1, multiplier: 1.3 })],
        1,
        "en",
      ),
    ).toBe("1.2–1.3×");
    expect(tierMultiplierLabel(t, [zone({ level: 2 })], 3, "en")).toBeNull();
  });

  it("Arabic multipliers keep Western digits", async () => {
    await setAppLanguage("ar");
    const restore = simulateArabicIndicIcu();
    try {
      const t = i18next.t.bind(i18next);
      const label = formatMultiplier(t, 1.5, "ar");
      expect(label).toBe("1.5×");
      expect(label).not.toMatch(NON_WESTERN_DIGITS);
    } finally {
      restore();
    }
  });

  it("mapZones drops level 0, flips [lng,lat] and labels the centroid", () => {
    const t = i18next.t.bind(i18next);
    const zones = mapZones(
      t,
      [
        zone({ id: "calm", level: 0, multiplier: 1 }),
        zone({ id: "hot", level: 4, multiplier: 2, polygon: square(36, 33, 2) }),
      ],
      "en",
    );
    expect(zones).toHaveLength(1);
    expect(zones[0]).toEqual({
      id: "hot",
      tier: 3,
      label: "2.0×",
      ring: [
        [33, 36],
        [33, 38],
        [35, 38],
        [35, 36],
      ],
      labelAt: [34, 37],
    });
  });

  it("polygon helpers ignore bad input", () => {
    expect(
      polygonToLatLngs({ type: "LineString" } as unknown as GeoJsonPolygon),
    ).toEqual([]);
    expect(ringCentroid([])).toBeNull();
    // Degenerate ring: the vertex average.
    expect(
      ringCentroid([
        [1, 1],
        [1, 1],
        [1, 1],
      ]),
    ).toEqual([1, 1]);
  });

  it("the bridge carries zones and tier looks to the page", () => {
    const state = {
      center: [33.5, 36.3] as [number, number],
      zoom: 14,
      markers: [],
      route: null,
      followMe: false,
      zones: [
        {
          id: "z",
          tier: 1 as const,
          label: "1.2×",
          ring: [
            [33, 36],
            [33, 37],
            [34, 37],
          ] as [number, number][],
          labelAt: [33.3, 36.6] as [number, number],
        },
      ],
    };
    const html = buildMapPage(
      {
        tileUrl: "x",
        attribution: "y",
        rtl: false,
        colors: {
          self: "#59128A",
          selfBorder: "#FFFFFF",
          point: "#141018",
          route: "#59128A",
          background: "#ECE9F0",
        },
        zoneStyles: {
          "1": {
            fill: "#59128A",
            fillOpacity: 0.12,
            stroke: "#59128A",
            strokeOpacity: 0.55,
            dashed: true,
            chipBackground: "#FFFFFF",
            chipText: "#463C58",
          },
        },
      },
      state,
    );
    expect(html).toContain('"zoneStyles":{"1":{');
    expect(html).toContain("L.polygon(");
    expect(html).toContain("chip.setAttribute('dir', 'ltr')");
    expect(applyStateScript(state)).toContain('"label":"1.2×"');
  });
  it("the page redraws zones only when the zones payload changed", () => {
    const bridgeZone = {
      id: "z",
      tier: 1 as const,
      label: "1.2×",
      ring: [
        [33, 36],
        [33, 37],
        [34, 37],
      ] as [number, number][],
      labelAt: [33.3, 36.6] as [number, number],
    };
    const state = {
      center: [33.5, 36.3] as [number, number],
      zoom: 14,
      markers: [
        { id: "self", kind: "self" as const, position: [33.5, 36.3] as [number, number] },
      ],
      route: null,
      followMe: false,
      zones: [bridgeZone],
    };
    const html = buildMapPage(
      {
        tileUrl: "x",
        attribution: "y",
        rtl: false,
        colors: {
          self: "#59128A",
          selfBorder: "#FFFFFF",
          point: "#141018",
          route: "#59128A",
          background: "#ECE9F0",
        },
        zoneStyles: {
          "1": {
            fill: "#59128A",
            fillOpacity: 0.12,
            stroke: "#59128A",
            strokeOpacity: 0.55,
            dashed: true,
            chipBackground: "#FFFFFF",
            chipText: "#463C58",
          },
        },
      },
      state,
    );
    // Run the page's map script against a stub Leaflet.
    const script = html.slice(
      html.lastIndexOf("<script>") + "<script>".length,
      html.lastIndexOf("</script>"),
    );
    const layers: { clearLayers: jest.Mock; eachLayer: jest.Mock }[] = [];
    const addable = () => ({ addTo: () => addable(), on: () => undefined });
    const L = {
      map: () => ({
        on: () => undefined,
        setView: () => undefined,
        panTo: () => undefined,
        removeLayer: () => undefined,
      }),
      control: { attribution: () => addable() },
      tileLayer: () => addable(),
      layerGroup: () => {
        const layer = { clearLayers: jest.fn(), eachLayer: jest.fn() };
        layers.push(layer);
        return { addTo: () => layer };
      },
      polygon: jest.fn(() => addable()),
      marker: () => addable(),
      circleMarker: () => addable(),
      polyline: () => addable(),
      divIcon: () => ({}),
    };
    const fakeWindow: {
      labbyMap?: { apply: (next: unknown) => void };
    } = {};
    const fakeDocument = {
      createElement: () => ({ setAttribute: () => undefined, style: {} }),
    };
    const labbyPost = () => undefined;
    new Function("L", "window", "document", "labbyPost", script)(
      L,
      fakeWindow,
      fakeDocument,
      labbyPost,
    );
    const [zoneLayer, markerLayer] = layers;
    expect(L.polygon).toHaveBeenCalledTimes(1);

    // A marker-only update (same zones, new object): zones untouched.
    const apply = (next: unknown) =>
      fakeWindow.labbyMap?.apply(JSON.parse(applyStateScript(next as typeof state)
        .replace(/^window\.labbyMap && window\.labbyMap\.apply\(/, "")
        .replace(/\); true;$/, "")));
    apply({
      ...state,
      markers: [{ id: "self", kind: "self", position: [33.6, 36.4] }],
      zones: [{ ...bridgeZone }],
    });
    expect(markerLayer.clearLayers).toHaveBeenCalledTimes(2);
    expect(zoneLayer.clearLayers).toHaveBeenCalledTimes(1);
    expect(L.polygon).toHaveBeenCalledTimes(1);

    // A new cycle's zones: redrawn once.
    apply({ ...state, zones: [{ ...bridgeZone, tier: 1, label: "1.3×" }] });
    expect(zoneLayer.clearLayers).toHaveBeenCalledTimes(2);
    expect(L.polygon).toHaveBeenCalledTimes(2);
  });
});

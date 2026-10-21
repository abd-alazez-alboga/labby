/**
 * L-W3: the map page frames the route AND every fixed marker (pickup, stops,
 * destination) once ready and whenever the WebView is resized — after
 * `invalidateSize`, since the page first lays out before the WebView has its
 * final size. Live tracking (followMe) and the pin picker keep their own
 * centre, and a moving driver never refits the map.
 *
 * The page script runs here against a minimal Leaflet stub.
 */
import {
  buildMapHtml,
  buildRelayoutScript,
  type MapViewState,
} from "../map-bridge";

type Point = [number, number];

function leafletStub() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const record =
    (fn: string, chain?: unknown) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
      return chain;
    };
  const layer = () => {
    const self: Record<string, unknown> = {};
    self.addTo = () => self;
    self.on = () => self;
    self.clearLayers = () => self;
    return self;
  };
  const map: Record<string, unknown> = {};
  map.setView = record("setView", map);
  map.fitBounds = record("fitBounds", map);
  map.invalidateSize = record("invalidateSize", map);
  map.on = () => map;
  map.removeLayer = () => map;
  map.getZoom = () => 15;
  map.getCenter = () => ({ lat: 0, lng: 0 });
  const L = {
    map: () => map,
    tileLayer: layer,
    layerGroup: layer,
    circleMarker: layer,
    polyline: layer,
    latLngBounds: (points: Point[]) => {
      const lats = points.map((p) => p[0]);
      const lngs = points.map((p) => p[1]);
      const ne = { lat: Math.max(...lats), lng: Math.max(...lngs) };
      const sw = { lat: Math.min(...lats), lng: Math.min(...lngs) };
      return { points, getNorthEast: () => ne, getSouthWest: () => sw };
    },
  };
  return { L, calls };
}

/** Loads the page's inline script into a fake window. */
function loadPage(initialState: MapViewState) {
  const html = buildMapHtml({ tileUrlTemplate: "https://t/{z}/{x}/{y}.png", initialState });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const body = scripts[scripts.length - 1][1];
  const listeners: Record<string, (() => void)[]> = {};
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: () => {} },
    addEventListener: (type: string, listener: () => void) => {
      (listeners[type] ??= []).push(listener);
    },
  };
  const { L, calls } = leafletStub();
  new Function("window", "L", body)(window, L);
  const page = window.labbyMap as {
    apply: (state: MapViewState) => void;
    relayout: () => void;
  };
  return {
    page,
    calls,
    resize: () => (listeners.resize ?? []).forEach((listener) => listener()),
    fits: () => calls.filter((c) => c.fn === "fitBounds"),
    clear: () => calls.splice(0, calls.length),
  };
}

const pickup: Point = [33.5, 36.27];
const destination: Point = [33.41, 36.51];
const stop: Point = [33.45, 36.4];
const route: Point[] = [pickup, [33.47, 36.35], destination];

function state(overrides: Partial<MapViewState> = {}): MapViewState {
  return {
    center: pickup,
    zoom: 15,
    followMe: false,
    markers: [
      { id: "pickup", latlng: pickup, kind: "origin" },
      { id: "stop-0", latlng: stop, kind: "stop" },
      { id: "destination", latlng: destination, kind: "destination" },
    ],
    route,
    routeApproximate: false,
    ...overrides,
  };
}

describe("map page framing (L-W3)", () => {
  it("fits the route and every marker on load", () => {
    const { fits } = loadPage(state());
    expect(fits()).toHaveLength(1);
    const [bounds, options] = fits()[0].args as [{ points: Point[] }, object];
    expect(bounds.points).toEqual(expect.arrayContaining([...route, stop]));
    expect(options).toEqual(expect.objectContaining({ padding: [48, 48] }));
  });

  it("fits the markers when there is no route yet", () => {
    const { fits } = loadPage(state({ route: null }));
    const [bounds] = fits()[0].args as [{ points: Point[] }];
    expect(bounds.points).toEqual([pickup, stop, destination]);
  });

  it("centres a single marker instead of fitting", () => {
    const { calls, fits } = loadPage(
      state({ route: null, markers: [{ id: "pickup", latlng: pickup, kind: "origin" }] }),
    );
    expect(fits()).toHaveLength(0);
    expect(calls.find((c) => c.fn === "setView")?.args).toEqual([pickup, 15]);
  });

  it("re-measures and re-frames on resize and on relayout", () => {
    const { page, calls, resize, clear } = loadPage(state());
    clear();
    resize();
    expect(calls.map((c) => c.fn)).toEqual(["invalidateSize", "fitBounds"]);
    clear();
    page.relayout();
    expect(calls.map((c) => c.fn)).toEqual(["invalidateSize", "fitBounds"]);
    expect(buildRelayoutScript()).toBe(
      "window.labbyMap && window.labbyMap.relayout(); true;",
    );
  });

  it("refits when the route changes, not when only the driver moves", () => {
    const withDriver = (at: Point, extra: Partial<MapViewState> = {}) =>
      state({
        ...extra,
        markers: [...state().markers, { id: "driver", latlng: at, kind: "driver" }],
      });
    const { page, fits, clear } = loadPage(withDriver([33.49, 36.28]));
    clear();
    page.apply(withDriver([33.48, 36.29]));
    expect(fits()).toHaveLength(0);
    page.apply(withDriver([33.48, 36.29], { route: [pickup, destination] }));
    expect(fits()).toHaveLength(1);
  });

  it("keeps live tracking and the pin picker on their own centre", () => {
    const tracking = loadPage(state({ followMe: true }));
    tracking.clear();
    tracking.resize();
    expect(tracking.calls.map((c) => c.fn)).toEqual(["invalidateSize"]);

    const picker = loadPage(state({ route: null, markers: [], reportCenter: true }));
    picker.clear();
    picker.resize();
    expect(picker.calls.map((c) => c.fn)).toEqual(["invalidateSize"]);
  });
});

/**
 * M6-T4 map plumbing: the single GeoJSON → map conversion (axis order!) and
 * the WebView bridge protocol (page HTML, injected state, page messages).
 */
import { isValidLatLng, lineStringToLatLngs } from "../geo";
import {
  buildApplyScript,
  buildMapHtml,
  parseMapEvent,
  toMapViewState,
} from "../map-bridge";

describe("lineStringToLatLngs (GeoJSON [lng, lat] → {lat, lng})", () => {
  it("flips the GeoJSON axis order", () => {
    expect(
      lineStringToLatLngs({
        type: "LineString",
        coordinates: [
          [36.2765, 33.5138],
          [36.3159, 33.5132],
        ],
      }),
    ).toEqual([
      { lat: 33.5138, lng: 36.2765 },
      { lat: 33.5132, lng: 36.3159 },
    ]);
  });

  it("drops malformed and out-of-range positions instead of drawing them", () => {
    expect(
      lineStringToLatLngs({
        type: "LineString",
        coordinates: [
          [36.3, 33.5],
          [36.3],
          [200, 33.5],
          [36.4, 95],
          [Number.NaN, 1],
          [36.5, 33.6],
        ],
      }),
    ).toEqual([
      { lat: 33.5, lng: 36.3 },
      { lat: 33.6, lng: 36.5 },
    ]);
  });

  it("yields no points for a missing or non-LineString geometry", () => {
    expect(lineStringToLatLngs(null)).toEqual([]);
    expect(lineStringToLatLngs(undefined)).toEqual([]);
    expect(
      lineStringToLatLngs({
        type: "Point",
        coordinates: [[1, 2]],
      } as unknown as Parameters<typeof lineStringToLatLngs>[0]),
    ).toEqual([]);
  });

  it("validates WGS84 ranges", () => {
    expect(isValidLatLng({ lat: 33.5, lng: 36.3 })).toBe(true);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
  });
});

describe("map bridge", () => {
  const state = toMapViewState({
    center: { lat: 33.5, lng: 36.3 },
    zoom: 15,
    followMe: true,
    markers: [{ id: "self", kind: "self", position: { lat: 33.5, lng: 36.3 } }],
    route: [
      { lat: 33.5, lng: 36.3 },
      { lat: 33.6, lng: 36.4 },
    ],
    routeApproximate: true,
  });

  it("serialises the view state in Leaflet [lat, lng] order", () => {
    expect(state).toEqual({
      center: [33.5, 36.3],
      zoom: 15,
      followMe: true,
      markers: [{ id: "self", latlng: [33.5, 36.3], kind: "self" }],
      route: [
        [33.5, 36.3],
        [33.6, 36.4],
      ],
      routeApproximate: true,
    });
  });

  it("draws no route for fewer than two points", () => {
    expect(
      toMapViewState({
        center: { lat: 1, lng: 2 },
        zoom: 10,
        followMe: false,
        markers: [],
        route: [{ lat: 1, lng: 2 }],
        routeApproximate: false,
      }).route,
    ).toBeNull();
  });

  it("builds a page with the configured tile template and a pinned, integrity-checked Leaflet", () => {
    const html = buildMapHtml({
      tileUrlTemplate: "https://tiles.example/{z}/{x}/{y}.png",
      initialState: state,
    });
    expect(html).toContain('"tileUrl":"https://tiles.example/{z}/{x}/{y}.png"');
    expect(html).toContain("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    expect(html).toContain(
      'integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="',
    );
    expect(html).toContain('"center":[33.5,36.3]');
  });

  it("never lets config text break out of the inline script", () => {
    const html = buildMapHtml({
      tileUrlTemplate: "https://x/</script><script>alert(1)</script>{z}",
      initialState: state,
    });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });

  it("injects state through window.labbyMap.apply", () => {
    expect(buildApplyScript(state)).toMatch(
      /^window\.labbyMap && window\.labbyMap\.apply\(\{.*\}\); true;$/,
    );
  });

  it("parses page messages and ignores anything unexpected", () => {
    expect(parseMapEvent('{"type":"ready"}')).toEqual({ type: "ready" });
    expect(parseMapEvent('{"type":"tiles","ok":false}')).toEqual({
      type: "tiles",
      ok: false,
    });
    expect(parseMapEvent('{"type":"error","reason":"library"}')).toEqual({
      type: "error",
      reason: "library",
    });
    expect(parseMapEvent('{"type":"other"}')).toBeNull();
    expect(parseMapEvent("not json")).toBeNull();
  });
});

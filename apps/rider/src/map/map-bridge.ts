/**
 * The WebView ⇄ React Native bridge of the map component — the ONLY module
 * that knows the page's HTML, the injected script and the message protocol.
 *
 * Why WebView + Leaflet: the map must run in Expo Go without a native dev
 * build and without API keys (ES-04). react-native-webview ships in Expo Go;
 * Leaflet (the same library the admin app uses) renders any XYZ tile server,
 * so the tile URL template stays runtime config. Leaflet itself is loaded
 * from the unpkg CDN pinned to 1.9.4 with Subresource Integrity — the tiles
 * need the network anyway, and this keeps a 150 KB library out of the JS
 * bundle.
 *
 * Protocol
 * - RN → page: `window.labbyMap.apply(<MapViewState>)` via injectJavaScript.
 * - page → RN: JSON messages through `window.ReactNativeWebView.postMessage`:
 *   `{type:'ready'}`, `{type:'tiles', ok}` (tile server reachable or not —
 *   NFR-A3 degrade notice) and `{type:'error', reason}` (Leaflet failed to
 *   load or the page crashed), and — only while `reportCenter` is set (the
 *   pin picker) — `{type:'center', lat, lng}` after every pan/zoom.
 */
import { colors } from "../theme/tokens";
import { type LatLng, toLeafletLatLng } from "./geo";

export const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS = {
  href: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`,
  integrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=",
};
const LEAFLET_JS = {
  src: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`,
  integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
};

/** What a marker stands for; decides its look. */
export type MapMarkerKind =
  "self" | "origin" | "destination" | "stop" | "driver";

export interface MapMarker {
  id: string;
  position: LatLng;
  kind: MapMarkerKind;
}

/** The serialisable state the page renders (Leaflet `[lat, lng]` order). */
export interface MapViewState {
  center: [number, number];
  zoom: number;
  followMe: boolean;
  markers: { id: string; latlng: [number, number]; kind: MapMarkerKind }[];
  route: [number, number][] | null;
  routeApproximate: boolean;
  /** Pin picking: the page reports the map centre after every move. */
  reportCenter?: true;
}

export type MapEvent =
  | { type: "ready" }
  | { type: "tiles"; ok: boolean }
  | { type: "error"; reason: string }
  | { type: "center"; lat: number; lng: number };

export function toMapViewState(input: {
  center: LatLng;
  zoom: number;
  followMe: boolean;
  markers: MapMarker[];
  route: LatLng[];
  routeApproximate: boolean;
  reportCenter?: boolean;
}): MapViewState {
  return {
    ...(input.reportCenter ? { reportCenter: true as const } : {}),
    center: toLeafletLatLng(input.center),
    zoom: input.zoom,
    followMe: input.followMe,
    markers: input.markers.map((marker) => ({
      id: marker.id,
      latlng: toLeafletLatLng(marker.position),
      kind: marker.kind,
    })),
    route: input.route.length > 1 ? input.route.map(toLeafletLatLng) : null,
    routeApproximate: input.routeApproximate,
  };
}

/** JSON that is safe inside an inline <script> (no `</script>` breakout). */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const MARKER_STYLES: Record<MapMarkerKind, Record<string, unknown>> = {
  self: {
    radius: 8,
    color: colors.surface,
    weight: 3,
    fillColor: colors.accent,
    fillOpacity: 1,
  },
  origin: {
    radius: 7,
    color: colors.accent,
    weight: 3,
    fillColor: colors.surface,
    fillOpacity: 1,
  },
  destination: {
    radius: 7,
    color: colors.surface,
    weight: 3,
    fillColor: colors.text,
    fillOpacity: 1,
  },
  stop: {
    radius: 6,
    color: colors.textSecondary,
    weight: 3,
    fillColor: colors.surface,
    fillOpacity: 1,
  },
  driver: {
    radius: 9,
    color: colors.surface,
    weight: 3,
    fillColor: colors.text,
    fillOpacity: 1,
  },
};

/** The full page: Leaflet + the tile layer + `window.labbyMap.apply`. */
export function buildMapHtml(options: {
  tileUrlTemplate: string;
  initialState: MapViewState;
}): string {
  const config = scriptJson({
    tileUrl: options.tileUrlTemplate,
    state: options.initialState,
    markerStyles: MARKER_STYLES,
    routeColor: colors.accent,
  });
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="${LEAFLET_CSS.href}" integrity="${LEAFLET_CSS.integrity}" crossorigin="" />
<style>html,body,#map{height:100%;width:100%;margin:0;padding:0;background:${colors.surfaceMap};}</style>
</head>
<body>
<div id="map"></div>
<script src="${LEAFLET_JS.src}" integrity="${LEAFLET_JS.integrity}" crossorigin=""></script>
<script>
(function () {
  function post(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  window.onerror = function () { post({ type: 'error', reason: 'script' }); };
  if (typeof L === 'undefined') { post({ type: 'error', reason: 'library' }); return; }
  var cfg = ${config};
  var map = L.map('map', { zoomControl: false, attributionControl: false })
    .setView(cfg.state.center, cfg.state.zoom);
  var tiles = L.tileLayer(cfg.tileUrl, { maxZoom: 19, subdomains: 'abc' }).addTo(map);
  var tilesDegraded = false;
  tiles.on('tileerror', function () {
    if (!tilesDegraded) { tilesDegraded = true; post({ type: 'tiles', ok: false }); }
  });
  tiles.on('tileload', function () {
    if (tilesDegraded) { tilesDegraded = false; post({ type: 'tiles', ok: true }); }
  });
  var markers = L.layerGroup().addTo(map);
  var routeLine = null;
  var lastRouteKey = null;
  var first = true;
  var reportCenter = false;
  map.on('moveend', function () {
    if (!reportCenter) return;
    var c = map.getCenter();
    post({ type: 'center', lat: c.lat, lng: c.lng });
  });
  window.labbyMap = {
    apply: function (s) {
      reportCenter = !!s.reportCenter;
      markers.clearLayers();
      s.markers.forEach(function (m) {
        L.circleMarker(m.latlng, cfg.markerStyles[m.kind] || cfg.markerStyles.origin).addTo(markers);
      });
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
      if (s.route) {
        routeLine = L.polyline(s.route, {
          color: cfg.routeColor, weight: 5, opacity: 0.85,
          dashArray: s.routeApproximate ? '8 8' : null
        }).addTo(map);
      }
      var routeKey = s.route ? JSON.stringify(s.route) : null;
      if (routeLine && routeKey !== lastRouteKey && !s.followMe) {
        map.fitBounds(routeLine.getBounds(), { padding: [32, 32] });
      } else if (s.followMe || first) {
        map.setView(s.center, first ? s.zoom : map.getZoom());
      }
      lastRouteKey = routeKey;
      first = false;
    }
  };
  window.labbyMap.apply(cfg.state);
  post({ type: 'ready' });
})();
</script>
</body>
</html>`;
}

/** The script that pushes a new state into a loaded page. */
export function buildApplyScript(state: MapViewState): string {
  return `window.labbyMap && window.labbyMap.apply(${scriptJson(state)}); true;`;
}

/** Parses a page message; anything unexpected is ignored (null). */
export function parseMapEvent(data: string): MapEvent | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object") return null;
  const { type } = message as { type?: unknown };
  if (type === "ready") return { type: "ready" };
  if (type === "tiles")
    return { type: "tiles", ok: (message as { ok?: unknown }).ok === true };
  if (type === "center") {
    const { lat, lng } = message as { lat?: unknown; lng?: unknown };
    if (
      typeof lat === "number" &&
      typeof lng === "number" &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) {
      return { type: "center", lat, lng };
    }
    return null;
  }
  if (type === "error") {
    const reason = (message as { reason?: unknown }).reason;
    return {
      type: "error",
      reason: typeof reason === "string" ? reason : "unknown",
    };
  }
  return null;
}

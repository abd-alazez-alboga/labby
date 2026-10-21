import type { LeafletLatLng } from "./geojson";

/**
 * The WebView <-> Leaflet bridge — BOTH sides of the protocol live in this
 * one module: the in-page script (embedded in the HTML built below) and the
 * React Native side (commands to inject, messages to parse). Only
 * `components/map/osm-map.tsx` uses it, and that component is the only
 * module importing react-native-webview.
 *
 * Why WebView + Leaflet (M6-T4): no API keys, runs in Expo Go without a
 * native dev build, and matches the admin app's Leaflet maps. Leaflet is
 * loaded from unpkg pinned to 1.9.4 with Subresource Integrity (the hashes
 * equal the published ones and the admin app's node_modules copy); the map
 * needs the network for tiles anyway, and a load failure is reported back
 * so the component can show its fallback (NFR-A3).
 *
 * Protocol
 *   RN -> page: `window.labbyMap.apply(<MapViewState>)`, `window.labbyMap.recenter()`
 *   page -> RN: `{"type":"ready"}`, `{"type":"tiles","ok":bool}`,
 *               `{"type":"followPaused"}`, `{"type":"loadFailed"}`
 */

export const LEAFLET_VERSION = "1.9.4";
const LEAFLET_JS = {
  src: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`,
  integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
};
const LEAFLET_CSS = {
  href: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`,
  integrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=",
};

/** `pickup` = hollow ring, `dropoff` = accent square (route-map pins). */
export type MapMarkerKind = "self" | "point" | "pickup" | "dropoff";

export interface BridgeMarker {
  id: string;
  kind: MapMarkerKind;
  position: LeafletLatLng;
}

/**
 * A demand-heatmap zone (M9-T2): its ring, the drawn tier (1..3, see
 * heatmap/levels.ts) and the multiplier chip at `labelAt`.
 */
export interface BridgeZone {
  id: string;
  ring: LeafletLatLng[];
  tier: 1 | 2 | 3;
  label: string;
  labelAt: LeafletLatLng;
}

/** The look of one heatmap tier, already resolved to colours. */
export interface BridgeZoneStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  dashed: boolean;
  chipBackground: string;
  chipText: string;
}

/** Everything the page draws, already in Leaflet order. */
export interface MapViewState {
  center: LeafletLatLng;
  zoom: number;
  markers: BridgeMarker[];
  route: LeafletLatLng[] | null;
  followMe: boolean;
  /** Heatmap zones, drawn under the route and markers. */
  zones?: BridgeZone[];
  /** Frame the route and markers (instead of center/zoom) whenever they change. */
  fit?: boolean;
  /** A picture, not a control: no pan, zoom or tap (read once, at page build). */
  static?: boolean;
}

export interface MapPageOptions {
  tileUrl: string;
  attribution: string;
  /** Attribution goes to the leading-edge corner in RTL. */
  rtl: boolean;
  /** Brand colors (tokens) for the markers and route. */
  colors: {
    self: string;
    selfBorder: string;
    point: string;
    route: string;
    background: string;
    /** The pickup ring (defaults to `point`). */
    ring?: string;
  };
  /** Heatmap tier looks, keyed "1".."3" (only maps that draw zones). */
  zoneStyles?: Record<string, BridgeZoneStyle>;
}

export type MapMessage =
  | { type: "ready" }
  | { type: "tiles"; ok: boolean }
  | { type: "followPaused" }
  | { type: "loadFailed" };

/**
 * JSON safe to embed in an inline <script> and in injected JS: `<` (so no
 * `</script>` can close the tag) and the JS-hostile line separators escaped.
 */
export function toScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The page; `initial` is drawn before the first message round-trip. */
export function buildMapPage(
  options: MapPageOptions,
  initial: MapViewState,
): string {
  const config = {
    tileUrl: options.tileUrl,
    // Attribution is plain text (escaped) — links would navigate the WebView.
    attribution: escapeHtmlText(options.attribution),
    attributionPosition: options.rtl ? "bottomleft" : "bottomright",
    colors: options.colors,
    zoneStyles: options.zoneStyles ?? {},
  };
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="${LEAFLET_CSS.href}" integrity="${LEAFLET_CSS.integrity}" crossorigin="" />
<style>html,body,#map{height:100%;margin:0;padding:0;background:${escapeHtmlText(options.colors.background)};}</style>
</head>
<body>
<div id="map"></div>
<script>
function labbyPost(message){
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
}
</script>
<script src="${LEAFLET_JS.src}" integrity="${LEAFLET_JS.integrity}" crossorigin="" onerror="labbyPost({type:'loadFailed'})"></script>
<script>
(function(){
  if (typeof L === 'undefined') { labbyPost({type:'loadFailed'}); return; }
  var config = ${toScriptJson(config)};
  var state = ${toScriptJson(initial)};
  var still = !!state.static;
  var map = L.map('map', {
    zoomControl: false, attributionControl: false,
    dragging: !still, touchZoom: !still, doubleClickZoom: !still, scrollWheelZoom: !still,
    boxZoom: !still, keyboard: !still, tap: !still
  });
  L.control.attribution({ position: config.attributionPosition, prefix: false }).addTo(map);
  var tilesOk = true;
  var tiles = L.tileLayer(config.tileUrl, { maxZoom: 19, attribution: config.attribution });
  tiles.on('tileerror', function(){ if (tilesOk) { tilesOk = false; labbyPost({type:'tiles', ok:false}); } });
  tiles.on('tileload', function(){ if (!tilesOk) { tilesOk = true; labbyPost({type:'tiles', ok:true}); } });
  tiles.addTo(map);
  var zoneLayer = L.layerGroup().addTo(map);
  var markerLayer = L.layerGroup().addTo(map);
  var routeLayer = null;
  var following = !!state.followMe;
  map.on('dragstart', function(){
    if (following) { following = false; labbyPost({type:'followPaused'}); }
  });
  function selfPosition(s){
    for (var i = 0; i < s.markers.length; i++) {
      if (s.markers[i].kind === 'self') return s.markers[i].position;
    }
    return null;
  }
  // Zones change once per surge cycle, while markers move every update:
  // redraw them only when their payload changed.
  var drawnZones = null;
  function drawZones(zones){
    var key = JSON.stringify(zones);
    if (key === drawnZones) return;
    drawnZones = key;
    zoneLayer.clearLayers();
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      var look = config.zoneStyles[String(z.tier)];
      if (!look || !z.ring || z.ring.length < 3) continue;
      L.polygon(z.ring, {
        color: look.stroke, opacity: look.strokeOpacity, weight: 2,
        dashArray: look.dashed ? '6 4' : null,
        fillColor: look.fill, fillOpacity: look.fillOpacity,
        interactive: false
      }).addTo(zoneLayer);
      var chip = document.createElement('span');
      chip.setAttribute('dir', 'ltr');
      chip.textContent = z.label;
      chip.style.cssText = 'display:inline-block;white-space:nowrap;font:800 14px/18px sans-serif;padding:4px 10px;border-radius:12px;transform:translate(-50%,-50%);'
        + 'background:' + look.chipBackground + ';color:' + look.chipText + ';';
      L.marker(z.labelAt, {
        icon: L.divIcon({ html: chip, className: '', iconSize: [0, 0] }),
        interactive: false, keyboard: false
      }).addTo(zoneLayer);
    }
  }
  function draw(s){
    drawZones(s.zones || []);
    markerLayer.clearLayers();
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      if (m.kind === 'pickup') {
        L.circleMarker(m.position, {
          radius: 7, color: config.colors.ring || config.colors.point, weight: 3,
          fillColor: config.colors.selfBorder, fillOpacity: 1, interactive: false
        }).addTo(markerLayer);
        continue;
      }
      if (m.kind === 'dropoff') {
        var square = document.createElement('span');
        square.style.cssText = 'display:block;width:14px;height:14px;box-sizing:content-box;transform:translate(-50%,-50%);'
          + 'background:' + config.colors.self + ';border:3px solid ' + config.colors.selfBorder + ';';
        L.marker(m.position, {
          icon: L.divIcon({ html: square, className: '', iconSize: [0, 0] }),
          interactive: false, keyboard: false
        }).addTo(markerLayer);
        continue;
      }
      var self = m.kind === 'self';
      L.circleMarker(m.position, {
        radius: self ? 9 : 7,
        color: self ? config.colors.selfBorder : config.colors.point,
        weight: 3,
        fillColor: self ? config.colors.self : config.colors.point,
        fillOpacity: 1
      }).addTo(markerLayer);
    }
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    if (s.route && s.route.length > 1) {
      routeLayer = L.polyline(s.route, { color: config.colors.route, weight: 5, opacity: 0.85 }).addTo(map);
    }
    // Pins sit on the line, never under it.
    markerLayer.eachLayer(function(layer){ if (layer.bringToFront) layer.bringToFront(); });
  }
  function sameCenter(a, b){ return a[0] === b[0] && a[1] === b[1]; }
  // Frames the route and every marker; a lone point is shown at the zoom.
  var framed = null;
  function frame(s){
    var points = (s.route || []).slice();
    for (var i = 0; i < s.markers.length; i++) points.push(s.markers[i].position);
    var key = JSON.stringify(points);
    if (key === framed) return;
    framed = key;
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 17 });
    } else {
      map.setView(points[0] || s.center, s.zoom);
    }
  }
  if (state.fit) frame(state);
  else map.setView((following && selfPosition(state)) || state.center, state.zoom);
  draw(state);
  window.labbyMap = {
    apply: function(next){
      var previous = state;
      state = next;
      if (!previous.followMe && next.followMe) following = true;
      if (previous.followMe && !next.followMe) following = false;
      draw(next);
      var self = selfPosition(next);
      if (next.fit) {
        frame(next);
      } else if (following && self) {
        map.panTo(self, { animate: true });
      } else if (!sameCenter(previous.center, next.center) || previous.zoom !== next.zoom) {
        map.setView(next.center, next.zoom);
      }
    },
    recenter: function(){
      following = true;
      var self = selfPosition(state);
      map.setView(self || state.center, state.zoom);
    }
  };
  labbyPost({type:'ready'});
})();
</script>
</body>
</html>`;
}

/** JS to inject that applies a new state (the trailing `true` is required by WebView). */
export function applyStateScript(state: MapViewState): string {
  return `window.labbyMap && window.labbyMap.apply(${toScriptJson(state)}); true;`;
}

export const RECENTER_SCRIPT =
  "window.labbyMap && window.labbyMap.recenter(); true;";

/** Parses a page message; anything unknown is ignored (null). */
export function parseMapMessage(data: string): MapMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const message = parsed as { type?: unknown; ok?: unknown };
  switch (message.type) {
    case "ready":
    case "followPaused":
    case "loadFailed":
      return { type: message.type };
    case "tiles":
      return { type: "tiles", ok: message.ok === true };
    default:
      return null;
  }
}

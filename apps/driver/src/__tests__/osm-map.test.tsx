/**
 * M6-T4 — the reusable OSM map (ES-04, NFR-A3): the single GeoJSON
 * [lng,lat] → Leaflet [lat,lng] conversion, the page built from runtime
 * config (tile URL + attribution, SRI-pinned Leaflet, script-safe JSON),
 * and the WebView bridge: ready / prop updates / tile failures / load
 * failure fallback / follow-me recenter / no navigation away.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';
import { WebView } from 'react-native-webview';

import { OsmMap } from '../components/map/osm-map';
import { DEFAULT_CONFIG } from '../config';
import { initI18n, setAppLanguage } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { latLngsToLineString, lineStringToLatLngs } from '../map/geojson';
import type { GeoJsonLineString } from '../map/geojson';
import {
  applyStateScript,
  buildMapPage,
  parseMapMessage,
  RECENTER_SCRIPT,
  toScriptJson,
} from '../map/leaflet-bridge';

const injectJavaScript = (WebView as unknown as { injectJavaScriptMock: jest.Mock })
  .injectJavaScriptMock;

const pageColors = {
  self: '#59128A',
  selfBorder: '#FFFFFF',
  point: '#9B3FC4',
  route: '#7A2DAE',
  background: '#EFE9FF',
};

function message(data: unknown) {
  act(() => {
    screen.getByTestId('osm-map-webview').props.onMessage({
      nativeEvent: { data: JSON.stringify(data) },
    });
  });
}

function renderMap(props: Partial<React.ComponentProps<typeof OsmMap>> = {}) {
  const base: React.ComponentProps<typeof OsmMap> = {
    center: { lat: 33.5138, lng: 36.2765 },
    markers: [{ id: 'self', kind: 'self', position: { lat: 33.5138, lng: 36.2765 } }],
    followMe: true,
    ...props,
  };
  const view = render(
    <LocaleProvider initialLanguage="en">
      <OsmMap {...base} />
    </LocaleProvider>,
  );
  return {
    ...view,
    update: (next: Partial<React.ComponentProps<typeof OsmMap>>) =>
      view.rerender(
        <LocaleProvider initialLanguage="en">
          <OsmMap {...base} {...next} />
        </LocaleProvider>,
      ),
  };
}

describe('GeoJSON conversion (the only [lng,lat] ↔ [lat,lng] flip)', () => {
  it('flips contract LineString pairs into Leaflet order and drops invalid pairs', () => {
    const line: GeoJsonLineString = {
      type: 'LineString',
      coordinates: [
        [36.2765, 33.5138],
        [36.29, 33.52],
        [200, 10],
        [Number.NaN, 1],
      ],
    };
    expect(lineStringToLatLngs(line)).toEqual([
      [33.5138, 36.2765],
      [33.52, 36.29],
    ]);
  });

  it('round-trips through both directions exactly', () => {
    const line: GeoJsonLineString = {
      type: 'LineString',
      coordinates: [
        [36.1, 33.4],
        [36.2, 33.5],
      ],
    };
    expect(latLngsToLineString(lineStringToLatLngs(line))).toEqual(line);
  });
});

describe('Leaflet page + bridge', () => {
  const state = {
    center: [33.5, 36.3] as [number, number],
    zoom: 16,
    markers: [],
    route: null,
    followMe: false,
  };

  it('builds the page from the configured tiles and attribution with pinned, SRI-checked Leaflet', () => {
    const html = buildMapPage(
      {
        tileUrl: 'https://tiles.example/{z}/{x}/{y}.png',
        attribution: '© OSM <contributors>',
        rtl: false,
        colors: pageColors,
      },
      state,
    );
    expect(html).toContain('"tileUrl":"https://tiles.example/{z}/{x}/{y}.png"');
    expect(html).toContain('© OSM &lt;contributors&gt;');
    expect(html).toContain('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
    expect(html).toContain('integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="');
    expect(html).toContain('"attributionPosition":"bottomright"');
    expect(
      buildMapPage(
        { tileUrl: 'x', attribution: 'y', rtl: true, colors: pageColors },
        state,
      ),
    ).toContain('"attributionPosition":"bottomleft"');
  });

  it('keeps embedded JSON from closing the script tag', () => {
    expect(toScriptJson({ a: '</script><script>alert(1)</script>' })).not.toContain('</script>');
    expect(applyStateScript(state)).toMatch(/^window\.labbyMap && window\.labbyMap\.apply\(/);
  });

  it('parses page messages and ignores anything unknown', () => {
    expect(parseMapMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseMapMessage('{"type":"tiles","ok":false}')).toEqual({ type: 'tiles', ok: false });
    expect(parseMapMessage('{"type":"evil"}')).toBeNull();
    expect(parseMapMessage('nope')).toBeNull();
  });
});

describe('<OsmMap />', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await initI18n();
    await setAppLanguage('en');
  });

  it('loads the page with the default OSM tiles + attribution and shows a spinner until ready', () => {
    renderMap();
    const html: string = screen.getByTestId('osm-map-webview').props.source.html;
    expect(html).toContain(DEFAULT_CONFIG.mapTileUrl);
    expect(html).toContain('© OpenStreetMap contributors');
    // Initial state already in Leaflet order.
    expect(html).toContain('"center":[33.5138,36.2765]');
    expect(screen.getByTestId('osm-map-loading')).toBeTruthy();

    message({ type: 'ready' });
    expect(screen.queryByTestId('osm-map-loading')).toBeNull();
  });

  it('pushes position updates through the bridge without reloading the page', () => {
    const view = renderMap();
    const firstHtml = screen.getByTestId('osm-map-webview').props.source.html;
    message({ type: 'ready' });
    injectJavaScript.mockClear();

    view.update({
      center: { lat: 33.52, lng: 36.29 },
      markers: [{ id: 'self', kind: 'self', position: { lat: 33.52, lng: 36.29 } }],
      route: { type: 'LineString', coordinates: [[36.29, 33.52], [36.3, 33.53]] },
    });

    expect(screen.getByTestId('osm-map-webview').props.source.html).toBe(firstHtml);
    expect(injectJavaScript).toHaveBeenCalledTimes(1);
    const script: string = injectJavaScript.mock.calls[0][0];
    expect(script).toContain('"position":[33.52,36.29]');
    expect(script).toContain('"route":[[33.52,36.29],[33.53,36.3]]');
  });

  it('shows a banner when tiles fail and clears it when they recover (NFR-A3)', () => {
    renderMap();
    message({ type: 'ready' });
    message({ type: 'tiles', ok: false });
    expect(screen.getByTestId('osm-map-tiles-down')).toBeTruthy();
    message({ type: 'tiles', ok: true });
    expect(screen.queryByTestId('osm-map-tiles-down')).toBeNull();
  });

  it('falls back to the coordinates when the map cannot load, with a retry', () => {
    renderMap();
    message({ type: 'loadFailed' });
    expect(screen.getByTestId('osm-map-unavailable')).toHaveTextContent(
      'Your position: 33.51380, 36.27650',
      { exact: false },
    );
    fireEvent.press(screen.getByTestId('osm-map-retry'));
    expect(screen.getByTestId('osm-map-webview')).toBeTruthy();
  });

  it('offers recenter after the user pans away from follow-me', () => {
    renderMap();
    message({ type: 'ready' });
    expect(screen.queryByTestId('osm-map-recenter')).toBeNull();
    message({ type: 'followPaused' });
    injectJavaScript.mockClear();
    fireEvent.press(screen.getByTestId('osm-map-recenter'));
    expect(injectJavaScript).toHaveBeenCalledWith(RECENTER_SCRIPT);
    expect(screen.queryByTestId('osm-map-recenter')).toBeNull();
  });

  it('never navigates the map page away — links open outside', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderMap();
    const guard = screen.getByTestId('osm-map-webview').props.onShouldStartLoadWithRequest;
    expect(guard({ url: 'about:blank', isTopFrame: true })).toBe(true);
    expect(guard({ url: 'https://www.openstreetmap.org/copyright', isTopFrame: true })).toBe(false);
    expect(openURL).toHaveBeenCalledWith('https://www.openstreetmap.org/copyright');
  });
});

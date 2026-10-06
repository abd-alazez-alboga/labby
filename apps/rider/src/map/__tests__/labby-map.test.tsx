/**
 * LabbyMap (M6-T4): runtime-config tiles + visible attribution, state
 * injection after the page is ready (no reloads), the tiles-unreachable
 * notice (NFR-A3) and the failed/reload state.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { LocaleProvider } from '../../i18n/locale-context';
import { LabbyMap } from '../labby-map';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiBaseUrl: 'http://api.test',
        mapTileUrlTemplate: 'https://tiles.test/{z}/{x}/{y}.png',
        mapTileAttribution: '© Test tiles',
      },
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webviewMock = require('react-native-webview') as { __injectJavaScript: jest.Mock };

const damascus = { lat: 33.5138, lng: 36.2765 };

async function renderMap(props: Partial<React.ComponentProps<typeof LabbyMap>> = {}) {
  const ui = (extra: Partial<React.ComponentProps<typeof LabbyMap>>) => (
    <LocaleProvider>
      <LabbyMap center={damascus} {...props} {...extra} />
    </LocaleProvider>
  );
  const result = await render(ui({}));
  return { ui, rerender: result.rerender };
}

async function sendFromPage(message: object) {
  await act(async () => {
    fireEvent(screen.getByTestId('labby-map-webview'), 'message', {
      nativeEvent: { data: JSON.stringify(message) },
    });
  });
}

describe('LabbyMap', () => {
  beforeEach(() => {
    webviewMock.__injectJavaScript.mockClear();
  });

  it('loads the configured tile template and always shows the attribution', async () => {
    await renderMap();
    const webView = await screen.findByTestId('labby-map-webview');
    const source = webView.props.source as { html: string; baseUrl: string };
    expect(source.html).toContain('"tileUrl":"https://tiles.test/{z}/{x}/{y}.png"');
    expect(source.html).toContain('"center":[33.5138,36.2765]');
    expect(source.baseUrl).toBe('http://api.test/');
    expect(screen.getByTestId('labby-map-attribution')).toHaveTextContent('© Test tiles');
    expect(screen.getByTestId('labby-map-loading')).toBeOnTheScreen();
  });

  it('injects new state after the page is ready instead of reloading it', async () => {
    const { ui, rerender } = await renderMap({ followMe: true });
    await screen.findByTestId('labby-map-webview');
    const htmlBefore = screen.getByTestId('labby-map-webview').props.source.html;

    await sendFromPage({ type: 'ready' });
    expect(screen.queryByTestId('labby-map-loading')).toBeNull();

    webviewMock.__injectJavaScript.mockClear();
    await rerender(ui({ center: { lat: 33.52, lng: 36.29 } }));

    expect(webviewMock.__injectJavaScript).toHaveBeenCalledTimes(1);
    const script = webviewMock.__injectJavaScript.mock.calls[0][0] as string;
    expect(script).toContain('"center":[33.52,36.29]');
    expect(script).toContain('"followMe":true');
    // Same page — the map was not reloaded.
    expect(screen.getByTestId('labby-map-webview').props.source.html).toBe(htmlBefore);
  });

  it('converts a GeoJSON route once and draws it dashed when approximate', async () => {
    await renderMap({
      route: { type: 'LineString', coordinates: [[36.2765, 33.5138], [36.3159, 33.5132]] },
      routeApproximate: true,
    });
    const html = (await screen.findByTestId('labby-map-webview')).props.source.html as string;
    expect(html).toContain('"route":[[33.5138,36.2765],[33.5132,36.3159]]');
    expect(html).toContain('"routeApproximate":true');
  });

  it('tells the user when tiles cannot be reached, and clears it when they load again', async () => {
    await renderMap();
    await screen.findByTestId('labby-map-webview');
    await sendFromPage({ type: 'ready' });

    await sendFromPage({ type: 'tiles', ok: false });
    expect(screen.getByTestId('labby-map-tiles-unavailable')).toHaveTextContent(
      'Map details are unavailable right now — check your connection.',
    );

    await sendFromPage({ type: 'tiles', ok: true });
    expect(screen.queryByTestId('labby-map-tiles-unavailable')).toBeNull();
  });

  it('shows a failed state when the map library cannot load, and reloads on retry', async () => {
    await renderMap();
    await screen.findByTestId('labby-map-webview');

    await sendFromPage({ type: 'error', reason: 'library' });
    expect(screen.getByTestId('labby-map-failed')).toBeOnTheScreen();
    expect(screen.getByText("The map couldn't load")).toBeOnTheScreen();
    expect(screen.queryByTestId('labby-map-webview')).toBeNull();

    await fireEvent.press(screen.getByTestId('labby-map-retry'));
    expect(screen.getByTestId('labby-map-webview')).toBeOnTheScreen();
    expect(screen.getByTestId('labby-map-loading')).toBeOnTheScreen();
  });
});

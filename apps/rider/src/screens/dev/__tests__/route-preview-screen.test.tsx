/**
 * Dev-only route preview (M6-T4): proves the routing contract end-to-end —
 * request body, polyline handed to the map, distance/duration and the
 * "approximate" label when the backend fell back to a straight line.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import RoutePreviewScreen, { parseLatLngInput } from "../route-preview-screen";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const ROUTE = "/api/v1/routing/route";

function route(approximate: boolean) {
  return {
    distanceMeters: 4630,
    durationSeconds: 670,
    geometry: {
      type: "LineString",
      coordinates: [
        [36.2765, 33.5138],
        [36.3159, 33.5132],
      ],
    },
    approximate,
  };
}

function renderPreview() {
  return render(
    <LocaleProvider>
      <RoutePreviewScreen />
    </LocaleProvider>,
  );
}

describe("RoutePreviewScreen (dev)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it('parses "lat, lng" input strictly', () => {
    expect(parseLatLngInput("33.5, 36.3")).toEqual({ lat: 33.5, lng: 36.3 });
    expect(parseLatLngInput("33.5")).toBeNull();
    expect(parseLatLngInput("95, 36.3")).toBeNull();
    expect(parseLatLngInput("a, b")).toBeNull();
    expect(parseLatLngInput(", 36")).toBeNull();
  });

  it("posts both points and renders the route with distance and duration", async () => {
    const api = mockApi({
      [`POST ${ROUTE}`]: { status: 200, body: route(false) },
    });

    await renderPreview();
    await fireEvent.press(await screen.findByTestId("route-submit"));

    expect(await screen.findByTestId("route-result")).toBeOnTheScreen();
    expect(api.callsTo("POST", ROUTE)[0].body).toEqual({
      points: [
        { lat: 33.5138, lng: 36.2765 },
        { lat: 33.5132, lng: 36.3159 },
      ],
    });
    expect(screen.getByTestId("route-distance")).toHaveTextContent(
      "Distance: 4.6 km",
    );
    expect(screen.getByTestId("route-duration")).toHaveTextContent(
      "Duration: about 11 min",
    );
    expect(screen.queryByTestId("route-approximate")).toBeNull();
    const html = screen.getByTestId("route-map-webview").props.source
      .html as string;
    expect(html).toContain('"route":[[33.5138,36.2765],[33.5132,36.3159]]');
    expect(html).toContain('"routeApproximate":false');
  });

  it("labels a straight-line fallback as approximate (NFR-A3)", async () => {
    mockApi({ [`POST ${ROUTE}`]: { status: 200, body: route(true) } });

    await renderPreview();
    await fireEvent.press(await screen.findByTestId("route-submit"));

    expect(await screen.findByTestId("route-approximate")).toHaveTextContent(
      "Approximate — straight-line estimate (routing service unavailable)",
    );
    const html = screen.getByTestId("route-map-webview").props.source
      .html as string;
    expect(html).toContain('"routeApproximate":true');
  });

  it("validates the points before calling the API", async () => {
    const api = mockApi({});

    await renderPreview();
    await fireEvent.changeText(
      await screen.findByTestId("route-origin"),
      "nowhere",
    );
    await fireEvent.press(screen.getByTestId("route-submit"));

    expect(
      await screen.findByTestId("route-destination-error"),
    ).toBeOnTheScreen();
    expect(api.callsTo("POST", ROUTE)).toHaveLength(0);
  });

  it("explains a failed request", async () => {
    mockApi({ [`POST ${ROUTE}`]: { status: 400, body: { status: 400 } } });

    await renderPreview();
    await fireEvent.press(await screen.findByTestId("route-submit"));

    expect(await screen.findByTestId("route-error")).toHaveTextContent(
      "The route couldn't be calculated.",
    );
  });
});

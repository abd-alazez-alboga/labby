/**
 * M13-T3 level & badges (UC-S-23, GAME-01/03) against growth-v1 mocks —
 * approved artboard R13Profile: the level card with the ladder from the
 * response (never hardcoded), the whole catalog in the grid — earned with
 * award date, locked with how to earn (no partial progress in the
 * contract) — and the earned count.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen } from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { gamificationView } from "../../../test-utils/growth-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import BadgesScreen from "../badges-screen";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
});

describe("level & badges (UC-S-23)", () => {
  it("shows the level card, the ladder and every catalog badge", async () => {
    const api = mockApi({
      "GET /api/v1/gamification/me": { status: 200, body: gamificationView() },
    });
    await render(
      <LocaleProvider>
        <BadgesScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("badges-level")).toHaveTextContent(
      /Silver/,
    );
    expect(screen.getByTestId("badges-lifetime")).toHaveTextContent(
      /1,740 lifetime points/,
    );
    // Ladder + distance to the next rung, from the response's levels.
    expect(screen.getByTestId("badges-ladder")).toHaveTextContent(
      /260 points to Gold · Bronze 0 · Silver 500 · Gold 2,000 · Platinum 5,000/,
    );
    expect(screen.getByTestId("badges-count")).toHaveTextContent(
      /Badges · 3 of 6/,
    );
    expect(api.callsTo("GET", "/api/v1/gamification/me")[0].query.as).toBe(
      "rider",
    );

    // Earned: the award date; locked: how to earn it (no progress counts).
    expect(screen.getByTestId("badge-ride_10-line")).toHaveTextContent(
      /Earned Sep 21/,
    );
    expect(screen.getByTestId("badge-ride_50-line")).toHaveTextContent(
      /Complete 50 rides/,
    );
    expect(screen.getByTestId("badge-five_star_week-line")).toHaveTextContent(
      /3 ratings in 7 days, all 5★/,
    );
    expect(screen.getByTestId("badge-first_shared_ride")).toHaveTextContent(
      /First shared ride/,
    );
    expect(screen.getByTestId("badge-first_referral-line")).toHaveTextContent(
      /Earned Oct 12/,
    );
  });

  it("shows the top state for a platinum rider", async () => {
    mockApi({
      "GET /api/v1/gamification/me": {
        status: 200,
        body: gamificationView({ level: "platinum", lifetime: 6200 }),
      },
    });
    await render(
      <LocaleProvider>
        <BadgesScreen />
      </LocaleProvider>,
    );
    expect(await screen.findByTestId("badges-ladder")).toHaveTextContent(
      /Top level · Bronze 0/,
    );
  });
});

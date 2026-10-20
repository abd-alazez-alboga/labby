/**
 * M13-T3 loyalty screen (UC-R-19, GRW-04) against growth-v1 mocks —
 * approved artboards R13Loyalty and R13Redeem: the balance card (level,
 * lifetime progress), the rule line rendered ONLY from the region rule,
 * the typed activity list, redeem disabled below the threshold (E1), the
 * redeem sheet's stepper + credit preview, the fresh balance after a
 * redemption, and the contract refusals (insufficient_points,
 * account_suspended — ruling 6).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { RegionProvider } from "../../../region/region-context";
import {
  challengeView,
  loyaltyBalance,
  pointsPage,
  regionConfig,
} from "../../../test-utils/growth-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import LoyaltyScreen from "../loyalty-screen";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const locationMock = Location as jest.Mocked<typeof Location>;

function grantLocation() {
  const permission = {
    granted: true,
    status: "granted" as Location.PermissionStatus,
    canAskAgain: true,
    expires: "never" as const,
  };
  locationMock.requestForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 33.5138, longitude: 36.2765 },
  } as Location.LocationObject);
  locationMock.watchPositionAsync.mockResolvedValue({
    remove: jest.fn(),
  } as unknown as Location.LocationSubscription);
}

const REGION_ROUTE = {
  "GET /api/v1/regions/resolve": { status: 200, body: regionConfig },
};

function renderLoyalty() {
  return render(
    <LocaleProvider>
      <RegionProvider>
        <LoyaltyScreen />
      </RegionProvider>
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  grantLocation();
});

describe("loyalty screen (UC-R-19)", () => {
  it("explains an out-of-area region with a retry instead of loading forever (W10)", async () => {
    mockApi({
      "GET /api/v1/regions/resolve": {
        status: 404,
        body: { status: 404, message: "outside" },
      },
    });
    await renderLoyalty();
    expect(
      await screen.findByTestId("loyalty-region-blocked"),
    ).toHaveTextContent("Outside our service area", { exact: false });
    expect(screen.getByTestId("loyalty-region-blocked-retry")).toBeOnTheScreen();
    expect(screen.queryByTestId("loyalty-loading")).toBeNull();
  });

  it("shows the balance card, the region rule and the typed activity", async () => {
    const api = mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/loyalty": { status: 200, body: loyaltyBalance() },
      "GET /api/v1/loyalty/transactions": { status: 200, body: pointsPage() },
    });
    await renderLoyalty();

    expect(await screen.findByTestId("loyalty-redeemable")).toHaveTextContent(
      /1,240/,
    );
    expect(screen.getByTestId("loyalty-level")).toHaveTextContent(/Silver/);
    expect(screen.getByTestId("loyalty-lifetime")).toHaveTextContent(
      /1,740 lifetime points · 260 more to Gold\. Spending points never lowers your level\./,
    );
    // The rule line is computed from the region rule, never hardcoded:
    // 0.01 pt/SYP → 1 point per SYP 100; rate 10 → 100 points = SYP 1,000.
    expect(screen.getByTestId("loyalty-rule")).toHaveTextContent(
      /You earn 1 point for every SYP 100 you pay on a ride\. From 500 points you can turn them into wallet credit — 100 points = SYP 1,000\./,
    );
    expect(
      api.callsTo("GET", "/api/v1/loyalty")[0].query.regionId,
    ).toBe(regionConfig.id);

    const rows = pointsPage().items;
    expect(
      screen.getByTestId(`loyalty-activity-${rows[0].pointsTransactionId}`),
    ).toHaveTextContent(/Ride/);
    expect(
      screen.getByTestId(
        `loyalty-activity-${rows[0].pointsTransactionId}-points`,
      ),
    ).toHaveTextContent(/\+275/);
    expect(
      screen.getByTestId(`loyalty-activity-${rows[1].pointsTransactionId}`),
    ).toHaveTextContent(/Challenge/);
    expect(
      screen.getByTestId(`loyalty-activity-${rows[2].pointsTransactionId}`),
    ).toHaveTextContent(/Turned into wallet credit/);
    expect(
      screen.getByTestId(
        `loyalty-activity-${rows[2].pointsTransactionId}-points`,
      ),
    ).toHaveTextContent(/−500/);
  });

  it("names the challenge a credit came from (R13Loyalty, V1 audit I57)", async () => {
    const rows = pointsPage().items;
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/loyalty": { status: 200, body: loyaltyBalance() },
      "GET /api/v1/loyalty/transactions": { status: 200, body: pointsPage() },
      "GET /api/v1/challenges": {
        status: 200,
        body: [challengeView({ challengeId: rows[1].challengeId as string })],
      },
    });
    await renderLoyalty();

    await waitFor(() =>
      expect(
        screen.getByTestId(
          `loyalty-activity-${rows[1].pointsTransactionId}-title`,
        ),
      ).toHaveTextContent("Challenge · Weekend rider"),
    );
    // Other rows keep their type label.
    expect(
      screen.getByTestId(`loyalty-activity-${rows[0].pointsTransactionId}-title`),
    ).toHaveTextContent("Ride");
  });

  it("disables redeeming below the region threshold (E1)", async () => {
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/loyalty": {
        status: 200,
        body: loyaltyBalance({ redeemable: 300 }),
      },
      "GET /api/v1/loyalty/transactions": {
        status: 200,
        body: pointsPage([]),
      },
    });
    await renderLoyalty();
    const cta = await screen.findByTestId("loyalty-redeem");
    expect(cta).toBeDisabled();
    await fireEvent.press(cta);
    expect(screen.queryByTestId("redeem-sheet")).toBeNull();
  });

  it("redeems via the stepper and shows the fresh balance", async () => {
    const after = loyaltyBalance({ redeemable: 640, lifetime: 1740 });
    const api = mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/loyalty": { status: 200, body: loyaltyBalance() },
      "GET /api/v1/loyalty/transactions": { status: 200, body: pointsPage() },
      "POST /api/v1/loyalty/redeem": { status: 200, body: after },
    });
    await renderLoyalty();
    await fireEvent.press(await screen.findByTestId("loyalty-redeem"));

    // Starts at the threshold; the preview uses the region rate.
    expect(await screen.findByTestId("redeem-points")).toHaveTextContent(/500/);
    expect(screen.getByTestId("redeem-credit")).toHaveTextContent(
      /\+SYP 5,000/,
    );
    expect(screen.getByTestId("redeem-left")).toHaveTextContent(/740/);
    await fireEvent.press(screen.getByTestId("redeem-more"));
    expect(screen.getByTestId("redeem-points")).toHaveTextContent(/600/);
    expect(screen.getByTestId("redeem-credit")).toHaveTextContent(
      /\+SYP 6,000/,
    );

    await fireEvent.press(screen.getByTestId("redeem-confirm"));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/v1/loyalty/redeem").length).toBe(1),
    );
    expect(api.callsTo("POST", "/api/v1/loyalty/redeem")[0].body).toEqual({
      regionId: regionConfig.id,
      points: 600,
    });
    await waitFor(() =>
      expect(screen.getByTestId("loyalty-redeemable")).toHaveTextContent(/640/),
    );
  });

  it("explains insufficient_points and account_suspended (ruling 6)", async () => {
    mockApi({
      ...REGION_ROUTE,
      "GET /api/v1/loyalty": { status: 200, body: loyaltyBalance() },
      "GET /api/v1/loyalty/transactions": { status: 200, body: pointsPage() },
      "POST /api/v1/loyalty/redeem": [
        {
          status: 409,
          body: {
            status: 409,
            message: "insufficient",
            code: "insufficient_points",
            details: { redeemable: "1240" },
          },
        },
        {
          status: 403,
          body: {
            status: 403,
            message: "suspended",
            code: "account_suspended",
          },
        },
      ],
    });
    await renderLoyalty();
    await fireEvent.press(await screen.findByTestId("loyalty-redeem"));
    await fireEvent.press(await screen.findByTestId("redeem-confirm"));
    expect(await screen.findByTestId("redeem-error")).toHaveTextContent(
      /You don't have that many points to spend\./,
    );
    await fireEvent.press(screen.getByTestId("redeem-confirm"));
    expect(await screen.findByTestId("redeem-error")).toHaveTextContent(
      /Your account is suspended — redemption is paused and your points are kept\./,
    );
    // Nothing redeemed: the sheet stays open, the balance untouched.
    expect(screen.getByTestId("loyalty-redeemable")).toHaveTextContent(/1,240/);
  });
});

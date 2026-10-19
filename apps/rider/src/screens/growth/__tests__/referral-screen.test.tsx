/**
 * M13-T3 referral screen (UC-R-18, GRW-03) against growth-v1 mocks —
 * approved artboards R13Referral(+Ar): the lazy share code with the region
 * reward amounts (null → amount-less copy), Copy + the system share sheet,
 * the referee statuses (pending / rewarded / blocked — E1 abuse shows as
 * blocked, never a phone), the regionId query when a region is resolved,
 * and the Arabic rendering (brand لبي, code kept LTR).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Location from "expo-location";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { Share } from "react-native";

import {
  LANGUAGE_STORAGE_KEY,
  LocaleProvider,
} from "../../../i18n/locale-context";
import { RegionProvider } from "../../../region/region-context";
import {
  referralStatus,
  regionConfig,
} from "../../../test-utils/growth-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import ReferralScreen from "../referral-screen";

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

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
});

describe("referral screen (UC-R-18)", () => {
  it("shows the code, the region amounts and the referee statuses", async () => {
    mockApi({
      "GET /api/v1/referrals/me": { status: 200, body: referralStatus() },
    });
    await render(
      <LocaleProvider>
        <ReferralScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("referral-code")).toHaveTextContent(
      /LB-SAMI42/,
    );
    // Equal amounts → the board's "You both get …" headline.
    expect(screen.getByTestId("referral-reward")).toHaveTextContent(
      /You both get SYP 25,000 in wallet credit/,
    );
    expect(screen.getByTestId("referral-referee-0")).toHaveTextContent(/Rama/);
    expect(screen.getByTestId("referral-referee-0-status")).toHaveTextContent(
      /First ride done · Oct 12/,
    );
    expect(screen.getByTestId("referral-referee-1-status")).toHaveTextContent(
      /Signed up · waiting for their first ride/,
    );
  });

  it("asks with regionId when a region is resolved", async () => {
    const api = mockApi({
      "GET /api/v1/regions/resolve": { status: 200, body: regionConfig },
      "GET /api/v1/referrals/me": { status: 200, body: referralStatus() },
    });
    grantLocation();
    await render(
      <LocaleProvider>
        <RegionProvider>
          <ReferralScreen />
        </RegionProvider>
      </LocaleProvider>,
    );
    await screen.findByTestId("referral-code");
    await waitFor(() =>
      expect(
        api
          .callsTo("GET", "/api/v1/referrals/me")
          .some((call) => call.query.regionId === regionConfig.id),
      ).toBe(true),
    );
    // One fetch only — the screen waits for the region to settle (Info 4).
    expect(api.callsTo("GET", "/api/v1/referrals/me")).toHaveLength(1);
  });

  it("falls back to amount-less copy without a reward, and shows blocked", async () => {
    mockApi({
      "GET /api/v1/referrals/me": {
        status: 200,
        body: referralStatus({
          reward: null,
          referees: [
            {
              firstName: null,
              status: "blocked",
              createdAt: "2026-10-05T09:00:00Z",
              rewardedAt: null,
            },
          ],
        }),
      },
    });
    await render(
      <LocaleProvider>
        <ReferralScreen />
      </LocaleProvider>,
    );
    expect(await screen.findByTestId("referral-reward")).toHaveTextContent(
      /You both get wallet credit/,
    );
    expect(screen.getByTestId("referral-referee-0")).toHaveTextContent(
      /A friend/,
    );
    expect(screen.getByTestId("referral-referee-0-status")).toHaveTextContent(
      /Not eligible/,
    );
  });

  it("shows split copy when the two amounts differ", async () => {
    mockApi({
      "GET /api/v1/referrals/me": {
        status: 200,
        body: referralStatus({
          reward: {
            regionId: regionConfig.id,
            currency: "SYP",
            referrerAmount: 30000,
            refereeAmount: 15000,
          },
        }),
      },
    });
    await render(
      <LocaleProvider>
        <ReferralScreen />
      </LocaleProvider>,
    );
    expect(await screen.findByTestId("referral-reward")).toHaveTextContent(
      /You get SYP 30,000, your friend gets SYP 15,000/,
    );
  });

  it("copies the code and opens the share sheet with it", async () => {
    const shareSpy = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" } as never);
    mockApi({
      "GET /api/v1/referrals/me": { status: 200, body: referralStatus() },
    });
    await render(
      <LocaleProvider>
        <ReferralScreen />
      </LocaleProvider>,
    );
    await fireEvent.press(await screen.findByTestId("referral-copy"));
    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith("LB-SAMI42"),
    );
    await fireEvent.press(screen.getByTestId("referral-share"));
    expect(shareSpy).toHaveBeenCalledWith({
      message:
        "Sign up for Labby with my code LB-SAMI42 — we both get wallet credit after your first ride.",
    });
  });

  it("renders in Arabic with the code kept left-to-right", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({
      "GET /api/v1/referrals/me": { status: 200, body: referralStatus() },
    });
    await render(
      <LocaleProvider>
        <ReferralScreen />
      </LocaleProvider>,
    );
    expect(await screen.findByTestId("referral-reward")).toHaveTextContent(
      /تحصلان معًا على رصيد/,
    );
    // The share code stays inside an LTR isolate in RTL text.
    expect(screen.getByTestId("referral-code")).toHaveTextContent(
      /⁦LB-SAMI42⁩/,
    );
    expect(screen.getByTestId("referral-referee-1-status")).toHaveTextContent(
      /سجّل · بانتظار رحلته الأولى/,
    );
  });
});

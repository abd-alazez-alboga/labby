/**
 * V1 audit W32 (DRV-03, UC-R-05 — approved artboard V1FRiderDriverCardPhoto):
 * the rider's driver card shows "Look for · {colour} {make} {model}" beside
 * the vehicle's first photo. The signed URL is resolved against the API
 * base URL; no photo or a photo that fails to load shows a car icon, and a
 * failed (expired) photo refetches the active ride once for a fresh URL.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";

import { getAppConfig } from "../../../config/app-config";
import {
  LANGUAGE_STORAGE_KEY,
  LocaleProvider,
} from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  acceptedRide,
  FakeSocket,
  fakeSocketFactory,
  sampleDriver,
} from "../../../test-utils/ride-fixtures";
import HomeScreen from "../../home-screen";
import { DriverCard } from "../ride-parts";

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const ACTIVE = "GET /api/v1/rides/active";
const PHOTO = "/api/v1/files/vehicle-token-1";
const FRESH_PHOTO = "/api/v1/files/vehicle-token-2";

function driverWithPhoto(photoUrl: string | null) {
  return { ...sampleDriver, vehicle: { ...sampleDriver.vehicle, photoUrl } };
}

function renderCard(photoUrl: string | null, onPhotoExpired?: () => void) {
  return render(
    <LocaleProvider>
      <DriverCard
        driver={driverWithPhoto(photoUrl)}
        onPhotoExpired={onPhotoExpired}
      />
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
});

describe("driver card vehicle photo (W32)", () => {
  it("shows the photo, resolved against the API base URL, beside Look for", async () => {
    await renderCard(PHOTO);

    const photo = await screen.findByTestId("vehicle-photo");
    expect(photo.props.source).toEqual({
      uri: `${getAppConfig().apiBaseUrl}${PHOTO}`,
    });
    expect(screen.queryByTestId("vehicle-photo-fallback")).toBeNull();
    expect(screen.getByTestId("driver-vehicle-block")).toHaveTextContent(
      "Look forSilver Hyundai Accent",
    );
    expect(
      screen.getByLabelText("Photo of the driver's car: Silver Hyundai Accent"),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("driver-name")).toHaveTextContent("Samer");
    expect(screen.getByTestId("driver-plate")).toHaveTextContent("دمشق 502345");
  });

  it("keeps an absolute photo URL unchanged", async () => {
    await renderCard("https://files.example.test/car.jpg");
    expect((await screen.findByTestId("vehicle-photo")).props.source).toEqual({
      uri: "https://files.example.test/car.jpg",
    });
  });

  it("shows a car icon when the vehicle has no photo", async () => {
    await renderCard(null);
    expect(await screen.findByTestId("vehicle-photo-fallback")).toBeOnTheScreen();
    expect(screen.queryByTestId("vehicle-photo")).toBeNull();
    expect(screen.getByTestId("driver-vehicle")).toHaveTextContent(
      "Silver Hyundai Accent",
    );
  });

  it("falls back to the icon on a failed load and asks for a fresh URL once", async () => {
    const onExpired = jest.fn();
    const view = await renderCard(PHOTO, onExpired);

    await fireEvent(await screen.findByTestId("vehicle-photo"), "error");
    expect(screen.getByTestId("vehicle-photo-fallback")).toBeOnTheScreen();
    expect(onExpired).toHaveBeenCalledTimes(1);

    // The refetched ride carries a fresh URL: the photo is tried again.
    await view.rerender(
      <LocaleProvider>
        <DriverCard
          driver={driverWithPhoto(FRESH_PHOTO)}
          onPhotoExpired={onExpired}
        />
      </LocaleProvider>,
    );
    const fresh = await screen.findByTestId("vehicle-photo");
    expect(fresh.props.source).toEqual({
      uri: `${getAppConfig().apiBaseUrl}${FRESH_PHOTO}`,
    });

    // The fresh URL fails too: the icon stays, no refetch loop.
    await fireEvent(fresh, "error");
    expect(screen.getByTestId("vehicle-photo-fallback")).toBeOnTheScreen();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("renders in Arabic", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    await renderCard(PHOTO);
    expect(await screen.findByText("ابحث عن")).toBeOnTheScreen();
    expect(screen.getByTestId("driver-vehicle")).toHaveTextContent(
      "Hyundai Accent Silver",
    );
    expect(
      screen.getByLabelText("صورة سيارة السائق: Hyundai Accent Silver"),
    ).toBeOnTheScreen();
  });

  it("refetches the active ride when the on-the-way photo expires", async () => {
    await seedSignedInSession();
    const api = mockApi({
      [ACTIVE]: [
        { status: 200, body: acceptedRide({ driver: driverWithPhoto(PHOTO) }) },
        {
          status: 200,
          body: acceptedRide({ driver: driverWithPhoto(FRESH_PHOTO) }),
        },
      ],
    });
    await render(
      <LocaleProvider>
        <RideProvider socketFactory={fakeSocketFactory}>
          <HomeScreen />
        </RideProvider>
      </LocaleProvider>,
    );

    const photo = await screen.findByTestId("vehicle-photo");
    expect(api.callsTo("GET", "/api/v1/rides/active")).toHaveLength(1);
    await act(async () => {
      fireEvent(photo, "error");
    });

    await waitFor(() =>
      expect(api.callsTo("GET", "/api/v1/rides/active")).toHaveLength(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId("vehicle-photo").props.source).toEqual({
        uri: `${getAppConfig().apiBaseUrl}${FRESH_PHOTO}`,
      }),
    );
  });
});

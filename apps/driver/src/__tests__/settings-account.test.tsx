import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderRouter, screen } from "expo-router/testing-library";
import { fireEvent, waitFor } from "@testing-library/react-native";

import { AuthProvider } from "../auth/AuthProvider";
import { clearSession, getSession } from "../auth/session";
import { SettingsScreen } from "../components/settings-screen";
import i18n, { initI18n, setAppLanguage } from "../i18n";
import { reloadForDirection } from "../i18n/direction-reload";
import { LocaleProvider } from "../i18n/LocaleProvider";
import {
  driverUser,
  installContractFetch,
  seedSession,
} from "../test-utils/contract";

jest.mock("../i18n/direction-reload", () => ({
  reloadForDirection: jest.fn(async () => true),
  takeReturnRoute: jest.fn(async () => null),
}));

let mockActiveRide: object | null = null;
jest.mock("../rides/DriverRideProvider", () => ({
  ...jest.requireActual("../rides/DriverRideProvider"),
  useOptionalDriverRide: () => (mockActiveRide ? { ride: mockActiveRide } : null),
}));

function renderSettings() {
  renderRouter(
    {
      index: () => (
        <LocaleProvider initialLanguage="en">
          <AuthProvider>
            <SettingsScreen />
          </AuthProvider>
        </LocaleProvider>
      ),
    },
    { initialUrl: "/" },
  );
}

describe("SettingsScreen — signed-in account behaviour", () => {
  beforeEach(async () => {
    mockActiveRide = null;
    jest.mocked(reloadForDirection).mockClear();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("saves the switched language to the account before the direction reload (W14)", async () => {
    const user = driverUser({ language: "en" });
    await seedSession(user, "1");
    const contract = installContractFetch({
      "PUT /api/v1/users/me": {
        status: 200,
        body: { ...user, language: "ar" },
      },
    });
    renderSettings();

    fireEvent.press(await screen.findByTestId("language-option-ar"));

    await waitFor(() => expect(reloadForDirection).toHaveBeenCalled());
    expect(i18n.language).toBe("ar");
    expect(contract.requestsTo("PUT /api/v1/users/me")[0].body).toEqual({
      name: user.name,
      language: "ar",
    });
    expect(getSession()?.user.language).toBe("ar");
  });

  it("still switches on the device when saving to the account fails (W14)", async () => {
    await seedSession(driverUser({ language: "en" }), "1");
    installContractFetch({
      "PUT /api/v1/users/me": {
        status: 500,
        body: { status: 500, message: "down" },
      },
    });
    renderSettings();

    fireEvent.press(await screen.findByTestId("language-option-ar"));

    await waitFor(() => expect(reloadForDirection).toHaveBeenCalled());
    expect(i18n.language).toBe("ar");
    expect(getSession()?.user.language).toBe("en");
  });

  it("disables logout with a reason while a ride is active (I32)", async () => {
    mockActiveRide = { id: "ride-1" };
    const contract = installContractFetch({});
    await seedSession(driverUser(), "1");
    renderSettings();

    const logout = await screen.findByTestId("settings-logout");
    expect(
      screen.getByText("Finish your current ride before logging out."),
    ).toBeTruthy();
    fireEvent.press(logout);
    expect(contract.requestsTo("POST /api/v1/auth/logout")).toHaveLength(0);
    expect(getSession()).not.toBeNull();
  });

  it("allows logout when no ride is active (I32)", async () => {
    installContractFetch({ "POST /api/v1/auth/logout": { status: 204 } });
    await seedSession(driverUser(), "1");
    renderSettings();

    fireEvent.press(await screen.findByTestId("settings-logout"));
    await waitFor(() => expect(getSession()).toBeNull());
    expect(
      screen.queryByText("Finish your current ride before logging out."),
    ).toBeNull();
  });
});

describe("SettingsScreen — production build (I96)", () => {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__;

  beforeEach(async () => {
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  });

  it("shows no direction chip and no API version line", () => {
    installContractFetch({});
    renderSettings();

    expect(screen.getByTestId("settings-screen")).toBeTruthy();
    expect(screen.queryByTestId("direction-flag")).toBeNull();
    expect(screen.queryByTestId(/^api-status-/)).toBeNull();
  });
});

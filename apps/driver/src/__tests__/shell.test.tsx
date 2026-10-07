import { renderRouter, screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { HomeScreen } from "../components/home-screen";
import { initI18n, setAppLanguage } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import {
  driverUser,
  installContractFetch,
  seedSession,
} from "../test-utils/contract";

describe("driver app shell", () => {
  beforeEach(async () => {
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("renders the real route tree: welcome when signed out (M2 auth gate)", async () => {
    renderRouter("src/app");

    expect(await screen.findByTestId("welcome-screen")).toBeTruthy();
    expect(screen.getByText("Drive with Labby")).toBeTruthy();
  });

  it("renders the real route tree with the home screen for a stored driver session", async () => {
    const user = driverUser();
    installContractFetch({
      "GET /api/v1/meta": {
        status: 200,
        body: { name: "labby-backend", version: "0.1.0" },
      },
      "GET /api/v1/users/me": { status: 200, body: user },
    });
    await seedSession(user);

    renderRouter("src/app");

    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    // Map-first home (design 2026-10-07): the status sheet, not a hero.
    expect(screen.getByTestId("home-sheet")).toBeTruthy();
    expect(screen.getByLabelText("Settings")).toBeTruthy();
  });

  it("renders the home screen with a settings (menu) button", async () => {
    renderRouter(
      {
        index: () => (
          <LocaleProvider initialLanguage="en">
            <HomeScreen />
          </LocaleProvider>
        ),
      },
      { initialUrl: "/" },
    );

    expect(await screen.findByTestId("settings-link")).toBeTruthy();
    expect(screen.getByTestId("settings-link")).toHaveProp(
      "accessibilityLabel",
      "Settings",
    );
  });
});

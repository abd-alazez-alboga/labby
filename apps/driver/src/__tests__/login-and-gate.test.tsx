import { renderRouter, screen } from "expo-router/testing-library";
import { fireEvent, waitFor } from "@testing-library/react-native";

import { clearSession, getSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import {
  driverUser,
  installContractFetch,
  riderOnlyUser,
  seedSession,
  tokensFor,
} from "../test-utils/contract";
import type { UserProfile } from "../api/auth-types";

async function loginAs(user: UserProfile) {
  const contract = installContractFetch({
    "GET /api/v1/meta": {
      status: 200,
      body: { name: "labby-backend", version: "0.1.0" },
    },
    "GET /api/v1/users/me": { status: 200, body: user },
    "POST /api/v1/auth/login": { status: 200, body: tokensFor(user, "1") },
  });

  renderRouter("src/app");
  // Signed out -> the welcome screen is the entry point.
  await screen.findByTestId("welcome-screen");

  fireEvent.press(screen.getByTestId("welcome-login"));
  await screen.findByTestId("login-screen");

  fireEvent.changeText(screen.getByTestId("login-phone"), user.phone);
  fireEvent.changeText(screen.getByTestId("login-password"), "password8");
  fireEvent.press(screen.getByTestId("login-submit"));

  return contract;
}

describe("login + driver gate (UC-S-02, M2-T4)", () => {
  beforeEach(async () => {
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("boots signed-out users into the welcome screen", async () => {
    installContractFetch({});
    renderRouter("src/app");
    expect(await screen.findByTestId("welcome-screen")).toBeTruthy();
  });

  it("logs in with client=driver and routes an ACTIVE-driver account to home", async () => {
    const user = driverUser();
    const contract = await loginAs(user);

    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    // The contract body: phone + password + client=driver.
    expect(contract.requestsTo("POST /api/v1/auth/login")[0].body).toEqual({
      phone: user.phone,
      password: "password8",
      client: "driver",
    });
    expect(getSession()).toMatchObject({ accessToken: "access-1" });
  });

  it("routes a rider-only account to the apply-to-drive gate instead of home", async () => {
    const user = riderOnlyUser();
    await loginAs(user);

    expect(await screen.findByTestId("apply-to-drive-screen")).toBeTruthy();
    expect(screen.getByTestId("gate-body")).toBeTruthy();
    expect(screen.queryByTestId("home-screen")).toBeNull();
  });

  it("gates an account whose driver role is suspended (not ACTIVE)", async () => {
    const user = driverUser({
      roles: [
        { role: "rider", state: "active" },
        { role: "driver", state: "suspended" },
      ],
    });
    await loginAs(user);

    expect(await screen.findByTestId("apply-to-drive-screen")).toBeTruthy();
    expect(screen.queryByTestId("home-screen")).toBeNull();
  });

  it("logs out from the gate back to the welcome screen", async () => {
    const user = riderOnlyUser();
    const contract = installContractFetch({
      "GET /api/v1/users/me": { status: 200, body: user },
      "POST /api/v1/auth/logout": { status: 204 },
    });
    await seedSession(user, "1");

    renderRouter("src/app");
    await screen.findByTestId("apply-to-drive-screen");

    fireEvent.press(screen.getByTestId("gate-logout"));
    expect(await screen.findByTestId("welcome-screen")).toBeTruthy();
    expect(getSession()).toBeNull();
    // Server-side revocation attempted with the stored refresh token.
    await waitFor(() =>
      expect(contract.requestsTo("POST /api/v1/auth/logout")).toHaveLength(1),
    );
    expect(contract.requestsTo("POST /api/v1/auth/logout")[0].body).toEqual({
      refreshToken: "refresh-1",
    });
  });

  it("restores a stored driver session on launch straight into home", async () => {
    const user = driverUser();
    installContractFetch({
      "GET /api/v1/meta": {
        status: 200,
        body: { name: "labby-backend", version: "0.1.0" },
      },
      "GET /api/v1/users/me": { status: 200, body: user },
    });
    await seedSession(user, "1");

    renderRouter("src/app");
    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    expect(screen.queryByTestId("welcome-screen")).toBeNull();
  });

  it("restores a stored rider-only session on launch into the gate", async () => {
    const user = riderOnlyUser();
    installContractFetch({
      "GET /api/v1/users/me": { status: 200, body: user },
    });
    await seedSession(user, "1");

    renderRouter("src/app");
    expect(await screen.findByTestId("apply-to-drive-screen")).toBeTruthy();
  });

  it("shows the invalid-credentials error on 401 and stays signed out", async () => {
    installContractFetch({
      "POST /api/v1/auth/login": {
        status: 401,
        body: { status: 401, message: "bad credentials" },
      },
    });
    renderRouter("src/app");
    await screen.findByTestId("welcome-screen");
    fireEvent.press(screen.getByTestId("welcome-login"));
    await screen.findByTestId("login-screen");

    fireEvent.changeText(screen.getByTestId("login-phone"), "+963900000001");
    fireEvent.changeText(screen.getByTestId("login-password"), "wrongpass");
    fireEvent.press(screen.getByTestId("login-submit"));

    await screen.findByTestId("login-error");
    expect(
      screen.getByText("Phone number or password is incorrect."),
    ).toBeTruthy();
    expect(getSession()).toBeNull();
  });

  it("shows the throttling error on 429", async () => {
    installContractFetch({
      "POST /api/v1/auth/login": {
        status: 429,
        body: { status: 429, message: "throttled" },
      },
    });
    renderRouter("src/app");
    await screen.findByTestId("welcome-screen");
    fireEvent.press(screen.getByTestId("welcome-login"));
    await screen.findByTestId("login-screen");

    fireEvent.changeText(screen.getByTestId("login-phone"), "+963900000001");
    fireEvent.changeText(screen.getByTestId("login-password"), "password8");
    fireEvent.press(screen.getByTestId("login-submit"));

    await screen.findByTestId("login-error");
    expect(
      screen.getByText("Too many failed attempts. Try again later."),
    ).toBeTruthy();
  });

  it("renders the auth screens in Arabic (RTL) when the stored language is ar", async () => {
    await setAppLanguage("ar");
    installContractFetch({});
    renderRouter("src/app");

    await screen.findByTestId("welcome-screen");
    expect(screen.getByText("انطلق مع لبي")).toBeTruthy();

    fireEvent.press(screen.getByTestId("welcome-login"));
    await screen.findByTestId("login-screen");
    expect(screen.getByText("رقم الهاتف")).toBeTruthy();
    expect(screen.getByText("نسيت كلمة المرور؟")).toBeTruthy();
  });

  it("shows the no-valid-role error on 403", async () => {
    installContractFetch({
      "POST /api/v1/auth/login": {
        status: 403,
        body: { status: 403, message: "no role" },
      },
    });
    renderRouter("src/app");
    await screen.findByTestId("welcome-screen");
    fireEvent.press(screen.getByTestId("welcome-login"));
    await screen.findByTestId("login-screen");

    fireEvent.changeText(screen.getByTestId("login-phone"), "+963900000001");
    fireEvent.changeText(screen.getByTestId("login-password"), "password8");
    fireEvent.press(screen.getByTestId("login-submit"));

    await screen.findByTestId("login-error");
    expect(
      screen.getByText("This account cannot access the Labby Driver app."),
    ).toBeTruthy();
  });
});

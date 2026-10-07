import { renderRouter, screen } from "expo-router/testing-library";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { AuthProvider } from "../auth/AuthProvider";
import { clearSession, getSession } from "../auth/session";
import { RegisterScreen } from "../components/auth/register-screen";
import { initI18n, setAppLanguage } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import {
  driverUser,
  installContractFetch,
  tokensFor,
} from "../test-utils/contract";
import type { ContractFetch } from "../test-utils/contract";

const PHONE = "+963900000009";

function renderRegister() {
  renderRouter(
    {
      index: () => (
        <LocaleProvider initialLanguage="en">
          <AuthProvider>
            <RegisterScreen />
          </AuthProvider>
        </LocaleProvider>
      ),
      login: () => <Text testID="login-route">login</Text>,
    },
    { initialUrl: "/" },
  );
}

async function reachCodeStep(contract: ContractFetch) {
  renderRegister();
  fireEvent.changeText(screen.getByTestId("register-phone"), PHONE);
  fireEvent.press(screen.getByTestId("register-send-code"));
  await screen.findByTestId("register-step-code");
  expect(
    contract.requestsTo("POST /api/v1/auth/register/start")[0].body,
  ).toEqual({ phone: PHONE });
}

describe("RegisterScreen (UC-S-01 / UC-S-08)", () => {
  beforeEach(async () => {
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("walks phone -> OTP -> details and stores the issued session", async () => {
    const user = driverUser({ phone: PHONE, name: "New Driver" });
    const contract = installContractFetch({
      "POST /api/v1/auth/register/start": { status: 204 },
      "POST /api/v1/auth/register/verify": {
        status: 200,
        body: { mode: "new", registrationToken: "reg-token-1" },
      },
      "POST /api/v1/auth/register/complete": {
        status: 201,
        body: tokensFor(user, "1"),
      },
    });

    await reachCodeStep(contract);

    fireEvent.changeText(screen.getByTestId("register-code"), "123456");
    fireEvent.press(screen.getByTestId("register-verify"));
    await screen.findByTestId("register-step-details");
    expect(
      contract.requestsTo("POST /api/v1/auth/register/verify")[0].body,
    ).toEqual({ phone: PHONE, code: "123456" });

    fireEvent.changeText(screen.getByTestId("register-name"), "New Driver");
    fireEvent.changeText(screen.getByTestId("register-password"), "password8");
    fireEvent.changeText(
      screen.getByTestId("register-confirm-password"),
      "password8",
    );

    // Completing without consent is blocked client-side (UC-S-01 step 4).
    fireEvent.press(screen.getByTestId("register-complete"));
    expect(
      contract.requestsTo("POST /api/v1/auth/register/complete"),
    ).toHaveLength(0);

    fireEvent.press(screen.getByTestId("register-terms"));
    fireEvent.press(screen.getByTestId("register-complete"));

    await waitFor(() => expect(getSession()).not.toBeNull());
    expect(
      contract.requestsTo("POST /api/v1/auth/register/complete")[0].body,
    ).toEqual({
      registrationToken: "reg-token-1",
      password: "password8",
      name: "New Driver",
      termsAccepted: true,
    });
    expect(getSession()).toMatchObject({ accessToken: "access-1" });
  });

  it("counts down a 60s resend cooldown, then allows resending", async () => {
    jest.useFakeTimers();
    try {
      const contract = installContractFetch({
        "POST /api/v1/auth/register/start": { status: 204 },
      });
      await reachCodeStep(contract);

      // Cooldown armed: the resend button shows the countdown.
      expect(screen.getByText("Resend code (60s)")).toBeTruthy();

      // Pressing while cooling down must NOT fire another request.
      fireEvent.press(screen.getByTestId("register-resend"));
      expect(
        contract.requestsTo("POST /api/v1/auth/register/start"),
      ).toHaveLength(1);

      await act(async () => {
        jest.advanceTimersByTime(59_000);
      });
      expect(screen.getByText("Resend code (1s)")).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      expect(screen.getByText("Resend code")).toBeTruthy();

      fireEvent.press(screen.getByTestId("register-resend"));
      await waitFor(() =>
        expect(
          contract.requestsTo("POST /api/v1/auth/register/start"),
        ).toHaveLength(2),
      );
      // Cooldown re-armed after the resend.
      expect(screen.getByText("Resend code (60s)")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows the wrong-code error on 400 and stays on the OTP step", async () => {
    const contract = installContractFetch({
      "POST /api/v1/auth/register/start": { status: 204 },
      "POST /api/v1/auth/register/verify": {
        status: 400,
        body: { status: 400, message: "wrong code" },
      },
    });
    await reachCodeStep(contract);

    fireEvent.changeText(screen.getByTestId("register-code"), "000000");
    fireEvent.press(screen.getByTestId("register-verify"));

    await screen.findByTestId("register-error");
    expect(
      screen.getByText("That code is not correct. Try again."),
    ).toBeTruthy();
    expect(screen.getByTestId("register-step-code")).toBeTruthy();
  });

  it("shows the expired/exhausted error on 410 with resend as the way out", async () => {
    const contract = installContractFetch({
      "POST /api/v1/auth/register/start": { status: 204 },
      "POST /api/v1/auth/register/verify": {
        status: 410,
        body: { status: 410, message: "expired" },
      },
    });
    await reachCodeStep(contract);

    fireEvent.changeText(screen.getByTestId("register-code"), "123456");
    fireEvent.press(screen.getByTestId("register-verify"));

    await screen.findByTestId("register-error");
    expect(
      screen.getByText(
        "That code expired or was tried too many times. Request a new one.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("register-resend")).toBeTruthy();
  });

  it("on 409 (phone already registered) offers going to login", async () => {
    installContractFetch({
      "POST /api/v1/auth/register/start": {
        status: 409,
        body: { status: 409, message: "taken" },
      },
    });
    renderRegister();

    fireEvent.changeText(screen.getByTestId("register-phone"), PHONE);
    fireEvent.press(screen.getByTestId("register-send-code"));

    await screen.findByTestId("register-error");
    expect(
      screen.getByText(
        "This phone number is already registered. Log in instead.",
      ),
    ).toBeTruthy();
    // Still on the phone step, with a direct path to login.
    expect(screen.getByTestId("register-step-phone")).toBeTruthy();
    fireEvent.press(screen.getByTestId("register-go-login"));
    expect(await screen.findByTestId("login-route")).toBeTruthy();
  });

  it("shows the rate-limit error on 429", async () => {
    installContractFetch({
      "POST /api/v1/auth/register/start": {
        status: 429,
        body: { status: 429, message: "cooldown" },
      },
    });
    renderRegister();

    fireEvent.changeText(screen.getByTestId("register-phone"), PHONE);
    fireEvent.press(screen.getByTestId("register-send-code"));

    await screen.findByTestId("register-error");
    expect(
      screen.getByText(
        "Too many codes requested. Please wait before trying again.",
      ),
    ).toBeTruthy();
  });

  it("takes the reactivation branch (mode=reactivated) to login instead of creating an account", async () => {
    const contract = installContractFetch({
      "POST /api/v1/auth/register/start": { status: 204 },
      "POST /api/v1/auth/register/verify": {
        status: 200,
        body: { mode: "reactivated", registrationToken: null },
      },
    });
    await reachCodeStep(contract);

    fireEvent.changeText(screen.getByTestId("register-code"), "123456");
    fireEvent.press(screen.getByTestId("register-verify"));

    await screen.findByTestId("register-step-reactivated");
    expect(screen.getByTestId("register-reactivated")).toBeTruthy();
    // No session was issued and no complete call happened (UC-S-08: log
    // in with the old password instead).
    expect(getSession()).toBeNull();
    expect(
      contract.requestsTo("POST /api/v1/auth/register/complete"),
    ).toHaveLength(0);

    fireEvent.press(screen.getByTestId("register-reactivated-login"));
    expect(await screen.findByTestId("login-route")).toBeTruthy();
  });

  it("offers start-over when the registration token expired (400 on complete)", async () => {
    const contract = installContractFetch({
      "POST /api/v1/auth/register/start": { status: 204 },
      "POST /api/v1/auth/register/verify": {
        status: 200,
        body: { mode: "new", registrationToken: "reg-token-1" },
      },
      "POST /api/v1/auth/register/complete": {
        status: 400,
        body: { status: 400, message: "token expired" },
      },
    });
    await reachCodeStep(contract);
    fireEvent.changeText(screen.getByTestId("register-code"), "123456");
    fireEvent.press(screen.getByTestId("register-verify"));
    await screen.findByTestId("register-step-details");

    fireEvent.changeText(screen.getByTestId("register-name"), "New Driver");
    fireEvent.changeText(screen.getByTestId("register-password"), "password8");
    fireEvent.changeText(
      screen.getByTestId("register-confirm-password"),
      "password8",
    );
    fireEvent.press(screen.getByTestId("register-terms"));
    fireEvent.press(screen.getByTestId("register-complete"));

    fireEvent.press(await screen.findByTestId("register-start-over"));
    expect(await screen.findByTestId("register-step-phone")).toBeTruthy();
    expect(getSession()).toBeNull();
  });

  it("routes a complete-step 409 (concurrent registration) to the phone-taken path", async () => {
    const contract = installContractFetch({
      "POST /api/v1/auth/register/start": { status: 204 },
      "POST /api/v1/auth/register/verify": {
        status: 200,
        body: { mode: "new", registrationToken: "reg-token-1" },
      },
      "POST /api/v1/auth/register/complete": {
        status: 409,
        body: { status: 409, message: "phone already registered" },
      },
    });
    await reachCodeStep(contract);
    fireEvent.changeText(screen.getByTestId("register-code"), "123456");
    fireEvent.press(screen.getByTestId("register-verify"));
    await screen.findByTestId("register-step-details");

    fireEvent.changeText(screen.getByTestId("register-name"), "New Driver");
    fireEvent.changeText(screen.getByTestId("register-password"), "password8");
    fireEvent.changeText(
      screen.getByTestId("register-confirm-password"),
      "password8",
    );
    fireEvent.press(screen.getByTestId("register-terms"));
    fireEvent.press(screen.getByTestId("register-complete"));

    expect(await screen.findByTestId("register-step-phone")).toBeTruthy();
    fireEvent.press(screen.getByTestId("register-go-login"));
    expect(await screen.findByTestId("login-route")).toBeTruthy();
  });
});

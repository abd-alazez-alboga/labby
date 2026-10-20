import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen } from "@testing-library/react-native";
import React from "react";

import { mockApi } from "../../../test-utils/mock-api";
import { renderWithProviders } from "../../../test-utils/render";
import ForgotPasswordScreen from "../forgot-password-screen";

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const START = "POST /api/v1/auth/password-reset/start";
const VERIFY = "POST /api/v1/auth/password-reset/verify";
const COMPLETE = "POST /api/v1/auth/password-reset/complete";

async function goToOtpStep() {
  await renderWithProviders(<ForgotPasswordScreen />);
  expect(await screen.findByTestId("forgot-step-phone")).toBeOnTheScreen();
  await fireEvent.changeText(
    screen.getByTestId("forgot-phone"),
    "+963900000001",
  );
  await fireEvent.press(screen.getByTestId("forgot-send-code"));
  expect(await screen.findByTestId("forgot-step-otp")).toBeOnTheScreen();
}

describe("ForgotPasswordScreen (UC-S-04)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
  });

  it("resets the password through the three contract steps", async () => {
    const api = mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 200, body: { resetToken: "reset-token-1" } },
      [COMPLETE]: { status: 204 },
    });

    await goToOtpStep();
    // Neutral wording — no account enumeration (UC-S-04 E4).
    expect(
      screen.getByText(
        "If this number is registered, a code has been sent by SMS.",
      ),
    ).toBeOnTheScreen();

    await fireEvent.changeText(
      screen.getByTestId("forgot-otp-code-input"),
      "123456",
    );
    await fireEvent.press(screen.getByTestId("forgot-otp-verify"));
    expect(await screen.findByTestId("forgot-step-password")).toBeOnTheScreen();

    await fireEvent.changeText(
      screen.getByTestId("forgot-new-password"),
      "brandnewpass1",
    );
    await fireEvent.changeText(
      screen.getByTestId("forgot-confirm-password"),
      "brandnewpass1",
    );
    await fireEvent.press(screen.getByTestId("forgot-complete"));
    expect(await screen.findByTestId("forgot-step-done")).toBeOnTheScreen();

    expect(
      api.callsTo("POST", "/api/v1/auth/password-reset/complete")[0].body,
    ).toEqual({
      resetToken: "reset-token-1",
      newPassword: "brandnewpass1",
    });

    await fireEvent.press(screen.getByTestId("forgot-go-login"));
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("starts the reset with the canonical E.164 number (H3)", async () => {
    const api = mockApi({ [START]: { status: 204 } });

    await renderWithProviders(<ForgotPasswordScreen />);
    expect(await screen.findByTestId("forgot-step-phone")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("forgot-phone"), "963 933 000 111");
    await fireEvent.press(screen.getByTestId("forgot-send-code"));

    expect(await screen.findByTestId("forgot-step-otp")).toBeOnTheScreen();
    expect(
      api.callsTo("POST", "/api/v1/auth/password-reset/start")[0].body,
    ).toEqual({ phone: "+963933000111" });
  });

  it("shows the wrong-code error on 400", async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 400, body: { status: 400, message: "wrong" } },
    });

    await goToOtpStep();
    await fireEvent.changeText(
      screen.getByTestId("forgot-otp-code-input"),
      "000000",
    );
    await fireEvent.press(screen.getByTestId("forgot-otp-verify"));

    expect(
      await screen.findByText(
        "Wrong code. Please check the SMS and try again.",
      ),
    ).toBeOnTheScreen();
  });

  it("shows the expired-code error on 410", async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 410, body: { status: 410, message: "gone" } },
    });

    await goToOtpStep();
    await fireEvent.changeText(
      screen.getByTestId("forgot-otp-code-input"),
      "111111",
    );
    await fireEvent.press(screen.getByTestId("forgot-otp-verify"));

    expect(
      await screen.findByText(
        "This code has expired or was used too many times. Request a new one.",
      ),
    ).toBeOnTheScreen();
  });

  it("shows the start-over error when the reset token is rejected (400)", async () => {
    mockApi({
      [START]: { status: 204 },
      [VERIFY]: { status: 200, body: { resetToken: "reset-token-1" } },
      [COMPLETE]: { status: 400, body: { status: 400, message: "weak" } },
    });

    await goToOtpStep();
    await fireEvent.changeText(
      screen.getByTestId("forgot-otp-code-input"),
      "123456",
    );
    await fireEvent.press(screen.getByTestId("forgot-otp-verify"));
    expect(await screen.findByTestId("forgot-step-password")).toBeOnTheScreen();

    await fireEvent.changeText(
      screen.getByTestId("forgot-new-password"),
      "brandnewpass1",
    );
    await fireEvent.changeText(
      screen.getByTestId("forgot-confirm-password"),
      "brandnewpass1",
    );
    await fireEvent.press(screen.getByTestId("forgot-complete"));

    expect(
      await screen.findByTestId("forgot-complete-error"),
    ).toBeOnTheScreen();
  });
});

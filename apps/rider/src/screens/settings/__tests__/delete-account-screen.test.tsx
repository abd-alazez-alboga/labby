import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { getStoredTokens } from "../../../auth/session-store";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import { renderWithProviders } from "../../../test-utils/render";
import WelcomeScreen from "../../auth/welcome-screen";
import DeleteAccountScreen from "../delete-account-screen";

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const REQUEST_2FA = "POST /api/v1/users/me/2fa/request";
const DELETE_ME = "DELETE /api/v1/users/me";

describe("DeleteAccountScreen (UC-S-07)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    secureStoreMock.__reset();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it("soft-deletes with a 2FA OTP and reaches the signed-out goodbye state", async () => {
    const api = mockApi({
      [REQUEST_2FA]: { status: 204 },
      [DELETE_ME]: { status: 204 },
    });

    // WelcomeScreen rendered alongside so the goodbye state is observable.
    await renderWithProviders(
      <>
        <DeleteAccountScreen />
        <WelcomeScreen />
      </>,
    );
    expect(
      await screen.findByTestId("delete-account-screen"),
    ).toBeOnTheScreen();
    // Consequences copy is shown before anything happens (UC-S-07 step 1).
    expect(screen.getByTestId("delete-consequences")).toBeOnTheScreen();
    expect(screen.getByTestId("auth-status")).toHaveTextContent("signedIn");

    await fireEvent.press(screen.getByTestId("delete-send-code"));
    expect(await screen.findByTestId("delete-otp")).toBeOnTheScreen();
    expect(
      api.callsTo("POST", "/api/v1/users/me/2fa/request")[0].headers
        .Authorization,
    ).toBe("Bearer seed-access");

    await fireEvent.changeText(screen.getByTestId("delete-otp"), "123456");
    await fireEvent.press(screen.getByTestId("delete-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "signedOut:deleted",
      );
    });
    expect(api.callsTo("DELETE", "/api/v1/users/me")[0].body).toEqual({
      otpCode: "123456",
    });
    // Tokens are gone and the welcome screen shows the goodbye state.
    expect(await getStoredTokens()).toBeNull();
    expect(screen.getByTestId("goodbye-banner")).toBeOnTheScreen();
    expect(screen.getByText("Your account was deleted")).toBeOnTheScreen();
  });

  it("shows the blocked message on 409 and stays signed in", async () => {
    mockApi({
      [REQUEST_2FA]: { status: 204 },
      [DELETE_ME]: {
        status: 409,
        body: { status: 409, message: "active ride" },
      },
    });

    await renderWithProviders(<DeleteAccountScreen />);
    expect(
      await screen.findByTestId("delete-account-screen"),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("delete-send-code"));
    expect(await screen.findByTestId("delete-otp")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("delete-otp"), "123456");
    await fireEvent.press(screen.getByTestId("delete-confirm"));

    expect(await screen.findByTestId("delete-server-error")).toBeOnTheScreen();
    expect(screen.getByTestId("auth-status")).toHaveTextContent("signedIn");
    expect(await getStoredTokens()).not.toBeNull();
  });

  it("shows the OTP rejection on 400 and stays signed in", async () => {
    mockApi({
      [REQUEST_2FA]: { status: 204 },
      [DELETE_ME]: { status: 400, body: { status: 400, message: "bad otp" } },
    });

    await renderWithProviders(<DeleteAccountScreen />);
    expect(
      await screen.findByTestId("delete-account-screen"),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("delete-send-code"));
    expect(await screen.findByTestId("delete-otp")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("delete-otp"), "999999");
    await fireEvent.press(screen.getByTestId("delete-confirm"));

    expect(
      await screen.findByText(
        "The code is wrong or expired. Request a new one.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("auth-status")).toHaveTextContent("signedIn");
  });
});

import { render, screen } from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../i18n/locale-context";
import HomeScreen from "../home-screen";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("HomeScreen (shell)", () => {
  it("renders the shell with EN strings by default", async () => {
    await render(
      <LocaleProvider>
        <HomeScreen />
      </LocaleProvider>,
    );

    // LocaleProvider resolves the persisted language asynchronously.
    expect(await screen.findByTestId("home-screen")).toBeOnTheScreen();
    expect(screen.getByText("Welcome to Labby")).toBeOnTheScreen();
    expect(screen.getByText("Your ride, your way.")).toBeOnTheScreen();
    expect(screen.getByTestId("open-settings")).toBeOnTheScreen();
  });
});

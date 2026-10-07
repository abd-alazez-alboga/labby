import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import { SettingsScreen } from "../components/settings-screen";
import i18n, { LANGUAGE_STORAGE_KEY, initI18n, setAppLanguage } from "../i18n";
import { reloadForDirection } from "../i18n/direction-reload";
import { LocaleProvider } from "../i18n/LocaleProvider";

jest.mock("../i18n/direction-reload", () => ({
  reloadForDirection: jest.fn(async () => true),
  takeReturnRoute: jest.fn(async () => null),
}));

describe("SettingsScreen language switch", () => {
  beforeEach(async () => {
    jest.mocked(reloadForDirection).mockClear();
    await AsyncStorage.clear();
    await initI18n();
    await setAppLanguage("en");
  });

  it("starts in English with an LTR direction flag", () => {
    render(
      <LocaleProvider initialLanguage="en">
        <SettingsScreen />
      </LocaleProvider>,
    );

    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.getByTestId("direction-flag")).toHaveTextContent("LTR");
  });

  it("switching to Arabic changes the locale, direction flag, and persists the choice", async () => {
    render(
      <LocaleProvider initialLanguage="en">
        <SettingsScreen />
      </LocaleProvider>,
    );

    fireEvent.press(screen.getByTestId("language-option-ar"));

    await waitFor(() => expect(i18n.language).toBe("ar"));
    expect(screen.getByTestId("direction-flag")).toHaveTextContent("RTL");
    // Shell strings re-render in Arabic.
    expect(screen.getByText("اللغة")).toBeTruthy();
    // Choice is persisted for the next launch.
    expect(await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ar");
    // The direction changed, so the app reloads back to Settings.
    expect(reloadForDirection).toHaveBeenCalledWith("/settings");
  });

  it("switching back to English restores the LTR flag", async () => {
    render(
      <LocaleProvider initialLanguage="en">
        <SettingsScreen />
      </LocaleProvider>,
    );

    fireEvent.press(screen.getByTestId("language-option-ar"));
    await waitFor(() => expect(i18n.language).toBe("ar"));

    fireEvent.press(screen.getByTestId("language-option-en"));
    await waitFor(() => expect(i18n.language).toBe("en"));
    expect(screen.getByTestId("direction-flag")).toHaveTextContent("LTR");
    expect(await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
  });
});

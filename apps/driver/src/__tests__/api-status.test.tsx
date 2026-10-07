import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen } from "@testing-library/react-native";

import { ApiStatus } from "../components/api-status";
import { initI18n, setAppLanguage } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";

describe("ApiStatus (meta smoke call)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await initI18n();
    await setAppLanguage("en");
  });

  afterEach(() => {
    // @ts-expect-error -- test-managed global
    delete globalThis.fetch;
  });

  it("shows the backend version when the meta call succeeds", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ name: "labby-backend", version: "0.1.0" }),
    }) as unknown as typeof fetch;

    render(
      <LocaleProvider initialLanguage="en">
        <ApiStatus />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("api-status-ok")).toBeTruthy();
    expect(screen.getByText("Backend version: 0.1.0")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/meta"),
      expect.anything(),
    );
  });

  it("shows a friendly offline state when the backend is unreachable", async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(
        new TypeError("Network request failed"),
      ) as unknown as typeof fetch;

    render(
      <LocaleProvider initialLanguage="en">
        <ApiStatus />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("api-status-offline")).toBeTruthy();
    expect(screen.getByText("Backend unreachable")).toBeTruthy();
  });
});

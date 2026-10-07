import { render, screen } from "@testing-library/react-native";
import React from "react";

import { LocaleProvider } from "../../i18n/locale-context";
import { ApiStatus } from "../api-status";

describe("ApiStatus (meta smoke call)", () => {
  afterEach(() => {
    // @ts-expect-error -- test-managed global
    delete globalThis.fetch;
  });

  it("shows the backend version when the meta call succeeds", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ name: "labby-backend", version: "0.1.0" }),
    }) as unknown as typeof fetch;

    await render(
      <LocaleProvider>
        <ApiStatus />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("api-status-ok")).toBeOnTheScreen();
    expect(screen.getByText("Backend version: 0.1.0")).toBeOnTheScreen();
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

    await render(
      <LocaleProvider>
        <ApiStatus />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("api-status-offline")).toBeOnTheScreen();
    expect(screen.getByText("Backend unreachable")).toBeOnTheScreen();
  });
});

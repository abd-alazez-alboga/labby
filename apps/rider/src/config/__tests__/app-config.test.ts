import { DEFAULT_CONFIG, getAppConfig } from "../app-config";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Constants = require("expo-constants").default;

describe("getAppConfig", () => {
  afterEach(() => {
    Constants.expoConfig = { extra: {} };
  });

  it("returns the documented defaults when nothing is configured", () => {
    expect(getAppConfig()).toEqual(DEFAULT_CONFIG);
    expect(getAppConfig().apiBaseUrl).toBe("http://localhost:8080");
  });

  it("reads apiBaseUrl from the app config extra and strips trailing slashes", () => {
    Constants.expoConfig = {
      extra: { apiBaseUrl: "https://api.labby.example/" },
    };
    expect(getAppConfig().apiBaseUrl).toBe("https://api.labby.example");
  });

  it("defaults the map tiles to the public OSM server with its attribution (ES-04)", () => {
    expect(getAppConfig().mapTileUrlTemplate).toBe(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    );
    expect(getAppConfig().mapTileAttribution).toBe(
      "© OpenStreetMap contributors",
    );
  });

  it("reads the tile URL template and attribution from the app config extra", () => {
    Constants.expoConfig = {
      extra: {
        mapTileUrlTemplate: "https://tiles.labby.example/{z}/{x}/{y}.png",
        mapTileAttribution: "© Labby tiles",
      },
    };
    expect(getAppConfig().mapTileUrlTemplate).toBe(
      "https://tiles.labby.example/{z}/{x}/{y}.png",
    );
    expect(getAppConfig().mapTileAttribution).toBe("© Labby tiles");
  });

  it("falls back to defaults when expoConfig is missing entirely", () => {
    Constants.expoConfig = null;
    expect(getAppConfig()).toEqual(DEFAULT_CONFIG);
  });
});

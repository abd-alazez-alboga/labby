import { DEFAULT_CONFIG, getConfig } from "../config";

describe("config accessor", () => {
  const originalEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  const originalTiles = process.env.EXPO_PUBLIC_MAP_TILE_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalEnv;
    }
    if (originalTiles === undefined) {
      delete process.env.EXPO_PUBLIC_MAP_TILE_URL;
    } else {
      process.env.EXPO_PUBLIC_MAP_TILE_URL = originalTiles;
    }
  });

  it("returns the app-config / default apiBaseUrl when no env override is set", () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;

    const config = getConfig();

    // Under jest there is no app.config extra, so the built-in default applies.
    expect(config.apiBaseUrl).toBe(DEFAULT_CONFIG.apiBaseUrl);
  });

  it("prefers EXPO_PUBLIC_API_BASE_URL over the baked-in value", () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.example.test";

    expect(getConfig().apiBaseUrl).toBe("https://api.example.test");
  });

  it("strips trailing slashes so paths join cleanly", () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.example.test/";

    expect(getConfig().apiBaseUrl).toBe("https://api.example.test");
  });

  it("defaults the map tiles to the public OSM server with its attribution (ES-04)", () => {
    delete process.env.EXPO_PUBLIC_MAP_TILE_URL;

    expect(getConfig().mapTileUrl).toBe(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    );
    expect(getConfig().mapAttribution).toBe("© OpenStreetMap contributors");
  });

  it("takes the tile URL template from config, never hard-coded", () => {
    process.env.EXPO_PUBLIC_MAP_TILE_URL =
      "https://tiles.labby.example/{z}/{x}/{y}.png";

    expect(getConfig().mapTileUrl).toBe(
      "https://tiles.labby.example/{z}/{x}/{y}.png",
    );
  });
});

import Constants from "expo-constants";

/** Typed runtime configuration for the Labby Driver app. */
export interface AppConfig {
  /** Base URL of the Labby backend API (no trailing slash). */
  apiBaseUrl: string;
  /**
   * Map tile URL template (`{z}/{x}/{y}`, optional `{s}`) — ES-04: tiles are
   * configurable so moving off the public OSM servers is config-only.
   */
  mapTileUrl: string;
  /** Attribution the tile provider requires, shown on every map. */
  mapAttribution: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  apiBaseUrl: "http://localhost:8080",
  mapTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  mapAttribution: "© OpenStreetMap contributors",
};

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

/**
 * Resolves the app configuration, closest to runtime first:
 * 1. `EXPO_PUBLIC_*` env vars — inlined by Expo at bundle time
 *    (`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_MAP_TILE_URL`,
 *    `EXPO_PUBLIC_MAP_ATTRIBUTION`).
 * 2. `extra.*` from app.config.ts (itself overridable with the
 *    `LABBY_DRIVER_*` env vars when the config is evaluated).
 * 3. Built-in defaults.
 *
 * True fetch-at-boot runtime config (admin-web style config.json) does not
 * apply to a shipped mobile binary; this env/extra layering is the RN
 * equivalent decided for M1.
 */
export function getConfig(): AppConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as Partial<AppConfig>;

  const apiBaseUrl = (
    nonEmpty(process.env.EXPO_PUBLIC_API_BASE_URL) ??
    nonEmpty(extra.apiBaseUrl) ??
    DEFAULT_CONFIG.apiBaseUrl
  ).replace(/\/+$/, "");

  const mapTileUrl =
    nonEmpty(process.env.EXPO_PUBLIC_MAP_TILE_URL) ??
    nonEmpty(extra.mapTileUrl) ??
    DEFAULT_CONFIG.mapTileUrl;

  const mapAttribution =
    nonEmpty(process.env.EXPO_PUBLIC_MAP_ATTRIBUTION) ??
    nonEmpty(extra.mapAttribution) ??
    DEFAULT_CONFIG.mapAttribution;

  return { apiBaseUrl, mapTileUrl, mapAttribution };
}

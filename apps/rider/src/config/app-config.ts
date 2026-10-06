/**
 * Typed runtime config accessor.
 *
 * Resolution order for each value:
 *   1. `EXPO_PUBLIC_*` env var (inlined into the client bundle at build time)
 *   2. `extra` from app.config.ts via expo-constants (which itself honors
 *      the `LABBY_*` env vars when the config is evaluated)
 *   3. hardcoded default (local backend, public OSM tile server)
 */
import Constants from 'expo-constants';

export interface AppConfig {
  /** Base URL of the Labby backend, no trailing slash. */
  apiBaseUrl: string;
  /**
   * Leaflet-style XYZ tile URL template (`{z}/{x}/{y}`, optional `{s}`).
   * ES-04: public OSM in V1; the pre-launch migration only changes this value.
   */
  mapTileUrlTemplate: string;
  /** Attribution required by the tile provider, always shown on the map. */
  mapTileAttribution: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  apiBaseUrl: 'http://localhost:8080',
  mapTileUrlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapTileAttribution: '© OpenStreetMap contributors',
};

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** First non-blank value wins. */
function pick(...candidates: (string | undefined)[]): string | undefined {
  return candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
}

export function getAppConfig(): AppConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as Partial<AppConfig>;
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_BASE_URL ?? extra.apiBaseUrl ?? DEFAULT_CONFIG.apiBaseUrl;
  return {
    apiBaseUrl: stripTrailingSlash(apiBaseUrl),
    mapTileUrlTemplate:
      pick(process.env.EXPO_PUBLIC_MAP_TILE_URL, extra.mapTileUrlTemplate) ??
      DEFAULT_CONFIG.mapTileUrlTemplate,
    mapTileAttribution:
      pick(process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION, extra.mapTileAttribution) ??
      DEFAULT_CONFIG.mapTileAttribution,
  };
}

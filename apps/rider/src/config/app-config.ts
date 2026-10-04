/**
 * Typed runtime config accessor.
 *
 * Resolution order for each value:
 *   1. `EXPO_PUBLIC_*` env var (inlined into the client bundle at build time)
 *   2. `extra` from app.config.ts via expo-constants (which itself honors
 *      `LABBY_API_BASE_URL` when the config is evaluated)
 *   3. hardcoded default (local backend)
 */
import Constants from 'expo-constants';

export interface AppConfig {
  /** Base URL of the Labby backend, no trailing slash. */
  apiBaseUrl: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  apiBaseUrl: 'http://localhost:8080',
};

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function getAppConfig(): AppConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as Partial<AppConfig>;
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_BASE_URL ?? extra.apiBaseUrl ?? DEFAULT_CONFIG.apiBaseUrl;
  return {
    apiBaseUrl: stripTrailingSlash(apiBaseUrl),
  };
}

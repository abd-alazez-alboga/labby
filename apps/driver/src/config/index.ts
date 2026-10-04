import Constants from 'expo-constants';

/** Typed runtime configuration for the Labby Driver app. */
export interface AppConfig {
  /** Base URL of the Labby backend API (no trailing slash). */
  apiBaseUrl: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  apiBaseUrl: 'http://localhost:8080',
};

/**
 * Resolves the app configuration, closest to runtime first:
 * 1. `EXPO_PUBLIC_API_BASE_URL` — env var inlined by Expo at bundle time.
 * 2. `extra.apiBaseUrl` from app.config.ts (itself overridable with
 *    `LABBY_DRIVER_API_BASE_URL` when the config is evaluated).
 * 3. Built-in default.
 *
 * True fetch-at-boot runtime config (admin-web style config.json) does not
 * apply to a shipped mobile binary; this env/extra layering is the RN
 * equivalent decided for M1.
 */
export function getConfig(): AppConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as Partial<AppConfig>;
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;

  const apiBaseUrl = (
    fromEnv ??
    extra.apiBaseUrl ??
    DEFAULT_CONFIG.apiBaseUrl
  ).replace(/\/+$/, '');

  return { apiBaseUrl };
}

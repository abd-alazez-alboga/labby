import type { ExpoConfig } from 'expo/config';

/**
 * Labby Rider — Expo app config.
 *
 * Branding assets in ./assets/branding/ are COPIES of the repo-level
 * /assets/images/ files (labby-icon.png, labby-logo.png, labby-logo-white.png),
 * which are the source of truth. Re-copy them if the brand assets change.
 *
 * Runtime-ish config: values under `extra` are read at runtime through
 * src/config/app-config.ts (expo-constants). `LABBY_API_BASE_URL` overrides
 * the API base URL when the bundle/config is evaluated (e.g. CI, dev server
 * start), and `EXPO_PUBLIC_API_BASE_URL` overrides it at bundle time on the
 * client. Defaults point at the local backend from docker-compose.
 *
 * Map tiles (ES-04): `extra.mapTileUrlTemplate` / `extra.mapTileAttribution`
 * are read at runtime by the map component — never hard-coded in it — so the
 * mandatory pre-launch move off the public OSM tile server is config-only.
 * `LABBY_MAP_TILE_URL` / `LABBY_MAP_TILE_ATTRIBUTION` override them when the
 * config is evaluated; `EXPO_PUBLIC_MAP_TILE_URL` /
 * `EXPO_PUBLIC_MAP_TILE_ATTRIBUTION` override them at bundle time.
 *
 * Push (ES-03): the expo-notifications plugin is registered here. The
 * Android Firebase config (google-services.json) comes from the
 * `GOOGLE_SERVICES_JSON` env var (see `android.googleServicesFile`) and only
 * takes effect in a development build — Expo Go cannot receive remote push.
 */
const config: ExpoConfig = {
  name: 'Labby',
  slug: 'labby-rider',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/branding/labby-icon.png',
  scheme: 'labbyrider',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.labby.rider',
    supportsTablet: false,
  },
  android: {
    package: 'com.labby.rider',
    // FCM config (M6-T5): an EAS secret FILE env var on cloud builds, never committed
    // (the real file lives outside the repo). Absent locally → no FCM, Expo Go keeps working.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    adaptiveIcon: {
      foregroundImage: './assets/branding/labby-icon.png',
      backgroundColor: '#FAF7FC', // --labby-bg-light
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        // Board LFLogoSplashRider (2026-10-21): the icon padded so Android 12+'s
        // circular splash mask never crops a spoke.
        image: './assets/branding/labby-splash.png',
        imageWidth: 200,
        backgroundColor: '#FAF7FC', // --labby-bg-light
      },
    ],
    'expo-localization',
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        photosPermission: 'Labby uses your photos to set your profile picture.',
      },
    ],
    'expo-notifications',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Labby uses your location to find your operating region and nearby rides.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiBaseUrl: process.env.LABBY_API_BASE_URL ?? 'http://localhost:8080',
    mapTileUrlTemplate:
      process.env.LABBY_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    mapTileAttribution:
      process.env.LABBY_MAP_TILE_ATTRIBUTION ?? '© OpenStreetMap contributors',
  },
};

export default config;

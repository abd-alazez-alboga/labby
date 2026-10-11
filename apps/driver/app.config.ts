import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Brand colors inlined because Expo's config loader cannot resolve
 * TypeScript imports from app.config.ts. SOURCE OF TRUTH:
 * /assets/theme/colors.scss (mirrored in src/theme/tokens.ts).
 */
const LABBY_PURPLE_700 = '#59128A'; // --labby-purple-700
const LABBY_PURPLE_900 = '#3D0B57'; // --labby-purple-900

/**
 * Default API base URL baked into the app config (`extra.apiBaseUrl`).
 * Override at config-evaluation time with LABBY_DRIVER_API_BASE_URL,
 * or at bundle time with EXPO_PUBLIC_API_BASE_URL (read in src/config).
 */
const DEFAULT_API_BASE_URL = 'http://localhost:8080';

/**
 * Map tiles (ES-04): the tile URL template and its required attribution are
 * config, never hard-coded in components — moving off the public OSM tile
 * servers (a pre-launch gate) is a config change. Override with
 * LABBY_DRIVER_MAP_TILE_URL / LABBY_DRIVER_MAP_ATTRIBUTION.
 */
const DEFAULT_MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_MAP_ATTRIBUTION = '© OpenStreetMap contributors';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // Distinct display name from the rider app (M1-T5).
  name: 'Labby Driver',
  slug: 'labby-driver',
  scheme: 'labbydriver',
  version: '0.1.0',
  orientation: 'portrait',
  // Brand assets copied from /assets/images (repo root) — that folder is the
  // source of truth; re-copy from there if the brand changes.
  //   assets/images/labby-icon.png       <- /assets/images/labby-icon.png
  //   assets/images/labby-logo-white.png <- /assets/images/labby-logo-white.png
  icon: './assets/images/labby-icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.labby.driver',
    supportsTablet: false,
  },
  android: {
    package: 'com.labby.driver',
    // FCM config (M6-T5): an EAS secret FILE env var on cloud builds, never committed
    // (the real file lives outside the repo). Absent locally → no FCM, Expo Go keeps working.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    adaptiveIcon: {
      foregroundImage: './assets/images/labby-icon.png',
      backgroundColor: LABBY_PURPLE_700,
    },
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Labby Driver uses your photo library for your profile photo, documents and vehicle photos.',
        cameraPermission:
          'Labby Driver uses your camera to photograph your profile photo, documents and vehicle.',
      },
    ],
    '@react-native-community/datetimepicker',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Labby Driver uses your location to find your operating region and ride requests, and shares it with Labby while you are online.',
        // M6-X2 (TRK-01 "whenever online"): keep streaming in the background while online,
        // under a location foreground service on Android (dev builds; Expo Go stays foreground).
        locationAlwaysAndWhenInUsePermission:
          'Labby Driver shares your location with Labby while you are online, also when the app is in the background, so you keep receiving ride requests.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    // Push (M6-T4). FCM credentials (google-services.json) arrive with M6-T5.
    'expo-notifications',
    [
      'expo-splash-screen',
      {
        image: './assets/images/labby-logo-white.png',
        imageWidth: 220,
        backgroundColor: LABBY_PURPLE_900,
      },
    ],
  ],
  // EAS project (M6-T5 development builds), owned by the owner's Expo account.
  owner: 'azez28.5',
  extra: {
    eas: { projectId: 'dbc68ad6-9d53-4776-bb7c-ef9898354e27' },
    apiBaseUrl: process.env.LABBY_DRIVER_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    mapTileUrl: process.env.LABBY_DRIVER_MAP_TILE_URL ?? DEFAULT_MAP_TILE_URL,
    mapAttribution:
      process.env.LABBY_DRIVER_MAP_ATTRIBUTION ?? DEFAULT_MAP_ATTRIBUTION,
  },
});

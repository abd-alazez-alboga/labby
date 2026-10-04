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
          'Labby Driver uses your photo library to set your profile photo.',
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/images/labby-logo-white.png',
        imageWidth: 220,
        backgroundColor: LABBY_PURPLE_900,
      },
    ],
  ],
  extra: {
    apiBaseUrl: process.env.LABBY_DRIVER_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  },
});

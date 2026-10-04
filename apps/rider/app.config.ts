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
        image: './assets/branding/labby-icon.png',
        imageWidth: 120,
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
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiBaseUrl: process.env.LABBY_API_BASE_URL ?? 'http://localhost:8080',
  },
};

export default config;

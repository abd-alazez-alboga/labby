/* eslint-env jest */
// AsyncStorage ships an official in-memory mock for Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-secure-store touches the native keychain; tests use an in-memory map.
// Suites can seed/inspect it through the mocked module's own API.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    /** Test helper (not part of the real module). */
    __reset: () => store.clear(),
  };
});

// expo-location touches native GPS. Defaults stay PENDING (same convention
// as the fetch stub below) so boot-time region resolution is inert unless a
// suite overrides these mocks per test.
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(() => new Promise(() => {})),
  getCurrentPositionAsync: jest.fn(() => new Promise(() => {})),
  watchPositionAsync: jest.fn(() => new Promise(() => {})),
}));

// expo-localization touches native code; tests pin the device locale to EN.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

// Default fetch stub: stays pending so components firing a boot-time API call
// (ApiStatus on the home screen) render deterministically with no act() noise.
// Suites that assert on API states override this per test.
globalThis.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;

// react-native-webview is native. The mock renders a host View carrying the
// WebView props (so suites can read `source.html` and fire `onMessage`) and
// exposes the imperative `injectJavaScript` as a shared jest.fn.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const injectJavaScript = jest.fn();
  const WebView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript, reload: jest.fn() }));
    return React.createElement(View, props);
  });
  WebView.displayName = 'WebView';
  return { __esModule: true, WebView, default: WebView, __injectJavaScript: injectJavaScript };
});

// expo-notifications is native. Defaults: permission denied and no taps, so
// a mounted NotificationsProvider never registers a device unless a suite
// overrides these mocks (and push-support) per test.
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  getDevicePushTokenAsync: jest.fn(() => new Promise(() => {})),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));

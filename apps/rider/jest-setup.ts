/* eslint-env jest */
// AsyncStorage ships an official in-memory mock for Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-localization touches native code; tests pin the device locale to EN.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

// Default fetch stub: stays pending so components firing a boot-time API call
// (ApiStatus on the home screen) render deterministically with no act() noise.
// Suites that assert on API states override this per test.
globalThis.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;

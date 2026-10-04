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

// expo-localization touches native code; tests pin the device locale to EN.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

// Default fetch stub: stays pending so components firing a boot-time API call
// (ApiStatus on the home screen) render deterministically with no act() noise.
// Suites that assert on API states override this per test.
globalThis.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;

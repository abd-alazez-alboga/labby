// Official in-memory mock — language persistence works across a test.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// In-memory secure store — token persistence works across a test without
// touching a real keychain. Reset happens via deleteItemAsync/clearSession.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, String(value));
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
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

// Image picker: default to "user canceled"; photo tests override per test.
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

// Default fetch stub: stays pending so components firing a boot-time API call
// (ApiStatus on the home/settings screens, the background profile refresh)
// render deterministically with no act() noise. Suites that assert on API
// states override this per test.
globalThis.fetch = jest.fn(() => new Promise(() => {}));

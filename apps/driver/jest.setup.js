// Official in-memory mock — language persistence works across a test.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Default fetch stub: stays pending so components firing a boot-time API call
// (ApiStatus on the home/settings screens) render deterministically with no
// act() noise. Suites that assert on API states override this per test.
global.fetch = jest.fn(() => new Promise(() => {}));

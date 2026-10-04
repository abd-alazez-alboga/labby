/* eslint-env jest */
// AsyncStorage ships an official in-memory mock for Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-localization touches native code; tests pin the device locale to EN.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

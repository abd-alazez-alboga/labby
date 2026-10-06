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
  Accuracy: { Balanced: 3, High: 4 },
  requestForegroundPermissionsAsync: jest.fn(() => new Promise(() => {})),
  getCurrentPositionAsync: jest.fn(() => new Promise(() => {})),
  watchPositionAsync: jest.fn(() => new Promise(() => {})),
}));

// expo-notifications (M6 push): permission queries stay PENDING by default
// so boot-time device registration is inert; listeners are no-op
// subscriptions. Push suites override per test.
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => new Promise(() => {})),
  requestPermissionsAsync: jest.fn(() => new Promise(() => {})),
  getDevicePushTokenAsync: jest.fn(() => new Promise(() => {})),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => {}),
  setNotificationHandler: jest.fn(),
}));

// The map's WebView: a plain host view forwarding its props (tests fire
// onMessage to simulate the page) with an injectJavaScript spy on the ref.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const injectJavaScript = jest.fn();
  const WebView = React.forwardRef(function WebViewMock(props, ref) {
    React.useImperativeHandle(ref, () => ({ injectJavaScript }));
    return React.createElement(View, {
      testID: props.testID,
      source: props.source,
      onMessage: props.onMessage,
      onError: props.onError,
      onShouldStartLoadWithRequest: props.onShouldStartLoadWithRequest,
    });
  });
  WebView.injectJavaScriptMock = injectJavaScript;
  return { __esModule: true, WebView, default: WebView };
});

// Realtime socket: never connects unless a suite installs its own mock.
globalThis.WebSocket = class InertWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
  }
  send() {}
  close() {
    this.readyState = 3;
  }
};

// Image picker: default to "user canceled"; photo tests override per test.
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
}));

// Document picker (onboarding PDFs/images): default "user canceled".
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

// Native date picker: a plain host view that forwards its props, so tests
// pick a date with fireEvent(picker, 'valueChange', event, date).
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Picker = (props) =>
    React.createElement(View, {
      testID: props.testID,
      onValueChange: props.onValueChange,
    });
  return {
    __esModule: true,
    default: Picker,
    DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() },
  };
});

// Default fetch stub: stays pending so components firing a boot-time API call
// (ApiStatus on the home/settings screens, the background profile refresh)
// render deterministically with no act() noise. Suites that assert on API
// states override this per test.
globalThis.fetch = jest.fn(() => new Promise(() => {}));

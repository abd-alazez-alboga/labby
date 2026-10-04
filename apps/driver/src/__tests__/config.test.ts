import { DEFAULT_CONFIG, getConfig } from '../config';

describe('config accessor', () => {
  const originalEnv = process.env.EXPO_PUBLIC_API_BASE_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalEnv;
    }
  });

  it('returns the app-config / default apiBaseUrl when no env override is set', () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;

    const config = getConfig();

    // Under jest there is no app.config extra, so the built-in default applies.
    expect(config.apiBaseUrl).toBe(DEFAULT_CONFIG.apiBaseUrl);
  });

  it('prefers EXPO_PUBLIC_API_BASE_URL over the baked-in value', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';

    expect(getConfig().apiBaseUrl).toBe('https://api.example.test');
  });

  it('strips trailing slashes so paths join cleanly', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test/';

    expect(getConfig().apiBaseUrl).toBe('https://api.example.test');
  });
});

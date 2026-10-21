// No @types/node in this app: the same minimal fs typing as i18n-keys.test.ts.
declare const __dirname: string;
const { readFileSync } = jest.requireActual('fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
};
const join = (...parts: string[]) => parts.join('/');

/**
 * L-C1 regression guard. Expo 57 swaps globalThis.fetch for expo/fetch unless
 * EXPO_PUBLIC_USE_RN_FETCH is set at bundle time, and expo/fetch rejects the
 * React Native {uri, name, type} FormData parts every upload in this app uses.
 * Jest mocks fetch, so no behavioural test can catch the flag going missing.
 */
const appRoot = join(__dirname, '..', '..');

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

describe('EXPO_PUBLIC_USE_RN_FETCH (L-C1)', () => {
  it('is enabled in the committed .env so Metro inlines it into every bundle', () => {
    const env = parseDotenv(readFileSync(join(appRoot, '.env'), 'utf8'));
    expect(env.EXPO_PUBLIC_USE_RN_FETCH).toBe('1');
  });

  it('is enabled in every EAS build profile', () => {
    const eas = JSON.parse(readFileSync(join(appRoot, 'eas.json'), 'utf8'));
    const profiles = Object.entries(eas.build ?? {});
    expect(profiles.length).toBeGreaterThan(0);
    for (const [, profile] of profiles) {
      expect((profile as { env?: Record<string, string> }).env?.EXPO_PUBLIC_USE_RN_FETCH).toBe('1');
    }
  });

  it('is still the switch the Expo winter runtime reads', () => {
    const runtime = readFileSync(
      join(appRoot, 'node_modules', 'expo', 'src', 'winter', 'runtime.native.ts'),
      'utf8',
    );
    expect(runtime).toContain("process.env.EXPO_PUBLIC_USE_RN_FETCH === '1'");
  });
});

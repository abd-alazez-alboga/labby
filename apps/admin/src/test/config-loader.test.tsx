import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FatalErrorPage } from '../app/FatalErrorPage';
import {
  loadRuntimeConfig,
  RuntimeConfigError,
  validateRuntimeConfig,
} from '../config/runtime-config';

function mockFetchOnce(mock: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(mock));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadRuntimeConfig', () => {
  it('returns the parsed config when config.json is valid', async () => {
    mockFetchOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ apiBaseUrl: 'http://api.test.local', environment: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(loadRuntimeConfig()).resolves.toEqual({
      apiBaseUrl: 'http://api.test.local',
      environment: 'test',
    });
  });

  it('rejects with RuntimeConfigError when the fetch fails (network error)', async () => {
    mockFetchOnce(() => Promise.reject(new TypeError('Failed to fetch')));

    await expect(loadRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  it('rejects with RuntimeConfigError on a non-2xx response', async () => {
    mockFetchOnce(() => Promise.resolve(new Response('not found', { status: 404 })));

    await expect(loadRuntimeConfig()).rejects.toThrow(/HTTP 404/);
  });

  it('rejects when apiBaseUrl is missing', async () => {
    mockFetchOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ environment: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(loadRuntimeConfig()).rejects.toThrow(/apiBaseUrl/);
  });
});

describe('validateRuntimeConfig', () => {
  it('rejects non-object payloads', () => {
    expect(() => validateRuntimeConfig('nope')).toThrow(RuntimeConfigError);
    expect(() => validateRuntimeConfig(null)).toThrow(RuntimeConfigError);
  });

  const FIREBASE_WEB = {
    apiKey: 'k',
    projectId: 'labby',
    messagingSenderId: '42',
    appId: '1:42:web:x',
    vapidKey: 'v',
  };

  it('treats an absent or null firebaseWeb block as "push not configured"', () => {
    expect(validateRuntimeConfig({ apiBaseUrl: 'http://a' }).firebaseWeb).toBeUndefined();
    expect(
      validateRuntimeConfig({ apiBaseUrl: 'http://a', firebaseWeb: null }).firebaseWeb,
    ).toBeUndefined();
  });

  it('accepts a complete firebaseWeb block and keeps only known keys', () => {
    const config = validateRuntimeConfig({
      apiBaseUrl: 'http://a',
      firebaseWeb: { ...FIREBASE_WEB, authDomain: 'labby.firebaseapp.com', extra: 'ignored' },
    });
    expect(config.firebaseWeb).toEqual({ ...FIREBASE_WEB, authDomain: 'labby.firebaseapp.com' });
  });

  it('ignores an incomplete firebaseWeb block with a warning instead of failing the boot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = validateRuntimeConfig({
      apiBaseUrl: 'http://a',
      firebaseWeb: { ...FIREBASE_WEB, vapidKey: '' },
    });
    expect(config.firebaseWeb).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vapidKey'));
    warn.mockRestore();
  });

  it('reads the map tile URL template from runtime config', () => {
    expect(validateRuntimeConfig({ apiBaseUrl: 'http://a' }).mapTileUrl).toBeUndefined();
    expect(
      validateRuntimeConfig({ apiBaseUrl: 'http://a', mapTileUrl: 'https://tiles/{z}/{x}/{y}.png' })
        .mapTileUrl,
    ).toBe('https://tiles/{z}/{x}/{y}.png');
  });
});

describe('config failure state', () => {
  it('renders the fatal error page with the failure detail', () => {
    render(<FatalErrorPage detail='config.json is missing required string "apiBaseUrl"' />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Labby Admin failed to start')).toBeInTheDocument();
    expect(screen.getByText(/apiBaseUrl/)).toBeInTheDocument();
  });
});

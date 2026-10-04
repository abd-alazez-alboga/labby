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
});

describe('config failure state', () => {
  it('renders the fatal error page with the failure detail', () => {
    render(<FatalErrorPage detail='config.json is missing required string "apiBaseUrl"' />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Labby Admin failed to start')).toBeInTheDocument();
    expect(screen.getByText(/apiBaseUrl/)).toBeInTheDocument();
  });
});

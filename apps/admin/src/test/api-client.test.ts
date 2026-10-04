import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from '../api/client';
import { TEST_CONFIG } from './test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('prefixes requests with apiBaseUrl from the runtime config', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient(TEST_CONFIG);
    const result = await client.get<{ ok: boolean }>('/api/v1/meta');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test.local/api/v1/meta',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws a typed ApiError on non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    );

    const client = createApiClient(TEST_CONFIG);

    await expect(client.get('/api/v1/meta')).rejects.toBeInstanceOf(ApiError);
    await expect(client.get('/api/v1/meta')).rejects.toMatchObject({ status: 500 });
  });
});

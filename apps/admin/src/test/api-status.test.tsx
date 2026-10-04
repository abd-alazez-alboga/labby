import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderShell, TEST_CONFIG } from './test-utils';

describe('API status (meta smoke call)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the backend version when the meta call succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: 'labby-backend', version: '0.1.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderShell();

    expect(await screen.findByText('API v0.1.0')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `${TEST_CONFIG.apiBaseUrl}/api/v1/meta`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('shows a friendly offline state when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    renderShell();

    await waitFor(() => {
      expect(screen.getByText('API unreachable')).toBeInTheDocument();
    });
    // The rest of the shell must still be alive.
    expect(screen.getByText('Dashboard', { selector: 'a' })).toBeInTheDocument();
  });
});

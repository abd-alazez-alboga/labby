import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attachmentFilename } from '../api/client';
import i18n from '../i18n/i18n';
import { csvResponse, EXPORTER, stubAnalyticsRoutes } from './analytics-fixtures';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

function exportUrl(fetchMock: ReturnType<typeof stubAnalyticsRoutes>, list: string): URL {
  return new URL(String(callsTo(fetchMock, `/api/v1/admin/exports/${list}`).at(-1)?.[0]));
}

/**
 * UC-A-31 Export CSV (ADM-06) against analytics-v1 mocks: each list sends
 * its exact on-screen filter (no paging) to its export, the file is saved
 * under the server's name, the 422 export_too_large banner, and the rides
 * chips that group several states cannot export.
 */
describe('CSV export', () => {
  const saved: string[] = [];
  /** Whether the object URL was revoked in the same task as the link click. */
  let revokedWithClick = false;

  beforeAll(async () => {
    await Promise.all([
      import('../pages/UsersPage'),
      import('../pages/RidesPage'),
      import('../pages/SupportTicketsPage'),
    ]);
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    saved.length = 0;
    revokedWithClick = false;
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:export'),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
      queueMicrotask(() => {
        revokedWithClick = vi.mocked(URL.revokeObjectURL).mock.calls.length > 0;
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exports the users list with exactly its filter and saves the server file name', async () => {
    window.history.pushState({}, '', '/users?role=driver&from=2026-10-01');
    seedStoredSession(sessionFor(EXPORTER));
    const fetchMock = stubAnalyticsRoutes(EXPORTER, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/exports/users' ? csvResponse('users') : null,
    );
    renderShell();
    const user = userEvent.setup();

    await screen.findAllByRole('row');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(saved).toEqual(['labby-users-20261020-081530Z.csv']));
    // The object URL outlives the click (revoked on a later task) and is then released.
    expect(revokedWithClick).toBe(false);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export'));
    const url = exportUrl(fetchMock, 'users');
    expect(url.searchParams.get('role')).toBe('driver');
    expect(url.searchParams.get('from')).toBe(new Date('2026-10-01T00:00:00').toISOString());
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('size')).toBe(false);
  });

  it('shows the too-large banner from a 422 export_too_large and dismisses it', async () => {
    window.history.pushState({}, '', '/users');
    seedStoredSession(sessionFor(EXPORTER));
    stubAnalyticsRoutes(EXPORTER, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/exports/users'
        ? jsonResponse(422, {
            message: 'too many',
            code: 'export_too_large',
            details: { limit: 50000, rows: 63140 },
          })
        : null,
    );
    renderShell();
    const user = userEvent.setup();

    await screen.findAllByRole('row');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many rows to export');
    expect(alert).toHaveTextContent(
      'These filters match 63,140 rows; one export holds up to 50,000.',
    );
    expect(saved).toHaveLength(0);
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('exports single-state rides and disables grouped chips', async () => {
    window.history.pushState({}, '', '/rides?state=completed&region=r1&day=2026-10-19');
    seedStoredSession(sessionFor(EXPORTER));
    const fetchMock = stubAnalyticsRoutes(EXPORTER, (method, path) => {
      if (method === 'GET' && path === '/api/v1/admin/rides') {
        return jsonResponse(200, { items: [], page: 0, size: 25, totalItems: 0 });
      }
      if (method === 'GET' && path === '/api/v1/admin/exports/rides') {
        return csvResponse('rides');
      }
      return null;
    });
    renderShell();
    const user = userEvent.setup();

    const button = await screen.findByRole('button', { name: 'Export CSV' });
    await user.click(button);
    await waitFor(() => expect(saved).toHaveLength(1));
    const url = exportUrl(fetchMock, 'rides');
    expect(url.searchParams.get('state')).toBe('completed');
    expect(url.searchParams.get('regionId')).toBe('r1');
    expect(url.searchParams.get('from')).toBe(new Date('2026-10-19T00:00:00').toISOString());

    await user.click(screen.getByRole('button', { name: 'Cancelled' }));
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveAttribute(
      'title',
      expect.stringContaining('single state'),
    );
  });

  it('exports the ticket queue with its status filter', async () => {
    window.history.pushState({}, '', '/support?status=open');
    seedStoredSession(sessionFor(EXPORTER));
    const fetchMock = stubAnalyticsRoutes(EXPORTER, (method, path) => {
      if (method === 'GET' && path === '/api/v1/admin/tickets') {
        return jsonResponse(200, { items: [], page: 0, size: 20, totalItems: 0 });
      }
      if (method === 'GET' && path === '/api/v1/admin/exports/tickets') {
        return csvResponse('tickets');
      }
      return null;
    });
    renderShell();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(saved).toEqual(['labby-tickets-20261020-081530Z.csv']));
    expect(exportUrl(fetchMock, 'tickets').searchParams.getAll('status')).toEqual(['open']);
  });

  it('reads the attachment filename from Content-Disposition', () => {
    expect(attachmentFilename('attachment; filename="labby-rides-1.csv"')).toBe(
      'labby-rides-1.csv',
    );
    expect(attachmentFilename("attachment; filename*=UTF-8''labby%20x.csv")).toBe('labby x.csv');
    expect(attachmentFilename(null)).toBeNull();
  });
});

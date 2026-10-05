import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditLogEntry } from '../api/rbac';
import i18n from '../i18n/i18n';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  stubFetchRoutes,
} from './test-utils';

const ENTRY_ROLE_UPDATE: AuditLogEntry = {
  id: 'audit-1',
  actorId: 'user-1',
  actorName: 'Root Admin',
  action: 'role.update',
  targetType: 'role',
  targetId: 'role-ops',
  before: { name: 'Ops', permissions: ['rides:view'] },
  after: { name: 'Ops', permissions: ['rides:view', 'users:view'] },
  createdAt: '2026-10-05T10:00:00Z',
};

const ENTRY_ADMIN_CREATE: AuditLogEntry = {
  id: 'audit-2',
  actorId: 'user-1',
  actorName: 'Root Admin',
  action: 'admin.create',
  targetType: 'admin',
  targetId: 'user-9',
  before: null,
  after: null,
  createdAt: '2026-10-05T09:00:00Z',
};

const VIEWER = adminUser(['audit:view']);

function stubAuditRoutes(items: AuditLogEntry[], totalItems = items.length) {
  return stubFetchRoutes((method, path) => {
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, VIEWER);
    }
    if (method === 'GET' && path === '/api/v1/admin/audit-log') {
      return jsonResponse(200, { items, page: 0, size: 25, totalItems });
    }
    return null;
  });
}

/** The query string of the most recent audit-log request. */
function lastAuditQuery(fetchMock: ReturnType<typeof stubFetchRoutes>): URLSearchParams {
  const calls = callsTo(fetchMock, '/audit-log');
  return new URL(String(calls[calls.length - 1][0])).searchParams;
}

describe('audit log page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/audit-log');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders entries with actor, action, target, and before/after details', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubAuditRoutes([ENTRY_ROLE_UPDATE, ENTRY_ADMIN_CREATE]);
    renderShell();

    expect(await screen.findByText('role.update')).toBeInTheDocument();
    expect(screen.getByText('admin.create')).toBeInTheDocument();
    expect(screen.getAllByText('Root Admin').length).toBe(2);
    expect(screen.getByText('role role-ops')).toBeInTheDocument();
    // Only the mutation with captured state offers the before/after view.
    expect(screen.getAllByText('Before / after').length).toBe(1);
  });

  it('sends the combinable filters as query parameters', async () => {
    seedStoredSession(sessionFor(VIEWER));
    const fetchMock = stubAuditRoutes([ENTRY_ROLE_UPDATE]);
    const user = userEvent.setup();
    renderShell();

    await screen.findByText('role.update');
    await user.type(screen.getByLabelText('Action'), 'role.update');
    await user.type(screen.getByLabelText('Actor ID'), 'user-1');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await vi.waitFor(() => {
      const params = lastAuditQuery(fetchMock);
      expect(params.get('action')).toBe('role.update');
      expect(params.get('actorId')).toBe('user-1');
      expect(params.get('page')).toBe('0');
      expect(params.get('size')).toBe('25');
      // Blank filters are omitted, per the contract's optional parameters.
      expect(params.get('targetType')).toBeNull();
      expect(params.get('from')).toBeNull();
    });
  });

  it('pages forward and back through the log', async () => {
    seedStoredSession(sessionFor(VIEWER));
    const fetchMock = stubAuditRoutes([ENTRY_ROLE_UPDATE, ENTRY_ADMIN_CREATE], 30);
    const user = userEvent.setup();
    renderShell();

    expect(await screen.findByText('Page 1 of 2 — 30 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await vi.waitFor(() => {
      expect(lastAuditQuery(fetchMock).get('page')).toBe('1');
    });
  });
});

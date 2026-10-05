import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  adminUser,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  stubFetchRoutes,
} from './test-utils';

/**
 * RBAC-03 UI side: menu entries and routes are gated by the same
 * `domain:action` strings the backend enforces. The permission-aware
 * helper (usePermissions / RequirePermission) is the pattern under test.
 */
describe('permission gating', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hides every gated menu entry from an admin with no permissions', async () => {
    const user = adminUser([]);
    seedStoredSession(sessionFor(user));
    stubFetchRoutes((method, path) =>
      method === 'GET' && path === '/api/v1/users/me' ? jsonResponse(200, user) : null,
    );
    renderShell();

    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('shows exactly the menu entries the role permits', async () => {
    const user = adminUser(['admins:view', 'audit:view']);
    seedStoredSession(sessionFor(user));
    stubFetchRoutes((method, path) =>
      method === 'GET' && path === '/api/v1/users/me' ? jsonResponse(200, user) : null,
    );
    renderShell();

    expect(await screen.findByRole('link', { name: 'Admins' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
  });

  it('blocks a direct URL without the permission on the 403 page', async () => {
    const user = adminUser(['roles:view']);
    seedStoredSession(sessionFor(user));
    stubFetchRoutes((method, path) =>
      method === 'GET' && path === '/api/v1/users/me' ? jsonResponse(200, user) : null,
    );
    window.history.pushState({}, '', '/admins');
    renderShell();

    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });

  it('lets a direct URL through with the permission', async () => {
    const user = adminUser(['admins:view']);
    seedStoredSession(sessionFor(user));
    stubFetchRoutes((method, path) => {
      if (method === 'GET' && path === '/api/v1/users/me') {
        return jsonResponse(200, user);
      }
      if (method === 'GET' && path === '/api/v1/admin/admins') {
        return jsonResponse(200, []);
      }
      return null;
    });
    window.history.pushState({}, '', '/admins');
    renderShell();

    expect(await screen.findByRole('heading', { name: 'Admin accounts' })).toBeInTheDocument();
  });

  it('applies a role edit on the next page refresh via profile revalidation', async () => {
    // The stored session predates the role edit (no admins:view); the
    // server already applied it. Reloading the page refreshes the profile,
    // so the UI picks up the new access without re-login — the documented
    // propagation path (server-side checks apply instantly regardless).
    const before = adminUser([]);
    const after = adminUser(['admins:view']);
    seedStoredSession(sessionFor(before));
    stubFetchRoutes((method, path) =>
      method === 'GET' && path === '/api/v1/users/me' ? jsonResponse(200, after) : null,
    );
    renderShell();

    expect(await screen.findByRole('link', { name: 'Admins' })).toBeInTheDocument();
  });
});

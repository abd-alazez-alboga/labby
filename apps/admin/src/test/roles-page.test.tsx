import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission, Role } from '../api/rbac';
import i18n from '../i18n/i18n';
import {
  adminUser,
  emptyResponse,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  stubFetchRoutes,
  type FetchRouteHandler,
} from './test-utils';

/** Catalog v1 in its stable order (enums/Permission.java). */
const CATALOG: Permission[] = [
  { code: 'users:view', domain: 'users' },
  { code: 'users:suspend', domain: 'users' },
  { code: 'rides:view', domain: 'rides' },
  { code: 'regions:view', domain: 'regions' },
  { code: 'regions:edit', domain: 'regions' },
  { code: 'pricing:view', domain: 'pricing' },
  { code: 'pricing:edit', domain: 'pricing' },
  { code: 'driver-review:view', domain: 'driver-review' },
  { code: 'driver-review:decide', domain: 'driver-review' },
  { code: 'support:view', domain: 'support' },
  { code: 'support:handle', domain: 'support' },
  { code: 'settlements:view', domain: 'settlements' },
  { code: 'settlements:record', domain: 'settlements' },
  { code: 'promos:view', domain: 'promos' },
  { code: 'promos:manage', domain: 'promos' },
  { code: 'analytics:view', domain: 'analytics' },
  { code: 'analytics:export', domain: 'analytics' },
  { code: 'audit:view', domain: 'audit' },
  { code: 'admins:view', domain: 'admins' },
  { code: 'admins:manage', domain: 'admins' },
  { code: 'roles:view', domain: 'roles' },
  { code: 'roles:manage', domain: 'roles' },
];

const SUPER_ROLE: Role = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Super Admin',
  isSystem: true,
  permissions: CATALOG.map((p) => p.code),
  assignedAdminCount: 1,
};

const SUPPORT_ROLE: Role = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Support',
  isSystem: true,
  permissions: ['users:view', 'rides:view', 'support:view', 'support:handle'],
  assignedAdminCount: 1,
};

const OPS_ROLE: Role = {
  id: 'role-ops',
  name: 'Ops',
  isSystem: false,
  permissions: ['rides:view'],
  assignedAdminCount: 0,
};

const MANAGER = adminUser(['roles:view', 'roles:manage']);
const VIEWER = adminUser(['roles:view']);

function stubRoleRoutes(user = MANAGER, extra?: FetchRouteHandler) {
  return stubFetchRoutes((method, path, init) => {
    const handled = extra?.(method, path, init);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'GET' && path === '/api/v1/admin/roles') {
      return jsonResponse(200, [SUPER_ROLE, SUPPORT_ROLE, OPS_ROLE]);
    }
    if (method === 'GET' && path === '/api/v1/admin/permissions') {
      return jsonResponse(200, CATALOG);
    }
    return null;
  });
}

describe('roles page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/roles');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists roles with type, permission count, and assigned admins', async () => {
    seedStoredSession(sessionFor(MANAGER));
    stubRoleRoutes();
    renderShell();

    const supportRow = (await screen.findByText('Support')).closest('tr')!;
    expect(within(supportRow).getByText('System')).toBeInTheDocument();
    expect(within(supportRow).getByText('4')).toBeInTheDocument();
    const opsRow = screen.getByText('Ops').closest('tr')!;
    expect(within(opsRow).getByText('Custom')).toBeInTheDocument();
  });

  it('builds a role from the checklist grouped by domain', async () => {
    seedStoredSession(sessionFor(MANAGER));
    const fetchMock = stubRoleRoutes(MANAGER, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/roles'
        ? jsonResponse(201, {
            id: 'role-new',
            name: 'Analyst',
            isSystem: false,
            permissions: ['analytics:view', 'analytics:export'],
            assignedAdminCount: 0,
          })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'New role' }));

    // The checklist is grouped by domain, in catalog order.
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Driver review' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Role name'), 'Analyst');
    await user.click(screen.getByRole('checkbox', { name: /View analytics/ }));
    await user.click(screen.getByRole('checkbox', { name: /Export analytics/ }));
    await user.click(screen.getByRole('button', { name: 'Save role' }));

    const row = (await screen.findByText('Analyst')).closest('tr')!;
    expect(within(row).getByText('Custom')).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: 'Analyst',
      permissions: ['analytics:view', 'analytics:export'],
    });
  });

  it('shows Super Admin read-only: view, no edit, no delete', async () => {
    seedStoredSession(sessionFor(MANAGER));
    stubRoleRoutes();
    const user = userEvent.setup();
    renderShell();

    const row = (await screen.findByText('Super Admin')).closest('tr')!;
    expect(within(row).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'View' }));
    expect(
      screen.getByText('Super Admin is a system role with full, unchangeable access.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /View users/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument();
  });

  it('edits Support permissions while its name stays locked', async () => {
    seedStoredSession(sessionFor(MANAGER));
    const fetchMock = stubRoleRoutes(MANAGER, (method, path) =>
      method === 'PUT' && path === `/api/v1/admin/roles/${SUPPORT_ROLE.id}`
        ? jsonResponse(200, {
            ...SUPPORT_ROLE,
            permissions: [...SUPPORT_ROLE.permissions, 'users:suspend'],
          })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const row = (await screen.findByText('Support')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Role name')).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Suspend users/ }));
    await user.click(screen.getByRole('button', { name: 'Save role' }));

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      name: 'Support',
      permissions: ['users:view', 'rides:view', 'support:view', 'support:handle', 'users:suspend'],
    });
    // Instant effect on holders is the backend's job (RBAC-02); the UI
    // reflects the updated role in the list.
    const updatedRow = (await screen.findByText('Support')).closest('tr')!;
    expect(await within(updatedRow).findByText('5')).toBeInTheDocument();
  });

  it('deletes a custom role after confirmation', async () => {
    seedStoredSession(sessionFor(MANAGER));
    stubRoleRoutes(MANAGER, (method, path) =>
      method === 'DELETE' && path === '/api/v1/admin/roles/role-ops' ? emptyResponse(204) : null,
    );
    const user = userEvent.setup();
    renderShell();

    const row = (await screen.findByText('Ops')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Support')).toBeInTheDocument();
    expect(screen.queryByText('Ops')).not.toBeInTheDocument();
  });

  it('surfaces the still-assigned conflict on delete', async () => {
    seedStoredSession(sessionFor(MANAGER));
    stubRoleRoutes(MANAGER, (method, path) =>
      method === 'DELETE' && path === '/api/v1/admin/roles/role-ops'
        ? jsonResponse(409, { status: 409, message: 'assigned' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const row = (await screen.findByText('Ops')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText(
        'This role cannot be deleted — it is a system role or still assigned to admins.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Ops')).toBeInTheDocument();
  });

  it('offers only viewing without roles:manage', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubRoleRoutes(VIEWER);
    renderShell();

    expect(await screen.findByText('Ops')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'View' }).length).toBe(3);
  });
});

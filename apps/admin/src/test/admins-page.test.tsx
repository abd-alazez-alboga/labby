import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminAccount, Role } from '../api/rbac';
import i18n from '../i18n/i18n';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  stubFetchRoutes,
  type FetchRouteHandler,
} from './test-utils';

const SUPER_ROLE: Role = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Super Admin',
  isSystem: true,
  permissions: ['admins:view', 'admins:manage', 'roles:view', 'roles:manage', 'audit:view'],
  assignedAdminCount: 1,
};

const SUPPORT_ROLE: Role = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Support',
  isSystem: true,
  permissions: ['users:view', 'rides:view', 'support:view', 'support:handle'],
  assignedAdminCount: 1,
};

const ADMIN_ONE: AdminAccount = {
  id: 'user-1',
  phone: '+963900000004',
  name: 'Super Admin',
  state: 'active',
  role: { id: SUPER_ROLE.id, name: SUPER_ROLE.name },
  grantedAt: '2026-10-01T10:00:00Z',
};

const ADMIN_TWO: AdminAccount = {
  id: 'user-2',
  phone: '+963900000007',
  name: 'Sami Haddad',
  state: 'active',
  role: { id: SUPPORT_ROLE.id, name: SUPPORT_ROLE.name },
  grantedAt: '2026-10-02T09:30:00Z',
};

const MANAGER = adminUser(['admins:view', 'admins:manage', 'roles:view']);
const VIEWER = adminUser(['admins:view']);

/** Base routes every test needs; `extra` wins when it returns a response. */
function stubAdminRoutes(user = MANAGER, extra?: FetchRouteHandler) {
  return stubFetchRoutes((method, path, init) => {
    const handled = extra?.(method, path, init);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'GET' && path === '/api/v1/admin/admins') {
      return jsonResponse(200, [ADMIN_ONE, ADMIN_TWO]);
    }
    if (method === 'GET' && path === '/api/v1/admin/roles') {
      return jsonResponse(200, [SUPER_ROLE, SUPPORT_ROLE]);
    }
    return null;
  });
}

describe('admins page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/admins');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists admin accounts with role, state, and phone', async () => {
    seedStoredSession(sessionFor(MANAGER));
    stubAdminRoutes();
    renderShell();

    expect(await screen.findByText('Sami Haddad')).toBeInTheDocument();
    expect(screen.getByText('+963900000007')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBe(2);
  });

  it('hides creation and row actions without admins:manage', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubAdminRoutes(VIEWER);
    renderShell();

    expect(await screen.findByText('Sami Haddad')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    // Role shown as text, not as a change control.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
  });

  it('creates a new admin and reports the set-password SMS', async () => {
    const created: AdminAccount = {
      id: 'user-3',
      phone: '+963900000009',
      name: 'Lina Aswad',
      state: 'active',
      role: { id: SUPPORT_ROLE.id, name: SUPPORT_ROLE.name },
      grantedAt: '2026-10-05T12:00:00Z',
    };
    seedStoredSession(sessionFor(MANAGER));
    const fetchMock = stubAdminRoutes(MANAGER, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/admins'
        ? jsonResponse(201, { mode: 'created', admin: created })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText('Phone number'), '+963900000009');
    await user.type(screen.getByLabelText('Name'), 'Lina Aswad');
    await user.selectOptions(screen.getByLabelText('Role'), SUPPORT_ROLE.id);
    await user.click(screen.getByRole('button', { name: 'Create admin' }));

    expect(
      await screen.findByText('Admin created. A set-password SMS was sent to the new admin.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Lina Aswad')).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      phone: '+963900000009',
      name: 'Lina Aswad',
      roleId: SUPPORT_ROLE.id,
    });
  });

  it('reports the granted-existing outcome distinctly', async () => {
    const granted: AdminAccount = {
      id: 'user-4',
      phone: '+963900000010',
      name: 'Existing Rider',
      state: 'active',
      role: { id: SUPPORT_ROLE.id, name: SUPPORT_ROLE.name },
      grantedAt: '2026-10-05T12:00:00Z',
    };
    seedStoredSession(sessionFor(MANAGER));
    stubAdminRoutes(MANAGER, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/admins'
        ? jsonResponse(201, { mode: 'granted_existing', admin: granted })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText('Phone number'), '+963900000010');
    await user.type(screen.getByLabelText('Name'), 'Ignored');
    await user.selectOptions(screen.getByLabelText('Role'), SUPPORT_ROLE.id);
    await user.click(screen.getByRole('button', { name: 'Create admin' }));

    expect(
      await screen.findByText(
        'The existing account was granted the admin role. It keeps its name and password.',
      ),
    ).toBeInTheDocument();
  });

  it('surfaces the already-an-admin conflict on creation', async () => {
    seedStoredSession(sessionFor(MANAGER));
    stubAdminRoutes(MANAGER, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/admins'
        ? jsonResponse(409, { status: 409, message: 'already admin' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText('Phone number'), '+963900000004');
    await user.type(screen.getByLabelText('Name'), 'Dup');
    await user.selectOptions(screen.getByLabelText('Role'), SUPPORT_ROLE.id);
    await user.click(screen.getByRole('button', { name: 'Create admin' }));

    expect(
      await screen.findByText('This phone number already belongs to an admin.'),
    ).toBeInTheDocument();
  });

  it('deactivates after inline confirmation and flips to reactivate', async () => {
    seedStoredSession(sessionFor(MANAGER));
    stubAdminRoutes(MANAGER, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/admins/user-2/deactivate'
        ? jsonResponse(200, { ...ADMIN_TWO, state: 'suspended' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const row = (await screen.findByText('Sami Haddad')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Deactivate' }));
    await user.click(within(row).getByRole('button', { name: 'Confirm' }));

    expect(await within(row).findByText('Deactivated')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('sends the optional deactivation note, trimmed', async () => {
    seedStoredSession(sessionFor(MANAGER));
    const fetchMock = stubAdminRoutes(MANAGER, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/admins/user-2/deactivate'
        ? jsonResponse(200, { ...ADMIN_TWO, state: 'suspended' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const row = (await screen.findByText('Sami Haddad')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Deactivate' }));
    await user.type(
      within(row).getByRole('textbox', { name: 'Note to the admin · optional' }),
      '  Contract ended.  ',
    );
    await user.click(within(row).getByRole('button', { name: 'Confirm' }));

    expect(await within(row).findByText('Deactivated')).toBeInTheDocument();
    const [call] = callsTo(fetchMock, '/api/v1/admin/admins/user-2/deactivate');
    expect(JSON.parse(String(call[1]?.body))).toEqual({ note: 'Contract ended.' });
  });

  it('surfaces the last-Super-Admin conflict on deactivation', async () => {
    seedStoredSession(sessionFor(MANAGER));
    stubAdminRoutes(MANAGER, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/admins/user-1/deactivate'
        ? jsonResponse(409, { status: 409, message: 'last super admin' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const row = (await screen.findByText('+963900000004')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Deactivate' }));
    await user.click(within(row).getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText('Not allowed: this would leave Labby without an active Super Admin.'),
    ).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });

  it('changes an admin role from the row select', async () => {
    seedStoredSession(sessionFor(MANAGER));
    stubAdminRoutes(MANAGER, (method, path) =>
      method === 'PUT' && path === '/api/v1/admin/admins/user-2/role'
        ? jsonResponse(200, { ...ADMIN_TWO, role: { id: SUPER_ROLE.id, name: SUPER_ROLE.name } })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const select = await screen.findByLabelText('Change role of Sami Haddad');
    await user.selectOptions(select, SUPER_ROLE.id);

    expect(await screen.findByLabelText('Change role of Sami Haddad')).toHaveValue(SUPER_ROLE.id);
  });
});

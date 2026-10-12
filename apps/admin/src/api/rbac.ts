import type { ApiClient } from './client';

/**
 * Contract types and calls for the M3 RBAC endpoints.
 * Source of truth: backend/docs/api/rbac-v1.yaml. Permission codes are the
 * `domain:action` strings shared VERBATIM with the backend catalog
 * (enums/Permission.java); the checklist groups them by the `domain` field
 * the catalog endpoint returns.
 */

export type PermissionCode =
  | 'users:view'
  | 'users:suspend'
  | 'rides:view'
  | 'regions:view'
  | 'regions:edit'
  | 'pricing:view'
  | 'pricing:edit'
  | 'driver-review:view'
  | 'driver-review:decide'
  | 'support:view'
  | 'support:handle'
  | 'settlements:view'
  | 'settlements:record'
  | 'wallets:view'
  | 'wallets:manage'
  | 'promos:view'
  | 'promos:manage'
  | 'analytics:view'
  | 'analytics:export'
  | 'audit:view'
  | 'admins:view'
  | 'admins:manage'
  | 'roles:view'
  | 'roles:manage';

export interface Permission {
  code: PermissionCode;
  domain: string;
}

export interface RoleSummary {
  id: string;
  name: string;
}

export interface Role extends RoleSummary {
  isSystem: boolean;
  permissions: PermissionCode[];
  assignedAdminCount: number;
}

export interface RoleRequest {
  name: string;
  permissions: PermissionCode[];
}

export interface AdminAccount {
  /** The user id. */
  id: string;
  phone: string;
  name: string;
  /** State of the admin ROLE assignment (deactivated = suspended). */
  state: 'active' | 'suspended';
  role: RoleSummary;
  grantedAt: string;
}

export interface CreateAdminRequest {
  phone: string;
  name: string;
  roleId: string;
}

export interface CreateAdminResponse {
  /** `created` = new account + set-password OTP sent; `granted_existing` = role granted to the existing account. */
  mode: 'created' | 'granted_existing';
  admin: AdminAccount;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  page: number;
  size: number;
  totalItems: number;
}

export interface AuditLogQuery {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

/* ---------- Admins ---------- */

/** GET /admin/admins — requires admins:view. */
export function listAdmins(client: ApiClient): Promise<AdminAccount[]> {
  return client.get<AdminAccount[]>('/api/v1/admin/admins');
}

/** POST /admin/admins — requires admins:manage; 409 = phone already an admin. */
export function createAdmin(
  client: ApiClient,
  body: CreateAdminRequest,
): Promise<CreateAdminResponse> {
  return client.post<CreateAdminResponse>('/api/v1/admin/admins', body);
}

/** PUT /admin/admins/{userId}/role — requires admins:manage; 409 = last active Super Admin. */
export function changeAdminRole(
  client: ApiClient,
  userId: string,
  roleId: string,
): Promise<AdminAccount> {
  return client.put<AdminAccount>(`/api/v1/admin/admins/${userId}/role`, { roleId });
}

/** POST /admin/admins/{userId}/deactivate — requires admins:manage; 409 = last active Super Admin. */
export function deactivateAdmin(client: ApiClient, userId: string): Promise<AdminAccount> {
  return client.post<AdminAccount>(`/api/v1/admin/admins/${userId}/deactivate`);
}

/** POST /admin/admins/{userId}/reactivate — requires admins:manage. */
export function reactivateAdmin(client: ApiClient, userId: string): Promise<AdminAccount> {
  return client.post<AdminAccount>(`/api/v1/admin/admins/${userId}/reactivate`);
}

/* ---------- Roles & catalog ---------- */

/** GET /admin/roles — requires roles:view. */
export function listRoles(client: ApiClient): Promise<Role[]> {
  return client.get<Role[]>('/api/v1/admin/roles');
}

/** POST /admin/roles — requires roles:manage; 409 = duplicate name. */
export function createRole(client: ApiClient, body: RoleRequest): Promise<Role> {
  return client.post<Role>('/api/v1/admin/roles', body);
}

/** PUT /admin/roles/{roleId} — requires roles:manage; 409 = system-role violation or duplicate name. */
export function updateRole(client: ApiClient, roleId: string, body: RoleRequest): Promise<Role> {
  return client.put<Role>(`/api/v1/admin/roles/${roleId}`, body);
}

/** DELETE /admin/roles/{roleId} — requires roles:manage; 409 = system role or still assigned. */
export function deleteRole(client: ApiClient, roleId: string): Promise<void> {
  return client.delete<void>(`/api/v1/admin/roles/${roleId}`);
}

/** GET /admin/permissions — the catalog, stable order; requires roles:view. */
export function listPermissions(client: ApiClient): Promise<Permission[]> {
  return client.get<Permission[]>('/api/v1/admin/permissions');
}

/* ---------- Audit log ---------- */

/** GET /admin/audit-log — newest first, filters combinable; requires audit:view. */
export function queryAuditLog(client: ApiClient, query: AuditLogQuery): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return client.get<AuditLogPage>(`/api/v1/admin/audit-log${qs ? `?${qs}` : ''}`);
}

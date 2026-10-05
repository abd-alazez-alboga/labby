import { useMemo } from 'react';

import type { PermissionCode } from '../api/rbac';
import { useAuth } from './AuthContext';
import { adminPermissions } from './permissions';

export interface PermissionsApi {
  /** The signed-in admin's permission codes. */
  permissions: ReadonlySet<string>;
  /** Whether the signed-in admin holds the given permission. */
  can(code: PermissionCode): boolean;
}

/**
 * Permission-aware UI helper (the pattern for every admin screen): menus,
 * routes, and controls ask `can('domain:action')` with the same strings the
 * backend enforces. UI gating is cosmetic — the server check is the law.
 */
export function usePermissions(): PermissionsApi {
  const { user } = useAuth();
  return useMemo(() => {
    const permissions = adminPermissions(user);
    return { permissions, can: (code: PermissionCode) => permissions.has(code) };
  }, [user]);
}

import { Suspense, lazy, type ReactNode } from 'react';

import type { PermissionCode } from '../api/rbac';
import { usePermissions } from './usePermissions';

const ForbiddenPage = lazy(() => import('../pages/ForbiddenPage'));

/**
 * Route guard: renders its child page only when the signed-in admin holds
 * the permission; otherwise the 403 page. Wraps every permissioned route —
 * the same code string the backend enforces on the endpoints behind it.
 * A list means ANY of the codes (a section reachable through several, e.g.
 * Users with `users:view` or `wallets:view`).
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionCode | readonly PermissionCode[];
  children: ReactNode;
}) {
  const { can } = usePermissions();
  const codes: readonly PermissionCode[] =
    typeof permission === 'string' ? [permission] : permission;

  if (!codes.some((code) => can(code))) {
    return (
      <Suspense fallback={<div className="loading" />}>
        <ForbiddenPage />
      </Suspense>
    );
  }
  return <>{children}</>;
}

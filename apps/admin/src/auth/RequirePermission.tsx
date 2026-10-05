import { Suspense, lazy, type ReactNode } from 'react';

import type { PermissionCode } from '../api/rbac';
import { usePermissions } from './usePermissions';

const ForbiddenPage = lazy(() => import('../pages/ForbiddenPage'));

/**
 * Route guard: renders its child page only when the signed-in admin holds
 * the permission; otherwise the 403 page. Wraps every permissioned route —
 * the same code string the backend enforces on the endpoints behind it.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionCode;
  children: ReactNode;
}) {
  const { can } = usePermissions();

  if (!can(permission)) {
    return (
      <Suspense fallback={<div className="loading" />}>
        <ForbiddenPage />
      </Suspense>
    );
  }
  return <>{children}</>;
}

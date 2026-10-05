import type { UserProfile } from '../api/auth';

/**
 * The signed-in admin's permission codes (RBAC-03 UI gating).
 *
 * Single source: the ACTIVE `admin` role assignment on the profile, whose
 * optional `permissions` field the M3-T2 backend fills (pending that, or for
 * any other transport the backend settles on, ONLY this function changes).
 * Absent fields mean no permissions — the UI denies by default and the
 * server-side check (RBAC-03) remains the real enforcement either way.
 *
 * Propagation: permissions load with the profile, which the auth context
 * fetches at login and re-fetches on every page load — so a role edit
 * changes an admin's UI on their next page refresh, while the backend
 * applies it to API calls immediately.
 */
export function adminPermissions(user: UserProfile | null): ReadonlySet<string> {
  const assignment = user?.roles.find((r) => r.role === 'admin' && r.state === 'active');
  return new Set(assignment?.permissions ?? []);
}

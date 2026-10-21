import { Navigate, Outlet, useLocation } from 'react-router-dom';

import AccessDeactivatedPage from '../pages/AccessDeactivatedPage';
import { useAuth } from './AuthContext';
import { accessBlock } from './permissions';

/**
 * Route guard: anonymous visitors go to /login, remembering where they were
 * headed. A signed-in admin whose admin access is deactivated (or whose
 * account is suspended) gets the access-deactivated screen in place of the
 * whole dashboard (USR-06, V1 W5 / I31) until they log out.
 */
export function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  const block = accessBlock(user);
  if (block) {
    return <AccessDeactivatedPage block={block} />;
  }
  return <Outlet />;
}

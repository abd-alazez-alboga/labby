import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider } from '../auth/AuthContext';
import { RequireAuth } from '../auth/RequireAuth';
import { RequirePermission } from '../auth/RequirePermission';
import { AppLayout } from '../layout/AppLayout';

// Lazy-loaded routes: this is the pattern every future feature page follows.
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const LoginPage = lazy(() => import('../pages/LoginPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));
const AdminsPage = lazy(() => import('../pages/AdminsPage'));
const RolesPage = lazy(() => import('../pages/RolesPage'));
const AuditLogPage = lazy(() => import('../pages/AuditLogPage'));

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <Suspense fallback={<div className="loading" />}>
                <LoginPage />
              </Suspense>
            }
          />
          {/* Everything else requires a signed-in admin. */}
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route
                index
                element={
                  <Suspense fallback={<div className="loading" />}>
                    <DashboardPage />
                  </Suspense>
                }
              />
              {/* Permissioned routes: guard + page share the backend's code. */}
              <Route
                path="admins"
                element={
                  <Suspense fallback={<div className="loading" />}>
                    <RequirePermission permission="admins:view">
                      <AdminsPage />
                    </RequirePermission>
                  </Suspense>
                }
              />
              <Route
                path="roles"
                element={
                  <Suspense fallback={<div className="loading" />}>
                    <RequirePermission permission="roles:view">
                      <RolesPage />
                    </RequirePermission>
                  </Suspense>
                }
              />
              <Route
                path="audit-log"
                element={
                  <Suspense fallback={<div className="loading" />}>
                    <RequirePermission permission="audit:view">
                      <AuditLogPage />
                    </RequirePermission>
                  </Suspense>
                }
              />
              <Route
                path="*"
                element={
                  <Suspense fallback={<div className="loading" />}>
                    <NotFoundPage />
                  </Suspense>
                }
              />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

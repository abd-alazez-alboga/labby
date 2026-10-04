import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AppLayout } from '../layout/AppLayout';

// Lazy-loaded routes: this is the pattern every future feature page follows.
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            index
            element={
              <Suspense fallback={<div className="loading" />}>
                <DashboardPage />
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
      </Routes>
    </BrowserRouter>
  );
}

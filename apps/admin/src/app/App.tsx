import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider } from '../auth/AuthContext';
import { RequireAuth } from '../auth/RequireAuth';
import { RequirePermission } from '../auth/RequirePermission';
import { AppLayout } from '../layout/AppLayout';
import { ToastProvider } from '../toast/ToastProvider';

// Lazy-loaded routes: this is the pattern every future feature page follows.
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const LoginPage = lazy(() => import('../pages/LoginPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));
const AdminsPage = lazy(() => import('../pages/AdminsPage'));
const RolesPage = lazy(() => import('../pages/RolesPage'));
const AuditLogPage = lazy(() => import('../pages/AuditLogPage'));
const RegionsPage = lazy(() => import('../pages/RegionsPage'));
const RegionDetailPage = lazy(() => import('../pages/RegionDetailPage'));
const RegionSurgePage = lazy(() => import('../pages/RegionSurgePage'));
const DriverApplicationsPage = lazy(() => import('../pages/DriverApplicationsPage'));
const DriverApplicationDetailPage = lazy(() => import('../pages/DriverApplicationDetailPage'));
const VehicleReviewsPage = lazy(() => import('../pages/VehicleReviewsPage'));
const VehicleReviewDetailPage = lazy(() => import('../pages/VehicleReviewDetailPage'));
const DocumentExpiriesPage = lazy(() => import('../pages/DocumentExpiriesPage'));
const DocumentRenewalDetailPage = lazy(() => import('../pages/DocumentRenewalDetailPage'));
const NotificationsPage = lazy(() => import('../pages/NotificationsPage'));
const NotificationPreferencesPage = lazy(() => import('../pages/NotificationPreferencesPage'));
const UsersPage = lazy(() => import('../pages/UsersPage'));
const DriversPage = lazy(() => import('../pages/DriversPage'));
const TransactionsPage = lazy(() => import('../pages/TransactionsPage'));
const UserWalletPage = lazy(() => import('../pages/UserWalletPage'));
const DriverLedgersPage = lazy(() => import('../pages/DriverLedgersPage'));
const DriverLedgerPage = lazy(() => import('../pages/DriverLedgerPage'));
const LiveOpsPage = lazy(() => import('../pages/LiveOpsPage'));
const RidesPage = lazy(() => import('../pages/RidesPage'));
const RideDetailPage = lazy(() => import('../pages/RideDetailPage'));
const ReportsPage = lazy(() => import('../pages/ReportsPage'));
const ReportDetailPage = lazy(() => import('../pages/ReportDetailPage'));
const FlagsPage = lazy(() => import('../pages/FlagsPage'));
const UserTrustPage = lazy(() => import('../pages/UserTrustPage'));
const PromosPage = lazy(() => import('../pages/PromosPage'));
const PromoCreatePage = lazy(() => import('../pages/PromoCreatePage'));
const ChallengesPage = lazy(() => import('../pages/ChallengesPage'));
const ChallengeDetailPage = lazy(() => import('../pages/ChallengeDetailPage'));
const SupportTicketsPage = lazy(() => import('../pages/SupportTicketsPage'));
const SupportTicketDetailPage = lazy(() => import('../pages/SupportTicketDetailPage'));
const TicketCategoriesPage = lazy(() => import('../pages/TicketCategoriesPage'));
const LostItemsPage = lazy(() => import('../pages/LostItemsPage'));
const LostItemCasePage = lazy(() => import('../pages/LostItemCasePage'));
const HelpCmsPage = lazy(() => import('../pages/HelpCmsPage'));
const HelpArticleEditorPage = lazy(() => import('../pages/HelpArticleEditorPage'));
const FeedbackPage = lazy(() => import('../pages/FeedbackPage'));

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
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
                  path="live-ops"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="rides:view">
                        <LiveOpsPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="rides"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="rides:view">
                        <RidesPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="rides/:rideId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="rides:view">
                        <RideDetailPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
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
                  path="regions"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="regions:view">
                        <RegionsPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="regions/:regionId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="regions:view">
                        <RegionDetailPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                {/* UC-A-09 live surge lives under Regions; its data is pricing:view. */}
                <Route
                  path="regions/:regionId/surge"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="regions:view">
                        <RequirePermission permission="pricing:view">
                          <RegionSurgePage />
                        </RequirePermission>
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="reports"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="reports:view">
                        <ReportsPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="reports/:reportId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="reports:view">
                        <ReportDetailPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                {/* M13 growth (UC-A-26/28): promos and challenges. */}
                <Route
                  path="promos"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="promos:view">
                        <PromosPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="promos/new"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="promos:manage">
                        <PromoCreatePage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="challenges"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="challenges:view">
                        <ChallengesPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="challenges/:challengeId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="challenges:view">
                        <ChallengeDetailPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                {/* M14 support & content (UC-A-21…25). */}
                <Route
                  path="support"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="support:view">
                        <SupportTicketsPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                {/* Before /support/:ticketId so "categories" never matches as an id. */}
                <Route
                  path="support/categories"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="content:view">
                        <TicketCategoriesPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="support/:ticketId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="support:view">
                        <SupportTicketDetailPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="lost-items"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="support:view">
                        <LostItemsPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="lost-items/:ticketId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="support:view">
                        <LostItemCasePage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="help-center"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="content:view">
                        <HelpCmsPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="help-center/articles/new"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="content:manage">
                        <HelpArticleEditorPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="help-center/articles/:helpArticleId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="content:view">
                        <HelpArticleEditorPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="feedback"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="support:view">
                        <FeedbackPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="flags"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="users:view">
                        <FlagsPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                {/* The Users section: trust tab (users:view) and wallet tab (wallets:view). */}
                <Route
                  path="users"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission={['users:view', 'wallets:view']}>
                        <UsersPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                {/* M15 lists: drivers (users:view) and transactions (wallets:view AND settlements:view). */}
                <Route
                  path="drivers"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="users:view">
                        <DriversPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="transactions"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="wallets:view">
                        <RequirePermission permission="settlements:view">
                          <TransactionsPage />
                        </RequirePermission>
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="users/:userId/trust"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="users:view">
                        <UserTrustPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="users/:userId/wallet"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="wallets:view">
                        <UserWalletPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="driver-ledgers"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="settlements:view">
                        <DriverLedgersPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="driver-ledgers/:driverUserId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="settlements:view">
                        <DriverLedgerPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="driver-applications"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="driver-review:view">
                        <DriverApplicationsPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="driver-applications/:applicationId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="driver-review:view">
                        <DriverApplicationDetailPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="vehicle-reviews"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="driver-review:view">
                        <VehicleReviewsPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="vehicle-reviews/:vehicleId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="driver-review:view">
                        <VehicleReviewDetailPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="document-expiries"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="driver-review:view">
                        <DocumentExpiriesPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                <Route
                  path="document-renewals/:documentId"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <RequirePermission permission="driver-review:view">
                        <DocumentRenewalDetailPage />
                      </RequirePermission>
                    </Suspense>
                  }
                />
                {/* Every admin has a notification center (NTF-03) — no permission gate. */}
                <Route
                  path="notifications"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <NotificationsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="notifications/preferences"
                  element={
                    <Suspense fallback={<div className="loading" />}>
                      <NotificationPreferencesPage />
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
      </ToastProvider>
    </BrowserRouter>
  );
}

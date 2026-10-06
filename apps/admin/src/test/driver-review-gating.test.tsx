import { screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import { REVIEWER, stubOnboardingRoutes, underReview, VIEWER } from './onboarding-fixtures';
import { adminUser, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

const NO_REVIEW = adminUser(['regions:view']);

/**
 * RBAC-03 UI side for M5: the review queues hide behind driver-review:view
 * (menu + routes), every decision control behind driver-review:decide —
 * the same codes the backend enforces on each endpoint.
 */
describe('driver review permission gating', () => {
  beforeAll(async () => {
    await import('../pages/DriverApplicationDetailPage');
    await import('../pages/VehicleReviewDetailPage');
    await import('../pages/DocumentRenewalDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
  });

  it('hides the three review entries without driver-review:view', async () => {
    seedStoredSession(sessionFor(NO_REVIEW));
    stubOnboardingRoutes(NO_REVIEW);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Regions' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Driver applications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vehicle switches' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Document expiry' })).not.toBeInTheDocument();
  });

  it('shows the three review entries with driver-review:view', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubOnboardingRoutes(VIEWER);
    renderShell();

    expect(await screen.findByRole('link', { name: 'Driver applications' })).toHaveAttribute(
      'href',
      '/driver-applications',
    );
    expect(screen.getByRole('link', { name: 'Vehicle switches' })).toHaveAttribute(
      'href',
      '/vehicle-reviews',
    );
    expect(screen.getByRole('link', { name: 'Document expiry' })).toHaveAttribute(
      'href',
      '/document-expiries',
    );
  });

  it.each([
    '/driver-applications',
    '/driver-applications/app-1',
    '/vehicle-reviews',
    '/vehicle-reviews/veh-new',
    '/document-expiries',
    '/document-renewals/doc-renew',
  ])('blocks a direct %s without driver-review:view and never calls the API', async (route) => {
    seedStoredSession(sessionFor(NO_REVIEW));
    const fetchMock = stubOnboardingRoutes(NO_REVIEW);
    window.history.pushState({}, '', route);
    renderShell();

    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    const adminCalls = fetchMock.mock.calls.filter(([input]) =>
      /\/api\/v1\/admin\/(driver-applications|vehicle-reviews|document-)/.test(String(input)),
    );
    expect(adminCalls).toHaveLength(0);
  });

  it('shows a view-only reviewer an application without any decision control', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubOnboardingRoutes(VIEWER);
    window.history.pushState({}, '', '/driver-applications/app-1');
    renderShell();

    expect(await screen.findByRole('heading', { name: 'Stage history' })).toBeInTheDocument();
    for (const name of ['Start review', 'Request changes', 'Approve', 'Reject']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: 'Decision' })).not.toBeInTheDocument();
  });

  it('shows a view-only reviewer a submitted application without Start review', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubOnboardingRoutes(VIEWER, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/driver-applications/app-1'
        ? jsonResponse(200, underReview({ status: 'submitted' }))
        : null,
    );
    window.history.pushState({}, '', '/driver-applications/app-1');
    renderShell();

    expect(await screen.findByRole('heading', { name: 'Stage history' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start review' })).not.toBeInTheDocument();
  });

  it('shows a view-only reviewer a vehicle switch without decision controls', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubOnboardingRoutes(VIEWER);
    window.history.pushState({}, '', '/vehicle-reviews/veh-new');
    renderShell();

    expect(
      await screen.findByRole('heading', { name: 'Vehicle switch — Rami Haddad' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve switch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject switch' })).not.toBeInTheDocument();
  });

  it('shows a view-only reviewer a renewal without decision controls', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubOnboardingRoutes(VIEWER);
    window.history.pushState({}, '', '/document-renewals/doc-renew');
    renderShell();

    expect(await screen.findByRole('heading', { name: 'Renewal — Insurance' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve renewal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject renewal' })).not.toBeInTheDocument();
  });

  it('gives a deciding reviewer the controls on the same page', async () => {
    seedStoredSession(sessionFor(REVIEWER));
    stubOnboardingRoutes(REVIEWER);
    window.history.pushState({}, '', '/document-renewals/doc-renew');
    renderShell();

    expect(await screen.findByRole('button', { name: 'Approve renewal' })).toBeInTheDocument();
  });

  it('renders the review screens in Arabic, right-to-left', async () => {
    await i18n.changeLanguage('ar');
    seedStoredSession(sessionFor(REVIEWER));
    stubOnboardingRoutes(REVIEWER);
    window.history.pushState({}, '', '/driver-applications/app-1');
    renderShell();

    expect(await screen.findByRole('heading', { name: 'سجل المراحل' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('link', { name: 'طلبات السائقين' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'طلب تعديلات' })).toBeInTheDocument();
    expect(screen.getAllByText('قيد المراجعة').length).toBeGreaterThan(0);
    // Phone numbers stay left-to-right inside the RTL page.
    expect(screen.getByText('+963933000111')).toHaveAttribute('dir', 'ltr');
  });
});

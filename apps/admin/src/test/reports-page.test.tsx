import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import { formatMoment } from '../pages/money/money-format';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';
import {
  hoursAgo,
  OMAR_ID,
  REPORT_1,
  REPORT_2,
  reportPage,
  reportSummary,
  REPORTS_VIEWER,
  stubTrustRoutes,
  TRUST_ADMIN,
  USERS_VIEWER,
} from './trust-fixtures';

const RESOLVED_AT = '2026-10-14T10:00:00Z';

/**
 * UC-A-17 step 1 against contract mocks (trust-v1.yaml): the oldest-first
 * queue per status tab, the open count on the tab and the sidebar badge,
 * paging, and the `reports:view` gating of the menu entry and the route.
 */
describe('reports queue', () => {
  beforeAll(async () => {
    await import('../pages/ReportsPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/reports');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubQueue(user = TRUST_ADMIN) {
    seedStoredSession(sessionFor(user));
    return stubTrustRoutes(user, (method, path, _init, url) => {
      if (method !== 'GET' || path !== '/api/v1/admin/reports') {
        return null;
      }
      const status = url?.searchParams.get('status');
      if (status === 'open' && url?.searchParams.get('size') === '1') {
        return jsonResponse(200, { ...reportPage([reportSummary()], 7), size: 1 });
      }
      if (status === 'substantiated') {
        return jsonResponse(
          200,
          reportPage([
            reportSummary({
              id: REPORT_2,
              status: 'substantiated',
              category: 'vehicle_damage',
              reporter: { userId: OMAR_ID, name: 'Omar Saleh', role: 'driver' },
              reported: { userId: 'u-rana', name: 'Rana Khoury', role: 'rider' },
              resolvedAt: RESOLVED_AT,
              photoCount: 2,
            }),
          ]),
        );
      }
      return jsonResponse(
        200,
        reportPage(
          [
            reportSummary(),
            reportSummary({
              id: REPORT_2,
              category: 'inappropriate_behavior',
              reported: { userId: OMAR_ID, name: 'Omar Saleh', role: 'driver' },
              reporter: { userId: 'u-lina', name: 'Lina Aziz', role: 'rider' },
              createdAt: hoursAgo(20),
              photoCount: 0,
            }),
          ],
          7,
        ),
      );
    });
  }

  it('lists open reports oldest first with parties, ride, evidence and waiting time', async () => {
    const fetchMock = stubQueue();
    renderShell();

    expect(await screen.findByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toHaveTextContent('Unsafe driving');
    expect(within(rows[0]).getByRole('link', { name: 'Samer Haddad' })).toHaveAttribute(
      'href',
      expect.stringContaining('/trust'),
    );
    expect(rows[0]).toHaveTextContent('driver');
    expect(rows[0]).toHaveTextContent('Rana Khoury');
    expect(within(rows[0]).getByRole('link', { name: 'R-AAAAAAAA' })).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('text · 1 photo');
    expect(rows[0]).toHaveTextContent('2 d');
    // The oldest report carries the single primary action.
    const first = within(rows[0]).getByRole('link', {
      name: 'Investigate Unsafe driving report against Samer Haddad',
    });
    expect(first).toHaveClass('btn--primary');
    expect(first).toHaveAttribute('href', `/reports/${REPORT_1}`);

    expect(rows[1]).toHaveTextContent('Inappropriate behavior');
    expect(rows[1]).toHaveTextContent('20 h');
    expect(rows[1]).toHaveTextContent('text');
    expect(within(rows[1]).getByRole('link', { name: /Investigate/ })).not.toHaveClass(
      'btn--primary',
    );

    // Count on the Open tab and the sidebar badge (from totalElements).
    expect(screen.getByRole('button', { name: 'Open · 7' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByRole('link', { name: 'Reports 7 open' })).toBeInTheDocument();
    expect(
      callsTo(fetchMock, '/api/v1/admin/reports?status=open&page=0&size=20').length,
    ).toBeGreaterThan(0);
  });

  it('switches to the substantiated tab and shows the resolution moment', async () => {
    const fetchMock = stubQueue();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText('Unsafe driving');
    await user.click(screen.getByRole('button', { name: 'Substantiated' }));

    expect(await screen.findByText('Damage to vehicle')).toBeInTheDocument();
    expect(window.location.search).toBe('?status=substantiated');
    expect(callsTo(fetchMock, 'status=substantiated').length).toBe(1);
    expect(screen.getByRole('columnheader', { name: 'Resolved' })).toBeInTheDocument();
    const row = screen.getAllByRole('row')[1];
    expect(row).toHaveTextContent(formatMoment(RESOLVED_AT, 'en'));
    expect(row).toHaveTextContent('text · 2 photos');
    // The accessible name starts with the visible text (WCAG 2.5.3).
    const view = within(row).getByRole('link', {
      name: 'View Damage to vehicle report against Rana Khoury',
    });
    expect(view).toHaveTextContent('View');
  });

  it('pages through a long queue', async () => {
    seedStoredSession(sessionFor(TRUST_ADMIN));
    const fetchMock = stubTrustRoutes(TRUST_ADMIN, (method, path, _init, url) =>
      method === 'GET' && path === '/api/v1/admin/reports' && url?.searchParams.get('size') === '20'
        ? jsonResponse(200, {
            ...reportPage([reportSummary()], 45),
            page: Number(url.searchParams.get('page')),
          })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'page=1&size=20')).toHaveLength(1);
  });

  it('hides the menu entry and refuses the route without reports:view', async () => {
    seedStoredSession(sessionFor(USERS_VIEWER));
    const fetchMock = stubTrustRoutes(USERS_VIEWER);
    renderShell();

    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Reports/ })).not.toBeInTheDocument();
    // users:view still reaches Users and the flags queue.
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Flagged accounts/ })).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/v1/admin/reports')).toHaveLength(0);
  });

  it('shows the menu entry with reports:view alone, without ride links', async () => {
    seedStoredSession(sessionFor(REPORTS_VIEWER));
    stubTrustRoutes(REPORTS_VIEWER, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/reports'
        ? jsonResponse(200, reportPage([reportSummary()]))
        : null,
    );
    renderShell();

    const row = (await screen.findAllByRole('row'))[1];
    expect(screen.getByRole('link', { name: 'Reports 1 open' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Flagged accounts/ })).not.toBeInTheDocument();
    // No users:view → names stay text; no rides:view → the ride ref stays text.
    expect(within(row).queryByRole('link', { name: 'Samer Haddad' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: 'R-AAAAAAAA' })).not.toBeInTheDocument();
    expect(row).toHaveTextContent('R-AAAAAAAA');
  });
});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountFlag } from '../api/trust';
import i18n from '../i18n/i18n';
import { bodyOf } from './onboarding-fixtures';
import { formatDay } from '../pages/money/money-format';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
} from './test-utils';
import {
  FLAG_1,
  FLAG_3,
  flagPage,
  LOW_RATING_FLAG,
  METRIC_FLAG,
  REPORT_1,
  REPORT_2,
  REPORT_THRESHOLD_FLAG,
  reportPage,
  reportSummary,
  SAMER_ID,
  stubTrustRoutes,
  TRUST_ADMIN,
  USERS_VIEWER,
} from './trust-fixtures';

const ALL_FLAGS: AccountFlag[] = [REPORT_THRESHOLD_FLAG, LOW_RATING_FLAG, METRIC_FLAG];

function stubFlags(user = TRUST_ADMIN, onResolve?: (flagId: string) => Response | null) {
  seedStoredSession(sessionFor(user));
  let closed: string | null = null;
  const fetchMock = stubTrustRoutes(user, (method, path, _init, url) => {
    if (method === 'POST' && path.endsWith('/resolve') && path.startsWith('/api/v1/admin/flags/')) {
      const flagId = path.split('/')[5];
      const response = onResolve?.(flagId) ?? null;
      if (response && response.ok) {
        closed = flagId;
      }
      return response;
    }
    if (method === 'GET' && path === '/api/v1/admin/flags') {
      const kind = url?.searchParams.get('kind');
      const items = ALL_FLAGS.filter((flag) => flag.id !== closed && (!kind || flag.kind === kind));
      return jsonResponse(200, flagPage(items));
    }
    return null;
  });
  return fetchMock;
}

/**
 * UC-A-16 against contract mocks (trust-v1.yaml): the open flags with the
 * triggering rule rendered per kind, the kind filter, the side panel's
 * evidence + profile link, closing a flag (mandatory note, 409 race) and
 * the read-only view without `users:suspend`.
 */
describe('flagged accounts', () => {
  beforeAll(async () => {
    await import('../pages/FlagsPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/flags');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists each kind with its triggering rule and selects the oldest', async () => {
    stubFlags();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Flagged accounts' }),
    ).toBeInTheDocument();
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Report threshold');
    expect(rows[0]).toHaveTextContent('3 substantiated in 90 days (limit 3)');
    expect(rows[1]).toHaveTextContent('Low rating');
    expect(rows[1]).toHaveTextContent('3.38 avg < 3.5 after 34 ratings');
    expect(rows[2]).toHaveTextContent('Metric warning');
    expect(rows[2]).toHaveTextContent('Acceptance 46% < 50% · 52 offers / 30 d');
    expect(rows[2]).toHaveTextContent('Omar Saleh');

    // The count rides on the active filter and the sidebar badge.
    expect(screen.getByRole('button', { name: 'All · 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      await screen.findByRole('link', { name: 'Flagged accounts 3 open' }),
    ).toBeInTheDocument();

    // Oldest selected: evidence = the substantiated reports, then the profile.
    const panel = screen.getByRole('complementary', { name: 'Selected flag' });
    expect(panel).toHaveTextContent('Samer Haddad · Report threshold');
    expect(within(panel).getByRole('link', { name: 'Report 11111111' })).toHaveAttribute(
      'href',
      `/reports/${REPORT_1}`,
    );
    expect(within(panel).getByRole('link', { name: 'Open profile to suspend' })).toHaveAttribute(
      'href',
      `/users/${SAMER_ID}/trust`,
    );

    // Selecting another row moves the panel.
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Select Metric warning flag of Omar Saleh' }),
    );
    expect(screen.getByRole('complementary', { name: 'Selected flag' })).toHaveTextContent(
      'Omar Saleh · Metric warning',
    );
    expect(rows[2]).toHaveClass('table__row--selected');
  });

  it('names the threshold evidence by category and date (AdminFlags, I85)', async () => {
    const reportsViewer = adminUser(['users:view', 'reports:view']);
    seedStoredSession(sessionFor(reportsViewer));
    const created = '2026-10-02T10:00:00Z';
    const fetchMock = stubTrustRoutes(reportsViewer, (method, path, _init, url) => {
      if (method === 'GET' && path === '/api/v1/admin/flags') {
        return jsonResponse(200, flagPage([REPORT_THRESHOLD_FLAG]));
      }
      if (method === 'GET' && path === '/api/v1/admin/reports') {
        return url?.searchParams.get('status') === 'substantiated' &&
          url.searchParams.get('reportedUserId') === SAMER_ID
          ? jsonResponse(
              200,
              reportPage([
                reportSummary({ id: REPORT_1, status: 'substantiated', createdAt: created }),
              ]),
            )
          : jsonResponse(200, reportPage([]));
      }
      return null;
    });
    renderShell();

    const label = `Unsafe driving · ${formatDay(created, 'en')}`;
    const link = await screen.findByRole('link', { name: label });
    expect(link).toHaveAttribute('href', `/reports/${REPORT_1}`);
    // A report the lookup did not return keeps its ref.
    expect(
      screen.getByRole('link', { name: `Report ${REPORT_2.slice(0, 8).toUpperCase()}` }),
    ).toBeInTheDocument();
    expect(
      callsTo(fetchMock, '/api/v1/admin/reports').filter(([input]) =>
        String(input).includes('status=substantiated'),
      ),
    ).toHaveLength(1);
  });

  it('filters by kind through the list endpoint', async () => {
    const fetchMock = stubFlags();
    const user = userEvent.setup();
    renderShell();

    await screen.findAllByText('3 substantiated in 90 days (limit 3)');
    await user.click(screen.getByRole('button', { name: 'Low rating' }));

    expect(await screen.findByRole('button', { name: 'Low rating · 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(window.location.search).toBe('?kind=low_rating');
    expect(callsTo(fetchMock, 'status=open&kind=low_rating&page=0&size=20')).toHaveLength(1);
  });

  it('closes a flag as actioned with the mandatory note', async () => {
    const fetchMock = stubFlags(TRUST_ADMIN, (flagId) =>
      jsonResponse(200, { ...REPORT_THRESHOLD_FLAG, id: flagId, status: 'actioned' }),
    );
    const user = userEvent.setup();
    renderShell();

    await screen.findAllByText('3 substantiated in 90 days (limit 3)');
    await user.click(screen.getByRole('button', { name: 'Mark actioned' }));
    expect(await screen.findByText('Write a note before closing the flag.')).toBeInTheDocument();
    expect(callsTo(fetchMock, '/resolve')).toHaveLength(0);

    await user.type(
      screen.getByLabelText('Close the flag · note required'),
      'Called the driver, warned about speeding.',
    );
    await user.click(screen.getByRole('button', { name: 'Mark actioned' }));

    expect(await screen.findByText('Flag marked actioned.')).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `/api/v1/admin/flags/${FLAG_1}/resolve`)).toEqual({
      resolution: 'actioned',
      note: 'Called the driver, warned about speeding.',
    });
    // The closed flag leaves the queue; the next oldest is selected.
    expect(await screen.findAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('complementary', { name: 'Selected flag' })).toHaveTextContent(
      'Samer Haddad · Low rating',
    );
  });

  it('dismisses a flag and surfaces the 409 race', async () => {
    const fetchMock = stubFlags(TRUST_ADMIN, (flagId) =>
      flagId === FLAG_3
        ? jsonResponse(200, { ...METRIC_FLAG, status: 'dismissed' })
        : jsonResponse(409, { status: 409, message: 'Flag closed', code: 'already_resolved' }),
    );
    const user = userEvent.setup();
    renderShell();

    // First, the race on the selected (oldest) flag.
    await user.type(await screen.findByLabelText('Close the flag · note required'), 'Duplicate');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(
      await screen.findByText('Another admin already closed this flag. The list is refreshed.'),
    ).toBeInTheDocument();

    // Then a successful dismiss of the metric warning.
    await user.click(
      screen.getByRole('button', { name: 'Select Metric warning flag of Omar Saleh' }),
    );
    await user.type(screen.getByLabelText('Close the flag · note required'), 'Peak-hour outlier');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText('Flag dismissed.')).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', `/api/v1/admin/flags/${FLAG_3}/resolve`)).toEqual({
      resolution: 'dismissed',
      note: 'Peak-hour outlier',
    });
  });

  it('is read-only without users:suspend', async () => {
    stubFlags(USERS_VIEWER);
    renderShell();

    const panel = await screen.findByRole('complementary', { name: 'Selected flag' });
    expect(within(panel).getByRole('link', { name: 'Open profile' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Close the flag · note required')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark actioned' })).not.toBeInTheDocument();
    // No reports:view → the evidence reports are plain references.
    expect(within(panel).queryByRole('link', { name: 'Report 11111111' })).not.toBeInTheDocument();
    expect(panel).toHaveTextContent('Report 11111111');
  });
});

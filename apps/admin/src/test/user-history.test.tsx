import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminUserGamification, GamificationView } from '../api/growth';
import type { AuditLogEntry } from '../api/rbac';
import i18n from '../i18n/i18n';
import { adminRide } from './money-fixtures';
import { adminTicket, LOST_TICKET, TICKET_2 } from './support-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  type FetchRouteHandler,
} from './test-utils';
import { SAMER_ID, stubTrustRoutes, userTrust } from './trust-fixtures';

const RIDE_A = '8f2a1c09-0000-4000-8000-000000000001';
const RIDE_B = '0b93e5a1-0000-4000-8000-000000000002';
const HISTORY_ADMIN = adminUser(['users:view', 'rides:view', 'support:view', 'audit:view']);

const LADDER = [
  { level: 'bronze' as const, thresholdPoints: 0 },
  { level: 'silver' as const, thresholdPoints: 500 },
  { level: 'gold' as const, thresholdPoints: 2000 },
  { level: 'platinum' as const, thresholdPoints: 5000 },
];

function view(overrides: Partial<GamificationView> = {}): GamificationView {
  return {
    badges: [
      { badgeCode: 'ride_10', earned: true, awardedAt: '2026-09-02T10:00:00Z' },
      { badgeCode: 'ride_50', earned: false, awardedAt: null },
      { badgeCode: 'ride_100', earned: false, awardedAt: null },
      { badgeCode: 'first_shared_ride', earned: false, awardedAt: null },
      { badgeCode: 'first_referral', earned: false, awardedAt: null },
      { badgeCode: 'five_star_week', earned: false, awardedAt: null },
    ],
    level: 'silver',
    lifetime: 640,
    driverTrips: null,
    challengePoints: null,
    levels: LADDER,
    ...overrides,
  };
}

const GAMIFICATION: AdminUserGamification = {
  rider: view(),
  driver: view({ level: 'bronze', lifetime: 212, driverTrips: 212, challengePoints: 0 }),
};

function auditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'audit-1',
    actorId: 'admin-1',
    actorName: 'Lina Saleh',
    action: 'user.role_reactivate',
    targetType: 'user',
    targetId: SAMER_ID,
    before: { role: 'driver', state: 'suspended' },
    after: { role: 'driver', note: 'Second chance after coaching call.' },
    createdAt: '2026-10-16T11:20:00Z',
    ...overrides,
  };
}

interface Answers {
  rides?: Response;
  tickets?: Response;
  gamification?: Response;
  audit?: Response;
}

function stubHistory(user = HISTORY_ADMIN, answers: Answers = {}, extra?: FetchRouteHandler) {
  seedStoredSession(sessionFor(user));
  return stubTrustRoutes(user, (method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method !== 'GET') {
      return null;
    }
    if (path === `/api/v1/admin/users/${SAMER_ID}/trust`) {
      return jsonResponse(200, userTrust());
    }
    if (path === '/api/v1/admin/rides' && url?.searchParams.get('userId') === SAMER_ID) {
      return (
        answers.rides ??
        jsonResponse(200, {
          items: [
            adminRide({
              id: RIDE_A,
              requestedAt: '2026-10-19T18:42:00Z',
              total: 18500,
              riderUserId: 'someone-else',
              driverUserId: SAMER_ID,
            }),
            adminRide({
              id: RIDE_B,
              state: 'cancelled_by_rider',
              requestedAt: '2026-10-18T06:12:00Z',
              total: null,
              cancellationFee: 2000,
              riderUserId: SAMER_ID,
            }),
          ],
          page: 0,
          size: 10,
          totalItems: 143,
        })
      );
    }
    if (path === '/api/v1/admin/tickets' && url?.searchParams.get('userId') === SAMER_ID) {
      return (
        answers.tickets ??
        jsonResponse(200, {
          items: [
            adminTicket({ status: 'closed', updatedAt: '2026-10-02T09:00:00Z' }),
            adminTicket({
              ticketId: TICKET_2,
              status: 'in_progress',
              updatedAt: '2026-10-19T09:00:00Z',
              category: {
                ticketCategoryId: 'cat-app',
                name: { en: 'App problem', ar: 'مشكلة في التطبيق' },
                defaultPriority: 'normal',
                sortOrder: 1,
              },
            }),
            adminTicket({
              ticketId: LOST_TICKET,
              kind: 'lost_item',
              status: 'resolved',
              updatedAt: '2026-10-11T09:00:00Z',
              category: {
                ticketCategoryId: 'cat-lost',
                name: { en: 'Lost item', ar: 'غرض مفقود' },
                defaultPriority: 'normal',
                sortOrder: 2,
              },
            }),
          ],
          page: 0,
          size: 50,
          totalItems: 3,
        })
      );
    }
    if (path === `/api/v1/admin/users/${SAMER_ID}/gamification`) {
      return answers.gamification ?? jsonResponse(200, GAMIFICATION);
    }
    if (path === '/api/v1/admin/audit-log' && url?.searchParams.get('targetId') === SAMER_ID) {
      return (
        answers.audit ??
        jsonResponse(200, {
          items: [
            auditEntry(),
            auditEntry({
              id: 'audit-2',
              action: 'driver_application.approve',
              before: null,
              after: null,
              createdAt: '2026-09-02T10:15:00Z',
            }),
          ],
          page: 0,
          size: 10,
          totalItems: 2,
        })
      );
    }
    return null;
  });
}

function emptyPage(): Response {
  return jsonResponse(200, { items: [], page: 0, size: 10, totalItems: 0 });
}

/**
 * UC-A-13 / ADM-05 full history (M15 review H3; boards "Admin · User
 * history" EN + AR): latest rides with the "View all rides" deep link,
 * tickets re-sorted by last update and opening their detail, badges and
 * levels, the audit trail — each section only with its permission.
 */
describe('user history tab', () => {
  beforeAll(async () => {
    await import('../pages/UserHistoryPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/users/${SAMER_ID}/history`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows rides, tickets, badges and the audit trail', async () => {
    const fetchMock = stubHistory();
    renderShell();

    expect(await screen.findByRole('heading', { name: 'Samer Haddad' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute(
      'href',
      `/users/${SAMER_ID}/history`,
    );

    const rides = (await screen.findByRole('heading', { name: 'Rides' })).closest('section')!;
    expect(await within(rides).findByRole('link', { name: 'R-8F2A1C09' })).toHaveAttribute(
      'href',
      `/rides/${RIDE_A}`,
    );
    expect(within(rides).getByText('Latest 2 of 143')).toBeInTheDocument();
    const rows = within(rides).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Driver');
    expect(rows[1]).toHaveTextContent('Completed');
    expect(rows[1]).toHaveTextContent('SYP 18,500');
    expect(rows[2]).toHaveTextContent('Rider');
    expect(rows[2]).toHaveTextContent('Cancelled by rider');
    expect(rows[2]).toHaveTextContent('SYP 2,000 fee');
    expect(within(rides).getByRole('link', { name: 'View all rides' })).toHaveAttribute(
      'href',
      `/rides?q=${SAMER_ID}`,
    );
    const ridesUrl = new URL(String(callsTo(fetchMock, '/api/v1/admin/rides').at(-1)?.[0]));
    expect(ridesUrl.searchParams.get('size')).toBe('10');

    const tickets = screen.getByRole('heading', { name: 'Support tickets' }).closest('section')!;
    const ticketRows = await within(tickets).findAllByRole('row');
    // Newest update first, whatever the queue order.
    expect(ticketRows.slice(1).map((row) => row.textContent)).toEqual([
      expect.stringContaining('App problem'),
      expect.stringContaining('Lost item'),
      expect.stringContaining('Payments'),
    ]);
    expect(within(tickets).getByRole('link', { name: 'App problem' })).toHaveAttribute(
      'href',
      `/support/${TICKET_2}`,
    );
    expect(within(tickets).getByRole('link', { name: 'Lost item' })).toHaveAttribute(
      'href',
      `/lost-items/${LOST_TICKET}`,
    );
    expect(within(tickets).getByText('Total: 3')).toBeInTheDocument();
    const ticketsUrl = new URL(String(callsTo(fetchMock, '/api/v1/admin/tickets').at(-1)?.[0]));
    expect(ticketsUrl.searchParams.getAll('status')).toEqual([
      'open',
      'in_progress',
      'waiting_on_user',
      'resolved',
      'closed',
    ]);

    const badges = screen.getByRole('region', { name: 'Badges & level' });
    expect(await within(badges).findByText('Silver')).toBeInTheDocument();
    expect(within(badges).getByText('640 lifetime points')).toBeInTheDocument();
    expect(within(badges).getByText('Bronze')).toBeInTheDocument();
    expect(within(badges).getByText('212 trips + 0 challenge points')).toBeInTheDocument();
    const badgeList = within(badges).getByRole('list', { name: 'Badges' });
    expect(within(badgeList).getAllByRole('listitem')).toHaveLength(6);
    expect(within(badgeList).getByText('✓ 10 rides · Sep 2, 2026')).toBeInTheDocument();
    expect(within(badgeList).getByText('5-star week')).toBeInTheDocument();

    const audit = screen.getByRole('heading', { name: 'Audit trail' }).closest('section')!;
    const auditRows = await within(audit).findAllByRole('row');
    expect(auditRows[1]).toHaveTextContent('Lina Saleh');
    expect(auditRows[1]).toHaveTextContent('user.role_reactivate');
    expect(auditRows[1]).toHaveTextContent('Second chance after coaching call.');
    expect(auditRows[2]).toHaveTextContent('driver_application.approve');
    expect(auditRows[2]).toHaveTextContent('—');
  });

  it('shows each section empty state', async () => {
    stubHistory(HISTORY_ADMIN, {
      rides: emptyPage(),
      tickets: emptyPage(),
      audit: emptyPage(),
      gamification: jsonResponse(200, {
        rider: view({
          badges: view().badges.map((badge) => ({ ...badge, earned: false, awardedAt: null })),
          level: 'bronze',
          lifetime: 0,
        }),
        driver: null,
      }),
    });
    renderShell();

    expect(await screen.findByText('No rides yet, as rider or driver.')).toBeInTheDocument();
    expect(await screen.findByText('No support tickets from this user.')).toBeInTheDocument();
    expect(await screen.findByText('No badges earned yet.')).toBeInTheDocument();
    expect(await screen.findByText('No admin actions on this user.')).toBeInTheDocument();
    // A rider without the driver role: only the rider level.
    expect(screen.getByText('Rider level')).toBeInTheDocument();
    expect(screen.queryByText('Driver level')).not.toBeInTheDocument();
  });

  it('shows loading, then a retryable failure per section', async () => {
    let failAudit = true;
    stubHistory(HISTORY_ADMIN, {}, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/audit-log' && failAudit
        ? jsonResponse(503, { status: 503, message: 'down' })
        : null,
    );
    renderShell();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Samer Haddad' });
    const audit = screen.getByRole('heading', { name: 'Audit trail' }).closest('section')!;
    const alert = await within(audit).findByRole('alert');
    expect(alert).toHaveTextContent('This section could not be loaded.');
    // The other sections still load.
    expect(await screen.findByRole('link', { name: 'R-8F2A1C09' })).toBeInTheDocument();

    failAudit = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(audit).findAllByText('Lina Saleh')).toHaveLength(2);
  });

  it('shows a loading line while a section is in flight', async () => {
    stubHistory(HISTORY_ADMIN, {}, (method, path) =>
      method === 'GET' && path === `/api/v1/admin/users/${SAMER_ID}/gamification`
        ? (new Promise<Response>(() => undefined) as unknown as Response)
        : null,
    );
    renderShell();

    const badges = await screen.findByRole('region', { name: 'Badges & level' });
    expect(within(badges).getByText('Loading…')).toBeInTheDocument();
  });

  it('hides the sections the admin may not open and never calls their endpoints', async () => {
    const fetchMock = stubHistory(adminUser(['users:view']));
    renderShell();

    expect(await screen.findByText('Silver')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rides' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Support tickets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Audit trail' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/v1/admin/rides')).toHaveLength(0);
    expect(callsTo(fetchMock, '/api/v1/admin/tickets')).toHaveLength(0);
    expect(callsTo(fetchMock, '/api/v1/admin/audit-log')).toHaveLength(0);
  });

  it('renders right-to-left in Arabic with Western digits', async () => {
    await i18n.changeLanguage('ar');
    stubHistory();
    renderShell();

    expect(await screen.findByRole('link', { name: 'السجل' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByText('آخر 2 من 143')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'عرض كل الرحلات' })).toBeInTheDocument();
    expect(await screen.findByText('فضي')).toBeInTheDocument();
    expect(screen.getByText('212 رحلة + 0 نقاط من التحديات')).toBeInTheDocument();
    expect(screen.getByText('مشكلة في التطبيق')).toBeInTheDocument();
  });

  it('pluralises the level counts in English (1 trip, 1 point)', async () => {
    stubHistory(HISTORY_ADMIN, {
      gamification: jsonResponse(200, {
        rider: view({ lifetime: 1 }),
        driver: view({ level: 'bronze', lifetime: 1, driverTrips: 1, challengePoints: 1 }),
      }),
    });
    renderShell();

    const badges = await screen.findByRole('region', { name: 'Badges & level' });
    expect(await within(badges).findByText('1 lifetime point')).toBeInTheDocument();
    expect(within(badges).getByText('1 trip + 1 challenge point')).toBeInTheDocument();
  });

  it('pluralises the level counts in Arabic (3 trips take the 3-10 form)', async () => {
    await i18n.changeLanguage('ar');
    stubHistory(HISTORY_ADMIN, {
      gamification: jsonResponse(200, {
        rider: view({ lifetime: 2 }),
        driver: view({ level: 'bronze', lifetime: 3, driverTrips: 3, challengePoints: 1 }),
      }),
    });
    renderShell();

    expect(await screen.findByText('نقطتان مدى الحياة')).toBeInTheDocument();
    expect(screen.getByText('3 رحلات + نقطة واحدة من التحديات')).toBeInTheDocument();
  });

  it('does not claim "Latest" when the user has more tickets than one page', async () => {
    // The queue sorts by priority then age, so a 50-row page may miss the newest updates.
    stubHistory(HISTORY_ADMIN, {
      tickets: jsonResponse(200, {
        items: Array.from({ length: 50 }, (_, index) =>
          adminTicket({
            ticketId: `ticket-${index}`,
            updatedAt: `2026-10-${String((index % 19) + 1).padStart(2, '0')}T09:00:00Z`,
          }),
        ),
        page: 0,
        size: 50,
        totalItems: 75,
      }),
    });
    renderShell();

    await screen.findByRole('heading', { name: 'Samer Haddad' });
    const tickets = screen.getByRole('heading', { name: 'Support tickets' }).closest('section')!;
    expect(await within(tickets).findByText('Total: 75')).toBeInTheDocument();
    expect(within(tickets).queryByText(/^Latest/)).not.toBeInTheDocument();
    expect(within(tickets).getAllByRole('row')).toHaveLength(11);
  });
});

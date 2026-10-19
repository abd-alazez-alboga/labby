import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  adminTicket,
  LOST_TICKET,
  SAMIR_ID,
  stubSupportRoutes,
  SUPPORT_ADMIN,
  OUTSIDER,
  TICKET_1,
  TICKET_2,
  ticketPage,
} from './support-fixtures';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

/**
 * UC-A-21 step 1 against contract mocks (support-v1.yaml): the ticket queue
 * (server-sorted priority then age), the status chips and filters in the
 * URL, the KPI tiles, the sidebar badge, and the `support:view` gating of
 * the menu entry and the route.
 */
describe('support ticket queue', () => {
  beforeAll(async () => {
    await import('../pages/SupportTicketsPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/support');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubQueue(user = SUPPORT_ADMIN) {
    seedStoredSession(sessionFor(user));
    return stubSupportRoutes(user, (method, path, _init, url) => {
      if (method !== 'GET' || path !== '/api/v1/admin/tickets') {
        return null;
      }
      if (url?.searchParams.get('size') === '1') {
        // The KPI tiles and the sidebar badge: one count per query shape.
        if (url.searchParams.get('unassigned') === 'true') {
          return jsonResponse(200, { ...ticketPage([]), totalItems: 12 });
        }
        if (url.searchParams.getAll('status').join() === 'waiting_on_user') {
          return jsonResponse(200, { ...ticketPage([]), totalItems: 5 });
        }
        if (url.searchParams.get('priority') === 'urgent') {
          return jsonResponse(200, { ...ticketPage([]), totalItems: 2 });
        }
        return jsonResponse(200, { ...ticketPage([]), totalItems: 23 });
      }
      if (url?.searchParams.getAll('status').join() === 'resolved') {
        return jsonResponse(
          200,
          ticketPage([
            adminTicket({
              ticketId: TICKET_2,
              status: 'resolved',
              priority: 'low',
              description: 'Driver took a long route',
              assignee: null,
              waitingSince: null,
            }),
          ]),
        );
      }
      return jsonResponse(
        200,
        ticketPage(
          [
            adminTicket({
              priority: 'urgent',
              status: 'in_progress',
              description: 'SOS follow-up',
              ageSeconds: 4 * 3600,
            }),
            adminTicket({
              ticketId: LOST_TICKET,
              kind: 'lost_item',
              caseStatus: 'driver_contacted',
              status: 'in_progress',
              description: 'Lost item: black backpack',
              ageSeconds: 18 * 3600,
            }),
          ],
          23,
        ),
      );
    });
  }

  it('lists the queue with chips, assignee, age, KPIs and the sidebar badge', async () => {
    const fetchMock = stubQueue();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Support tickets' }),
    ).toBeInTheDocument();
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toHaveTextContent('SOS follow-up');
    expect(rows[0]).toHaveTextContent('Urgent');
    expect(rows[0]).toHaveTextContent('In progress');
    expect(rows[0]).toHaveTextContent('Samir A.');
    expect(rows[0]).toHaveTextContent('4 h');
    // The top row carries the one primary action; a plain ticket opens /support.
    const first = within(rows[0]).getByRole('link', { name: 'Open ticket: SOS follow-up' });
    expect(first).toHaveClass('btn--primary');
    expect(first).toHaveAttribute('href', `/support/${TICKET_1}`);

    // A lost-item row opens its case page instead.
    expect(
      within(rows[1]).getByRole('link', { name: 'Open ticket: Lost item: black backpack' }),
    ).toHaveAttribute('href', `/lost-items/${LOST_TICKET}`);

    // KPI tiles from the three count queries.
    expect(
      screen.getByText('Open · unassigned', { selector: '.kpi__label' }).nextSibling,
    ).toHaveTextContent('12');
    expect(
      screen.getByText('Waiting on user', { selector: '.kpi__label' }).nextSibling,
    ).toHaveTextContent('5');
    expect(
      screen.getByText('Urgent, not resolved', { selector: '.kpi__label' }).nextSibling,
    ).toHaveTextContent('2');

    // The default chip shows the queue total; the menu badge shows it too.
    expect(screen.getByRole('button', { name: 'Needs action · 23' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByRole('link', { name: 'Support 23 open' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'page=0&size=20').length).toBeGreaterThan(0);
    // "Manage categories" needs content:view, which this seat lacks.
    expect(screen.queryByRole('link', { name: 'Manage categories' })).not.toBeInTheDocument();
  });

  it('filters by one status chip and keeps it in the URL', async () => {
    const fetchMock = stubQueue();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText('SOS follow-up');
    await user.click(screen.getByRole('button', { name: 'Resolved' }));

    expect(await screen.findByText('Driver took a long route')).toBeInTheDocument();
    expect(window.location.search).toBe('?status=resolved');
    expect(callsTo(fetchMock, 'status=resolved&page=0&size=20')).toHaveLength(1);
  });

  it('filters by priority and assigned-to-me through the selects', async () => {
    const fetchMock = stubQueue();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText('SOS follow-up');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'urgent');
    expect(callsTo(fetchMock, 'priority=urgent&page=0&size=20').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Assignee' }), 'me');
    expect(callsTo(fetchMock, `assigneeUserId=${SUPPORT_ADMIN.id}`).length).toBeGreaterThan(0);
    // The signed-in admin's id, not Samir's fixture id.
    expect(SUPPORT_ADMIN.id).not.toBe(SAMIR_ID);
  });

  it('hides the menu entries and refuses the route without support:view', async () => {
    seedStoredSession(sessionFor(OUTSIDER));
    const fetchMock = stubSupportRoutes(OUTSIDER);
    renderShell();

    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Support/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Lost items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Help center' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/v1/admin/tickets')).toHaveLength(0);
  });
});

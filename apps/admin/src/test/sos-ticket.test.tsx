import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminSosEvent } from '../api/comms';
import type { TicketCategory } from '../api/support';
import i18n from '../i18n/i18n';
import { ACKNOWLEDGED_SOS, LIVE_OPS, OPEN_SOS, RIDE_DETAIL, SOS_RIDE_ID } from './comms-fixtures';
import { adminTicket, adminTicketDetail } from './support-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  stubFetchRoutes,
  type FetchRouteHandler,
} from './test-utils';

/**
 * V1 audit W16 (UC-A-20 step 3, support-v1 ruling 9; board V1FAdminSosTicket):
 * the SOS-linked support ticket from the live map's alert card and the ride
 * detail's SOS block — the open form for support:handle, then "View ticket".
 */

vi.mock('../pages/liveops/LiveOpsMap', () => ({
  LiveOpsMap: () => <div role="region" aria-label="map" />,
}));
vi.mock('../pages/rides/RideTraceMap', () => ({
  RideTraceMap: () => <div role="region" aria-label="trace" />,
}));

const HANDLER = adminUser(['rides:view', 'regions:view', 'support:view', 'support:handle']);
const VIEWER = adminUser(['rides:view', 'regions:view', 'support:view']);

const TICKET_ID = '3f9a21c0-0000-4000-8000-000000000009';
const SAFETY = 'dddd0000-0000-4000-8000-0000000000aa';
const PAYMENTS = 'dddd0000-0000-4000-8000-0000000000bb';
/** GET /support/ticket-categories: active, never the system Lost item one. */
const CATEGORIES: TicketCategory[] = [
  {
    ticketCategoryId: PAYMENTS,
    name: { en: 'Payments', ar: 'المدفوعات' },
    defaultPriority: 'normal',
    sortOrder: 2,
  },
  {
    ticketCategoryId: SAFETY,
    name: { en: 'Safety', ar: 'السلامة' },
    defaultPriority: 'high',
    sortOrder: 1,
  },
];

const SOS_PATH = '/api/v1/admin/sos-events';
const TICKET_PATH = `/api/v1/admin/sos-events/${OPEN_SOS.sosEventId}/ticket`;

function stub(user = HANDLER, sosItems: AdminSosEvent[] = [OPEN_SOS], extra?: FetchRouteHandler) {
  seedStoredSession(sessionFor(user));
  return stubFetchRoutes((method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === '/api/v1/users/me') {
      return jsonResponse(200, user);
    }
    if (method === 'GET' && path === '/api/v1/admin/regions') {
      return jsonResponse(200, [{ id: 'region-1', name: 'Damascus', state: 'active' }]);
    }
    if (method === 'GET' && path === '/api/v1/admin/regions/region-1/live-ops') {
      return jsonResponse(200, LIVE_OPS);
    }
    if (method === 'GET' && path === SOS_PATH) {
      return jsonResponse(200, { items: sosItems, nextCursor: null });
    }
    if (method === 'GET' && path === '/api/v1/support/ticket-categories') {
      return jsonResponse(200, CATEGORIES);
    }
    if (method === 'GET' && path === `/api/v1/admin/rides/${SOS_RIDE_ID}`) {
      return jsonResponse(200, RIDE_DETAIL);
    }
    if (method === 'GET' && path === `/api/v1/admin/tickets/${TICKET_ID}`) {
      return jsonResponse(200, adminTicketDetail({ ticketId: TICKET_ID, status: 'in_progress' }));
    }
    return null;
  });
}

function alertCard() {
  const panel = screen.getByRole('heading', { name: 'SOS alerts' }).closest('section')!;
  return within(panel).getAllByRole('listitem')[0];
}

describe('SOS-linked support ticket (V1 audit W16)', () => {
  beforeAll(async () => {
    await import('../pages/LiveOpsPage');
    await import('../pages/RideDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/live-ops');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the ticket from the alert card and then links to it', async () => {
    const fetchMock = stub(HANDLER, [OPEN_SOS], (method, path) =>
      method === 'POST' && path === TICKET_PATH
        ? jsonResponse(
            201,
            adminTicket({ ticketId: TICKET_ID, status: 'in_progress', priority: 'urgent' }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('heading', { name: 'SOS alerts' });
    const card = await within(
      screen.getByRole('heading', { name: 'SOS alerts' }).closest('section')!,
    ).findByRole('listitem');
    await user.click(within(card).getByRole('button', { name: 'Open support ticket' }));

    const form = await within(card).findByRole('form', { name: 'Open support ticket' });
    expect(
      within(form).getByText(
        'For rider Lina K., about this ride. It starts In progress and assigned to you; Lina K. is notified.',
      ),
    ).toBeInTheDocument();
    // Pickable categories in their order; priority starts at the category's default.
    const category = await within(form).findByLabelText('Category');
    expect(
      within(category)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Safety', 'Payments']);
    const priority = within(form).getByLabelText('Priority');
    expect(priority).toHaveValue('high');
    expect(within(priority).getByRole('option', { name: 'High · category default' })).toBeVisible();
    await user.selectOptions(priority, 'urgent');
    await user.type(within(form).getByLabelText('Description · required'), 'Called her: safe.');
    await user.click(within(form).getByRole('button', { name: 'Open ticket' }));

    const [call] = callsTo(fetchMock, TICKET_PATH);
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      categoryId: SAFETY,
      description: 'Called her: safe.',
      priority: 'urgent',
    });
    const link = await within(card).findByRole('link', { name: 'View ticket T-3F9A21C0' });
    expect(link).toHaveAttribute('href', `/support/${TICKET_ID}`);
    expect(within(card).getByText('In progress')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Open support ticket' })).toBeNull();
  });

  it('resets the priority to the newly picked category default', async () => {
    stub();
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('heading', { name: 'SOS alerts' });
    await user.click(await screen.findByRole('button', { name: 'Open support ticket' }));
    await user.selectOptions(await screen.findByLabelText('Category'), PAYMENTS);

    expect(screen.getByLabelText('Priority')).toHaveValue('normal');
  });

  it('shows "View ticket" for an alert that already has its ticket', async () => {
    stub(HANDLER, [{ ...ACKNOWLEDGED_SOS, ticketId: TICKET_ID }]);
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('heading', { name: 'SOS alerts' });
    await user.click(screen.getByRole('button', { name: 'Acknowledged' }));

    const link = await screen.findByRole('link', { name: 'View ticket T-3F9A21C0' });
    expect(link).toHaveAttribute('href', `/support/${TICKET_ID}`);
    expect(await within(alertCard()).findByText('In progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open support ticket' })).toBeNull();
  });

  it('turns a 409 ticket_already_linked into the winner’s ticket link', async () => {
    let posted = false;
    stub(HANDLER, [OPEN_SOS], (method, path) => {
      if (method === 'POST' && path === TICKET_PATH) {
        posted = true;
        return jsonResponse(409, {
          status: 409,
          code: 'ticket_already_linked',
          message: 'This SOS event already has its ticket',
        });
      }
      if (posted && method === 'GET' && path === SOS_PATH) {
        return jsonResponse(200, {
          items: [{ ...OPEN_SOS, ticketId: TICKET_ID }],
          nextCursor: null,
        });
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('heading', { name: 'SOS alerts' });
    await user.click(await screen.findByRole('button', { name: 'Open support ticket' }));
    await user.type(await screen.findByLabelText('Description · required'), 'Following up.');
    await user.click(screen.getByRole('button', { name: 'Open ticket' }));

    expect(
      await screen.findByText(
        'Another admin already opened a ticket for this SOS. Your description was not sent.',
      ),
    ).toHaveAttribute('role', 'alert');
    expect(await screen.findByRole('link', { name: 'View ticket T-3F9A21C0' })).toHaveAttribute(
      'href',
      `/support/${TICKET_ID}`,
    );
  });

  it('keeps the form open on an inactive category (other 409s)', async () => {
    stub(HANDLER, [OPEN_SOS], (method, path) =>
      method === 'POST' && path === TICKET_PATH
        ? jsonResponse(409, { status: 409, code: 'category_inactive', message: 'gone' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole('heading', { name: 'SOS alerts' });
    await user.click(await screen.findByRole('button', { name: 'Open support ticket' }));
    await user.type(await screen.findByLabelText('Description · required'), 'Following up.');
    await user.click(screen.getByRole('button', { name: 'Open ticket' }));

    expect(
      await screen.findByText(
        "That category can't be used for tickets any more. Pick another one.",
      ),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('form', { name: 'Open support ticket' })).toBeInTheDocument();
    expect(screen.getByLabelText('Description · required')).toHaveValue('Following up.');
  });

  it('offers no ticket form without support:handle', async () => {
    stub(VIEWER);
    renderShell();

    await screen.findByRole('heading', { name: 'SOS alerts' });
    await within(
      screen.getByRole('heading', { name: 'SOS alerts' }).closest('section')!,
    ).findByRole('listitem');
    expect(screen.queryByRole('button', { name: 'Open support ticket' })).toBeNull();
  });

  it('opens the same form from the ride detail SOS block', async () => {
    const fetchMock = stub(HANDLER, [OPEN_SOS], (method, path) =>
      method === 'POST' && path === TICKET_PATH
        ? jsonResponse(201, adminTicket({ ticketId: TICKET_ID, status: 'in_progress' }))
        : null,
    );
    window.history.pushState({}, '', `/rides/${SOS_RIDE_ID}`);
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Open support ticket' }));
    await user.type(await screen.findByLabelText('Description · required'), 'Route follow-up.');
    await user.click(screen.getByRole('button', { name: 'Open ticket' }));

    expect(callsTo(fetchMock, TICKET_PATH)).toHaveLength(1);
    expect(await screen.findByRole('link', { name: 'View ticket T-3F9A21C0' })).toBeVisible();
  });

  it('renders the form in Arabic', async () => {
    stub();
    await i18n.changeLanguage('ar');
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'فتح تذكرة دعم' }));
    const category = await screen.findByLabelText('الفئة');
    expect(within(category).getAllByRole('option')[0]).toHaveTextContent('السلامة');
    expect(screen.getByRole('option', { name: 'مرتفعة · افتراضية الفئة' })).toBeInTheDocument();
  });
});

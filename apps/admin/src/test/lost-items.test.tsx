import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaseStatus } from '../api/support';
import i18n from '../i18n/i18n';
import {
  adminTicket,
  LOST_TICKET,
  lostItemDetail,
  stubSupportRoutes,
  SUPPORT_ADMIN,
  SUPPORT_VIEWER,
  ticketPage,
} from './support-fixtures';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

/**
 * UC-A-22 against contract mocks: the lost-item queue with its case-status
 * chips, and the case page — report + photos, the read-only reopened ride
 * chat, the rider ticket thread, and the LOST-02 progression buttons that
 * mirror onto the ticket and the chat window.
 */
describe('lost-item queue', () => {
  beforeAll(async () => {
    await import('../pages/LostItemsPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/lost-items');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists open cases and filters by one case status', async () => {
    seedStoredSession(sessionFor(SUPPORT_ADMIN));
    const fetchMock = stubSupportRoutes(SUPPORT_ADMIN, (method, path, _init, url) => {
      if (method !== 'GET' || path !== '/api/v1/admin/lost-items') {
        return null;
      }
      if (url?.searchParams.get('caseStatus') === 'found') {
        return jsonResponse(
          200,
          ticketPage([
            adminTicket({
              ticketId: LOST_TICKET,
              kind: 'lost_item',
              caseStatus: 'found',
              status: 'in_progress',
              description: 'Phone in a grey case',
              user: { userId: 'u-hadi', name: 'Hadi N.', role: 'rider' },
            }),
          ]),
        );
      }
      return jsonResponse(
        200,
        ticketPage([
          adminTicket({
            ticketId: LOST_TICKET,
            kind: 'lost_item',
            caseStatus: 'driver_contacted',
            status: 'in_progress',
            description: 'Black backpack, laptop inside',
            user: { userId: 'u-rana', name: 'Rana K.', role: 'rider' },
            ageSeconds: 18 * 3600,
          }),
        ]),
      );
    });
    const user = userEvent.setup();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lost-item cases' }),
    ).toBeInTheDocument();
    const row = (await screen.findAllByRole('row'))[1];
    expect(row).toHaveTextContent('Black backpack, laptop inside');
    expect(row).toHaveTextContent('Rana K.');
    // The driver column comes from the ride's counterpart.
    expect(row).toHaveTextContent('Sami B.');
    expect(row).toHaveTextContent('Driver contacted');
    expect(row).toHaveTextContent('18 h');
    expect(
      within(row).getByRole('link', { name: 'Open ticket: Black backpack, laptop inside' }),
    ).toHaveAttribute('href', `/lost-items/${LOST_TICKET}`);

    await user.click(screen.getByRole('button', { name: 'Found' }));
    expect(await screen.findByText('Phone in a grey case')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'caseStatus=found')).toHaveLength(1);
  });
});

describe('lost-item case', () => {
  beforeAll(async () => {
    await import('../pages/LostItemCasePage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/lost-items/${LOST_TICKET}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCase(user = SUPPORT_ADMIN, detail = lostItemDetail()) {
    seedStoredSession(sessionFor(user));
    let current = detail;
    return {
      fetchMock: stubSupportRoutes(user, (method, path, init) => {
        if (method === 'GET' && path === `/api/v1/admin/tickets/${LOST_TICKET}`) {
          return jsonResponse(200, current);
        }
        if (method === 'POST' && path === `/api/v1/admin/lost-items/${LOST_TICKET}/case-status`) {
          const body = JSON.parse(String(init?.body)) as { caseStatus: CaseStatus };
          current = {
            ...current,
            caseStatus: body.caseStatus,
            status: body.caseStatus === 'closed' ? 'closed' : 'in_progress',
            lostItem: current.lostItem
              ? {
                  ...current.lostItem,
                  chatWindow: body.caseStatus === 'closed' ? 'read_only' : 'reopened',
                }
              : null,
          };
          return jsonResponse(200, current);
        }
        if (method === 'GET' && path === `/api/v1/admin/rides/${current.ride?.rideId}/chat`) {
          return jsonResponse(200, {
            rideId: current.ride?.rideId,
            windowState: current.lostItem?.chatWindow ?? 'read_only',
            openedAt: '2026-10-18T21:00:00Z',
            closedAt: null,
            items: [
              {
                messageId: 'c1',
                senderRole: 'rider',
                kind: 'text',
                body: 'I think I left my backpack on your back seat.',
                quickReply: null,
                sentAt: '2026-10-18T21:12:00Z',
              },
            ],
            nextCursor: null,
          });
        }
        return null;
      }),
      latest: () => current,
    };
  }

  it('shows the report, the read-only ride chat and the progression rail', async () => {
    stubCase();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Black backpack, laptop inside' }),
    ).toBeInTheDocument();
    // The reopened chat note and the chat log (read-only, from comms-v1).
    expect(screen.getByText(/ride chat is reopened while this case is open/)).toBeInTheDocument();
    expect(
      await screen.findByText('I think I left my backpack on your back seat.'),
    ).toBeInTheDocument();

    // driver_contacted allows exactly found / not_found.
    expect(screen.getByRole('button', { name: 'Mark found' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark returned' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close case' })).not.toBeInTheDocument();
    expect(screen.getByText(/ticket status mirrors the case/i)).toBeInTheDocument();
  });

  it('progresses the case and follows the machine to closure', async () => {
    const { fetchMock, latest } = stubCase();
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Mark found' }));
    expect(await screen.findByRole('button', { name: 'Mark returned' })).toBeInTheDocument();
    expect(latest().caseStatus).toBe('found');

    await user.click(screen.getByRole('button', { name: 'Mark returned' }));
    await user.click(await screen.findByRole('button', { name: 'Close case' }));

    expect(latest().caseStatus).toBe('closed');
    expect(latest().status).toBe('closed');
    expect(callsTo(fetchMock, `/admin/lost-items/${LOST_TICKET}/case-status`)).toHaveLength(3);
    // Closed: no further moves, the thread is read-only.
    expect(await screen.findByText(/closed — the thread is read-only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark found' })).not.toBeInTheDocument();
  });

  it('hides progression and the composer from a support viewer', async () => {
    stubCase(SUPPORT_VIEWER);
    renderShell();

    await screen.findByRole('heading', { level: 1, name: 'Black backpack, laptop inside' });
    expect(screen.queryByRole('button', { name: 'Mark found' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Reply' })).not.toBeInTheDocument();
  });
});

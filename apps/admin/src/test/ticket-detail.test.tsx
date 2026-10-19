import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import { rideRef } from '../pages/rides/ride-format';
import {
  adminTicketDetail,
  OMAR_ID,
  stubSupportRoutes,
  SUPPORT_ADMIN,
  SUPPORT_VIEWER,
  TICKET_1,
} from './support-fixtures';
import { ridePage, transactionPage, walletView } from './money-fixtures';
import {
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  TEST_USER,
} from './test-utils';

/**
 * UC-A-21 steps 2–4 against contract mocks: the thread with the event
 * history inline, the reply composer, the SUP-02 transition buttons, the
 * priority override, and the wallet-credit remedy deep link — with every
 * write behind `support:handle`.
 */
describe('ticket detail', () => {
  beforeAll(async () => {
    await import('../pages/SupportTicketDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/support/${TICKET_1}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDetail(
    user = SUPPORT_ADMIN,
    detail = adminTicketDetail(),
    assigneeRefusal: Response | null = null,
  ) {
    seedStoredSession(sessionFor(user));
    let current = detail;
    return {
      fetchMock: stubSupportRoutes(user, (method, path, init) => {
        if (method === 'POST' && path === `/api/v1/admin/tickets/${TICKET_1}/assignee`) {
          if (assigneeRefusal) {
            return assigneeRefusal;
          }
          const body = JSON.parse(String(init?.body)) as { assigneeUserId: string | null };
          current = {
            ...current,
            assignee: body.assigneeUserId ? { userId: body.assigneeUserId, name: user.name } : null,
          };
          return jsonResponse(200, current);
        }
        // The remedy deep link's destination (money-v1 wallet page).
        if (method === 'GET' && path === `/api/v1/admin/users/${OMAR_ID}/wallet`) {
          return jsonResponse(200, walletView());
        }
        if (method === 'GET' && path === `/api/v1/admin/users/${OMAR_ID}/wallet/transactions`) {
          return jsonResponse(200, transactionPage());
        }
        if (method === 'GET' && path === '/api/v1/admin/rides') {
          return jsonResponse(200, ridePage([]));
        }
        if (method === 'GET' && path === `/api/v1/admin/tickets/${TICKET_1}`) {
          return jsonResponse(200, current);
        }
        if (method === 'POST' && path === `/api/v1/admin/tickets/${TICKET_1}/messages`) {
          const body = JSON.parse(String(init?.body)) as { body: string };
          current = {
            ...current,
            status: 'in_progress',
            messages: [
              ...current.messages,
              {
                messageId: 'm-new',
                ticketId: TICKET_1,
                senderSide: 'support',
                senderName: 'Signed-in Admin',
                body: body.body,
                createdAt: '2026-10-19T10:00:00Z',
              },
            ],
          };
          return jsonResponse(201, current.messages[current.messages.length - 1]);
        }
        if (method === 'POST' && path === `/api/v1/admin/tickets/${TICKET_1}/status`) {
          const body = JSON.parse(String(init?.body)) as { status: string };
          current = { ...current, status: body.status as typeof current.status };
          return jsonResponse(200, current);
        }
        if (method === 'POST' && path === `/api/v1/admin/tickets/${TICKET_1}/priority`) {
          const body = JSON.parse(String(init?.body)) as { priority: string };
          current = { ...current, priority: body.priority as typeof current.priority };
          return jsonResponse(200, current);
        }
        if (method === 'GET' && path === '/api/v1/admin/admins') {
          return jsonResponse(403, { status: 403, message: 'forbidden' });
        }
        return null;
      }),
      latest: () => current,
    };
  }

  it('renders the thread with messages, events, status and the remedy link', async () => {
    stubDetail();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Charged cash after wallet payment' }),
    ).toBeInTheDocument();
    // Both bubbles and the inline event chip (status change, user notified).
    expect(
      screen.getByText('I paid from my wallet but the receipt also says I owe cash.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Could you send a photo of the receipt screen?')).toBeInTheDocument();
    expect(
      screen.getByText(/Status Waiting on user → In progress|Status In progress → Waiting on user/),
    ).toBeInTheDocument();
    // The handler sees the user's phone (contact-access rule).
    expect(screen.getByText('+963933000111')).toBeInTheDocument();

    // waiting_on_user allows exactly one transition: back to In progress.
    expect(screen.getByRole('button', { name: 'Move to In progress' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark resolved' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close ticket' })).not.toBeInTheDocument();

    // The remedy deep link opens the user's wallet (M8 grant flow).
    expect(screen.getByRole('link', { name: 'Grant wallet credit…' })).toHaveAttribute(
      'href',
      `/users/${OMAR_ID}/wallet`,
    );
  });

  it('moves the status per the state machine and refetches', async () => {
    const { fetchMock, latest } = stubDetail();
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Move to In progress' }));

    // From in_progress the machine offers waiting_on_user and resolved.
    expect(await screen.findByRole('button', { name: 'Set Waiting on user' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark resolved' })).toBeInTheDocument();
    expect(latest().status).toBe('in_progress');
    expect(callsTo(fetchMock, `/admin/tickets/${TICKET_1}/status`)).toHaveLength(1);
  });

  it('sends a reply and shows it in the thread', async () => {
    const { fetchMock } = stubDetail();
    const user = userEvent.setup();
    renderShell();

    const input = await screen.findByRole('textbox', { name: 'Reply' });
    await user.type(input, 'We checked the payment — refunding now.');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('We checked the payment — refunding now.')).toBeInTheDocument();
    expect(callsTo(fetchMock, `/admin/tickets/${TICKET_1}/messages`)).toHaveLength(1);
    expect(input).toHaveValue('');
  });

  it('overrides the priority through the select', async () => {
    const { fetchMock, latest } = stubDetail();
    const user = userEvent.setup();
    renderShell();

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Priority' }), 'urgent');

    expect(callsTo(fetchMock, `/admin/tickets/${TICKET_1}/priority`)).toHaveLength(1);
    expect(latest().priority).toBe('urgent');
  });

  it('assigns the ticket and unassigns it through the select', async () => {
    const { fetchMock, latest } = stubDetail();
    const user = userEvent.setup();
    renderShell();

    const select = await screen.findByRole('combobox', { name: 'Assignee' });
    expect(select).toHaveValue(latest().assignee?.userId);
    await user.selectOptions(select, 'Signed-in Admin (me)');

    await vi.waitFor(() => expect(latest().assignee?.userId).toBe(TEST_USER.id));
    const calls = callsTo(fetchMock, `/admin/tickets/${TICKET_1}/assignee`);
    expect(JSON.parse(String((calls[0][1] as RequestInit).body))).toEqual({
      assigneeUserId: TEST_USER.id,
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Assignee' }), 'Unassigned');
    await vi.waitFor(() => expect(latest().assignee).toBeNull());
    expect(
      JSON.parse(
        String(
          (callsTo(fetchMock, `/admin/tickets/${TICKET_1}/assignee`)[1][1] as RequestInit).body,
        ),
      ),
    ).toEqual({ assigneeUserId: null });
  });

  it('explains an assignee who cannot handle support (assignee_not_handler)', async () => {
    stubDetail(
      SUPPORT_ADMIN,
      adminTicketDetail(),
      jsonResponse(422, { status: 422, message: 'not a handler', code: 'assignee_not_handler' }),
    );
    const user = userEvent.setup();
    renderShell();

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Assignee' }),
      'Signed-in Admin (me)',
    );
    expect(await screen.findByText("That admin can't handle support tickets.")).toBeInTheDocument();
  });

  it('reloads and says so when an assignee change lost a race (409)', async () => {
    const { fetchMock } = stubDetail(
      SUPPORT_ADMIN,
      adminTicketDetail(),
      jsonResponse(409, { status: 409, message: 'stale', code: 'conflict' }),
    );
    const user = userEvent.setup();
    renderShell();

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Assignee' }),
      'Unassigned',
    );
    expect(
      await screen.findByText('The ticket changed in the meantime — showing the latest state.'),
    ).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            String(input).endsWith(`/admin/tickets/${TICKET_1}`) &&
            ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET',
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it("pre-fills the grant reason from the remedy link on the user's wallet", async () => {
    stubDetail();
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('link', { name: 'Grant wallet credit…' }));

    expect(
      await screen.findByRole('heading', { name: 'Grant credit / refund' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason/)).toHaveValue(
      `Support ticket ${rideRef(TICKET_1).replace('R-', 'T-')}`,
    );
  });

  it('shows no controls, composer or phone to a support viewer', async () => {
    stubDetail(SUPPORT_VIEWER, adminTicketDetail({ userPhone: null }));
    renderShell();

    await screen.findByRole('heading', { level: 1, name: 'Charged cash after wallet payment' });
    expect(screen.queryByRole('button', { name: 'Move to In progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Reply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Priority' })).not.toBeInTheDocument();
    expect(screen.queryByText('+963933000111')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Grant wallet credit…' })).not.toBeInTheDocument();
  });
});

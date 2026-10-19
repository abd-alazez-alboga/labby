import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminTicketCategory, PatchTicketCategoryRequest } from '../api/support';
import i18n from '../i18n/i18n';
import {
  CONTENT_ADMIN,
  CONTENT_VIEWER,
  stubSupportRoutes,
  SYSTEM_CATEGORY,
  ticketCategory,
} from './support-fixtures';
import {
  callsTo,
  emptyResponse,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
} from './test-utils';

/**
 * UC-A-24 against contract mocks: the category table (inactive + the locked
 * system "Lost item" row included), add / edit / deactivate / reactivate,
 * and the `content:manage` gating of every write.
 */
describe('ticket categories', () => {
  beforeAll(async () => {
    await import('../pages/TicketCategoriesPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/support/categories');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCategories(user = CONTENT_ADMIN, extra: AdminTicketCategory[] = []) {
    seedStoredSession(sessionFor(user));
    let categories: AdminTicketCategory[] = [
      ticketCategory(),
      SYSTEM_CATEGORY,
      ticketCategory({
        ticketCategoryId: 'cat-promos',
        nameEn: 'Promotions',
        nameAr: 'العروض',
        defaultPriority: 'low',
        active: false,
        ticketCount: 0,
      }),
      ...extra,
    ];
    return {
      fetchMock: stubSupportRoutes(user, (method, path, init) => {
        if (method === 'GET' && path === '/api/v1/admin/ticket-categories') {
          return jsonResponse(200, categories);
        }
        if (method === 'POST' && path === '/api/v1/admin/ticket-categories') {
          const body = JSON.parse(String(init?.body)) as {
            nameEn: string;
            nameAr: string;
            defaultPriority: AdminTicketCategory['defaultPriority'];
          };
          categories = [
            ...categories,
            ticketCategory({ ...body, ticketCategoryId: 'cat-new', ticketCount: 0 }),
          ];
          return jsonResponse(201, categories[categories.length - 1]);
        }
        const patched = /^\/api\/v1\/admin\/ticket-categories\/(.+)$/.exec(path);
        if (method === 'DELETE' && patched) {
          if (patched[1] === 'cat-raced') {
            return jsonResponse(409, { status: 409, message: 'in use', code: 'category_in_use' });
          }
          categories = categories.filter((category) => category.ticketCategoryId !== patched[1]);
          return emptyResponse();
        }
        if (method === 'PATCH' && patched) {
          if (patched[1] === SYSTEM_CATEGORY.ticketCategoryId) {
            return jsonResponse(409, { status: 409, message: 'system', code: 'system_category' });
          }
          const body = JSON.parse(String(init?.body)) as PatchTicketCategoryRequest;
          categories = categories.map((category) =>
            category.ticketCategoryId === patched[1] ? { ...category, ...body } : category,
          );
          return jsonResponse(
            200,
            categories.find((c) => c.ticketCategoryId === patched[1]),
          );
        }
        return null;
      }),
      latest: () => categories,
    };
  }

  it('lists every category and locks the system lost-item row', async () => {
    stubCategories();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ticket categories' }),
    ).toBeInTheDocument();
    await screen.findByText('Payments');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);

    expect(rows[0]).toHaveTextContent('Payments');
    expect(rows[0]).toHaveTextContent('المدفوعات');
    expect(rows[0]).toHaveTextContent('High');
    expect(rows[0]).toHaveTextContent('Active');
    expect(within(rows[0]).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();

    // The seeded system category: badge + note, no actions at all.
    expect(rows[1]).toHaveTextContent('Lost item');
    expect(rows[1]).toHaveTextContent('System');
    expect(rows[1]).toHaveTextContent(/can't be edited, deactivated or picked/);
    expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument();

    // A deactivated category only offers reactivation.
    expect(rows[2]).toHaveTextContent('Deactivated');
    expect(within(rows[2]).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(within(rows[2]).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('deactivates and reactivates through PATCH active', async () => {
    const { fetchMock, latest } = stubCategories();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText('Payments');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findAllByRole('button', { name: 'Reactivate' })).toHaveLength(2);
    expect(latest().find((c) => c.nameEn === 'Payments')?.active).toBe(false);

    await user.click(screen.getAllByRole('button', { name: 'Reactivate' })[1]);
    expect(latest().find((c) => c.nameEn === 'Promotions')?.active).toBe(true);
    expect(callsTo(fetchMock, '/admin/ticket-categories/').length).toBe(2);
  });

  it('adds a category with names and a default priority', async () => {
    const { latest } = stubCategories();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText('Payments');
    await user.click(screen.getByRole('button', { name: 'New category' }));
    await user.type(screen.getByRole('textbox', { name: 'Name · EN' }), 'Safety');
    await user.type(screen.getByRole('textbox', { name: 'Name · AR' }), 'السلامة');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default priority' }), 'urgent');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Safety')).toBeInTheDocument();
    expect(latest().find((c) => c.nameEn === 'Safety')?.defaultPriority).toBe('urgent');
  });

  it('deletes only unused, non-system categories after a confirm', async () => {
    const { fetchMock, latest } = stubCategories();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText('Payments');
    const rows = screen.getAllByRole('row').slice(1);
    // Used (7 tickets) and system rows never offer Delete.
    expect(within(rows[0]).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument();

    await user.click(within(rows[2]).getByRole('button', { name: 'Delete' }));
    expect(within(rows[2]).getByText('Delete this category?')).toBeInTheDocument();
    await user.click(within(rows[2]).getByRole('button', { name: 'Confirm' }));

    await vi.waitFor(() => expect(screen.queryByText('Promotions')).not.toBeInTheDocument());
    expect(latest().map((c) => c.nameEn)).toEqual(['Payments', 'Lost item']);
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).endsWith('/admin/ticket-categories/cat-promos') &&
          (init as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toHaveLength(1);
  });

  it('explains a 409 category_in_use on delete', async () => {
    stubCategories(CONTENT_ADMIN, [
      ticketCategory({
        ticketCategoryId: 'cat-raced',
        nameEn: 'Accounts',
        nameAr: 'الحسابات',
        ticketCount: 0,
      }),
    ]);
    const user = userEvent.setup();
    renderShell();

    await screen.findByText('Accounts');
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Accounts'))!;
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByText(
        "Tickets now use this category, so it can't be deleted — deactivate it instead.",
      ),
    ).toBeInTheDocument();
  });

  it('offers no writes with content:view alone', async () => {
    stubCategories(CONTENT_VIEWER);
    renderShell();

    await screen.findByText('Payments');
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

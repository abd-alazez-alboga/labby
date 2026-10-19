import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  ARTICLE_1,
  CONTENT_ADMIN,
  CONTENT_VIEWER,
  HELP_CAT_1,
  HELP_CAT_2,
  helpArticle,
  helpCategory,
  stubSupportRoutes,
  SUPPORT_VIEWER,
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
 * UC-A-23 steps 1–2 against contract mocks: the ordered category list with
 * counts and the hidden-while-empty note, ordering through PUT /order, the
 * article table with the translation-missing note, and the `content:view` /
 * `content:manage` gating.
 */
describe('help CMS', () => {
  beforeAll(async () => {
    await import('../pages/HelpCmsPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/help-center');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCms(user = CONTENT_ADMIN) {
    seedStoredSession(sessionFor(user));
    let categories = [
      helpCategory(),
      helpCategory({
        helpCategoryId: HELP_CAT_2,
        nameEn: 'Safety',
        nameAr: 'السلامة',
        sortOrder: 1,
        articleCount: 1,
        publishedCount: 0,
      }),
    ];
    return {
      fetchMock: stubSupportRoutes(user, (method, path, init, url) => {
        if (method === 'GET' && path === '/api/v1/admin/help/categories') {
          return jsonResponse(200, categories);
        }
        if (method === 'PUT' && path === '/api/v1/admin/help/categories/order') {
          const body = JSON.parse(String(init?.body)) as { ids: string[] };
          categories = body.ids.map((id, index) => ({
            ...categories.find((c) => c.helpCategoryId === id)!,
            sortOrder: index,
          }));
          return emptyResponse();
        }
        if (method === 'POST' && path === '/api/v1/admin/help/categories') {
          const body = JSON.parse(String(init?.body)) as { nameEn: string; nameAr: string };
          categories = [
            ...categories,
            helpCategory({
              helpCategoryId: 'new-cat',
              nameEn: body.nameEn,
              nameAr: body.nameAr,
              sortOrder: categories.length,
              articleCount: 0,
              publishedCount: 0,
            }),
          ];
          return jsonResponse(201, categories[categories.length - 1]);
        }
        if (method === 'GET' && path === '/api/v1/admin/help/articles') {
          if (url?.searchParams.get('categoryId') !== HELP_CAT_1) {
            return jsonResponse(200, []);
          }
          return jsonResponse(200, [
            helpArticle(),
            helpArticle({
              helpArticleId: 'a2',
              titleEn: 'What is a waiting charge?',
              titleAr: null,
              bodyAr: null,
              status: 'draft',
              publishedAt: null,
              missing: ['titleAr', 'bodyAr'],
              sortOrder: 1,
            }),
          ]);
        }
        return null;
      }),
      latest: () => categories,
    };
  }

  it('lists categories with counts and the selected category’s articles', async () => {
    stubCms();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Help center' }),
    ).toBeInTheDocument();
    // Counts: published + drafts, and the hidden-while-empty note (SUP-04).
    expect(await screen.findByText(/2 published · 1 draft/)).toBeInTheDocument();
    expect(
      screen.getByText(/0 published · 1 draft.*hidden in apps while empty/),
    ).toBeInTheDocument();

    // The first category is selected: its article table shows both statuses.
    expect(
      screen.getByRole('heading', { name: 'Payments & wallet · articles' }),
    ).toBeInTheDocument();
    await screen.findByText('How do I pay for a ride?');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('How do I pay for a ride?');
    expect(rows[0]).toHaveTextContent('Published');
    expect(rows[1]).toHaveTextContent('What is a waiting charge?');
    expect(rows[1]).toHaveTextContent('Draft');
    // The draft that can't publish names the missing texts.
    expect(rows[1]).toHaveTextContent('Missing before publish: title AR · body AR');
    expect(within(rows[0]).getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/help-center/articles/${ARTICLE_1}`,
    );
    expect(screen.getByRole('link', { name: 'New article' })).toHaveAttribute(
      'href',
      `/help-center/articles/new?categoryId=${HELP_CAT_1}`,
    );
  });

  it('reorders categories with the arrows (the complete new order)', async () => {
    const { fetchMock, latest } = stubCms();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText(/2 published/);
    await user.click(screen.getByRole('button', { name: 'Move Payments & wallet down' }));

    expect(callsTo(fetchMock, '/admin/help/categories/order')).toHaveLength(1);
    expect(latest().map((category) => category.nameEn)).toEqual(['Safety', 'Payments & wallet']);
  });

  it('adds a category with both names', async () => {
    const { fetchMock } = stubCms();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText(/2 published/);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(screen.getByRole('textbox', { name: 'Name · EN' }), 'Account');
    await user.type(screen.getByRole('textbox', { name: 'Name · AR' }), 'الحساب');
    await user.click(screen.getAllByRole('button', { name: 'Add' })[1]);

    expect(await screen.findByText(/Account · الحساب/)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/admin/help/categories')).not.toHaveLength(0);
  });

  it('is read-only for content:view alone', async () => {
    stubCms(CONTENT_VIEWER);
    renderShell();

    await screen.findByText(/2 published/);
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move .* down/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New article' })).not.toBeInTheDocument();
  });

  it('hides the menu entry and refuses the route without content:view', async () => {
    seedStoredSession(sessionFor(SUPPORT_VIEWER));
    const fetchMock = stubSupportRoutes(SUPPORT_VIEWER);
    renderShell();

    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Help center' })).not.toBeInTheDocument();
    // support:view still reaches the ticket queue.
    expect(screen.getByRole('link', { name: /^Support/ })).toBeInTheDocument();
    expect(callsTo(fetchMock, '/admin/help/categories')).toHaveLength(0);
  });
});

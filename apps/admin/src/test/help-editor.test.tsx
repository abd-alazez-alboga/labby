import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminHelpArticle } from '../api/support';
import i18n from '../i18n/i18n';
import {
  ARTICLE_1,
  CONTENT_ADMIN,
  HELP_CAT_1,
  helpArticle,
  helpCategory,
  stubSupportRoutes,
} from './support-fixtures';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

/** The server's `missing` rule, applied to a fixture article. */
function missing(article: AdminHelpArticle): AdminHelpArticle['missing'] {
  const result: AdminHelpArticle['missing'] = [];
  if (!article.titleEn?.trim()) result.push('titleEn');
  if (!article.titleAr?.trim()) result.push('titleAr');
  if (!article.bodyEn?.trim()) result.push('bodyEn');
  if (!article.bodyAr?.trim()) result.push('bodyAr');
  return result;
}

/**
 * UC-A-23 steps 3–4 + milestone AC against contract mocks: EN/AR side by
 * side, "Save draft" always allowed, "Publish" blocked while any of the four
 * texts is blank (and the server's 422 `translation_missing` surfaced),
 * publishing when complete, and unpublishing back to draft.
 */
describe('help article editor', () => {
  beforeAll(async () => {
    await import('../pages/HelpArticleEditorPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/help-center/articles/${ARTICLE_1}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubEditor(initial = helpArticle()) {
    seedStoredSession(sessionFor(CONTENT_ADMIN));
    let current = initial;
    return {
      fetchMock: stubSupportRoutes(CONTENT_ADMIN, (method, path, init) => {
        if (method === 'GET' && path === '/api/v1/admin/help/categories') {
          return jsonResponse(200, [helpCategory()]);
        }
        if (method === 'GET' && path === `/api/v1/admin/help/articles/${ARTICLE_1}`) {
          return jsonResponse(200, current);
        }
        if (method === 'PATCH' && path === `/api/v1/admin/help/articles/${ARTICLE_1}`) {
          const body = JSON.parse(String(init?.body)) as Partial<AdminHelpArticle>;
          current = { ...current, ...body };
          current = { ...current, missing: missing(current) };
          return jsonResponse(200, current);
        }
        if (method === 'POST' && path === `/api/v1/admin/help/articles/${ARTICLE_1}/publish`) {
          if (current.missing.length > 0) {
            return jsonResponse(422, {
              status: 422,
              message: 'translation missing',
              code: 'translation_missing',
              details: { missing: current.missing },
            });
          }
          current = { ...current, status: 'published', publishedAt: '2026-10-19T12:00:00Z' };
          return jsonResponse(200, current);
        }
        if (method === 'POST' && path === `/api/v1/admin/help/articles/${ARTICLE_1}/unpublish`) {
          current = { ...current, status: 'draft', publishedAt: null };
          return jsonResponse(200, current);
        }
        return null;
      }),
      latest: () => current,
    };
  }

  it('blocks publishing while a text is missing and names the fields', async () => {
    stubEditor(
      helpArticle({
        bodyAr: null,
        status: 'draft',
        publishedAt: null,
        missing: ['bodyAr'],
      }),
    );
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit article' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Publishing is blocked — still missing: body AR/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    // Save draft stays allowed.
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  it('saves the draft, then publishes once both languages are complete', async () => {
    const { fetchMock, latest } = stubEditor(
      helpArticle({ bodyAr: null, status: 'draft', publishedAt: null, missing: ['bodyAr'] }),
    );
    const user = userEvent.setup();
    renderShell();

    const bodyAr = await screen.findByRole('textbox', { name: 'Body · AR' });
    await user.type(bodyAr, 'يمكنك الدفع نقدًا أو من محفظتك.');
    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeEnabled();
    await user.click(publish);

    expect(await screen.findByText(/Published — the apps show it immediately/)).toBeInTheDocument();
    expect(latest().status).toBe('published');
    // The publish saves the on-screen texts first, then flips the status.
    expect(callsTo(fetchMock, `/admin/help/articles/${ARTICLE_1}/publish`)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
  });

  it('surfaces the server 422 translation_missing on publish', async () => {
    // The client thinks it is complete, but the server still refuses (e.g. a
    // whitespace-only body after trimming).
    seedStoredSession(sessionFor(CONTENT_ADMIN));
    const article = helpArticle({ status: 'draft', publishedAt: null, missing: [] });
    stubSupportRoutes(CONTENT_ADMIN, (method, path) => {
      if (method === 'GET' && path === '/api/v1/admin/help/categories') {
        return jsonResponse(200, [helpCategory()]);
      }
      if (method === 'GET' && path === `/api/v1/admin/help/articles/${ARTICLE_1}`) {
        return jsonResponse(200, article);
      }
      if (method === 'PATCH' && path === `/api/v1/admin/help/articles/${ARTICLE_1}`) {
        return jsonResponse(200, article);
      }
      if (method === 'POST' && path === `/api/v1/admin/help/articles/${ARTICLE_1}/publish`) {
        return jsonResponse(422, {
          status: 422,
          message: 'translation missing',
          code: 'translation_missing',
          details: { missing: ['bodyAr'] },
        });
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(
      await screen.findByText('Publishing refused: a text is still missing in one language.'),
    ).toBeInTheDocument();
  });

  it('keeps the created draft when its first publish fails, so a retry reuses it', async () => {
    seedStoredSession(sessionFor(CONTENT_ADMIN));
    const NEW_ID = 'ffff0000-0000-4000-8000-0000000000aa';
    let current: AdminHelpArticle | null = null;
    let publishAttempts = 0;
    const fetchMock = stubSupportRoutes(CONTENT_ADMIN, (method, path, init) => {
      if (method === 'GET' && path === '/api/v1/admin/help/categories') {
        return jsonResponse(200, [helpCategory()]);
      }
      if (method === 'POST' && path === '/api/v1/admin/help/articles') {
        const body = JSON.parse(String(init?.body)) as Partial<AdminHelpArticle>;
        current = helpArticle({
          ...body,
          helpArticleId: NEW_ID,
          status: 'draft',
          publishedAt: null,
        });
        return jsonResponse(201, current);
      }
      if (method === 'GET' && path === `/api/v1/admin/help/articles/${NEW_ID}`) {
        return jsonResponse(200, current);
      }
      if (method === 'PATCH' && path === `/api/v1/admin/help/articles/${NEW_ID}`) {
        const body = JSON.parse(String(init?.body)) as Partial<AdminHelpArticle>;
        current = { ...current!, ...body };
        return jsonResponse(200, current);
      }
      if (method === 'POST' && path === `/api/v1/admin/help/articles/${NEW_ID}/publish`) {
        publishAttempts += 1;
        if (publishAttempts === 1) {
          return jsonResponse(422, {
            status: 422,
            message: 'translation missing',
            code: 'translation_missing',
          });
        }
        current = { ...current!, status: 'published', publishedAt: '2026-10-19T12:00:00Z' };
        return jsonResponse(200, current);
      }
      return null;
    });
    window.history.pushState({}, '', `/help-center/articles/new?categoryId=${HELP_CAT_1}`);
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'Tipping');
    await user.type(
      screen.getByRole('textbox', { name: /^Body — plain text/ }),
      'You can tip in the app.',
    );
    await user.type(screen.getByRole('textbox', { name: 'Title · AR' }), 'الإكرامية');
    await user.type(screen.getByRole('textbox', { name: 'Body · AR' }), 'يمكنك إعطاء إكرامية.');
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByText('Publishing refused: a text is still missing in one language.'),
    ).toBeInTheDocument();
    // The editor moved to the saved draft's own URL.
    expect(window.location.pathname).toBe(`/help-center/articles/${NEW_ID}`);

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/Published — the apps show it immediately/)).toBeInTheDocument();

    // One create only; the retry patched and published the same id.
    const creates = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).endsWith('/api/v1/admin/help/articles') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(creates).toHaveLength(1);
    expect(callsTo(fetchMock, `/admin/help/articles/${NEW_ID}/publish`)).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).endsWith(`/admin/help/articles/${NEW_ID}`) &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toHaveLength(1);
  });

  it('shows a retry when the categories fail to load', async () => {
    seedStoredSession(sessionFor(CONTENT_ADMIN));
    let fail = true;
    stubSupportRoutes(CONTENT_ADMIN, (method, path) => {
      if (method === 'GET' && path === '/api/v1/admin/help/categories') {
        return fail
          ? jsonResponse(500, { status: 500, message: 'boom' })
          : jsonResponse(200, [helpCategory()]);
      }
      if (method === 'GET' && path === `/api/v1/admin/help/articles/${ARTICLE_1}`) {
        return jsonResponse(200, helpArticle());
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    await user.click(retry);
    expect(await screen.findByRole('option', { name: 'Payments & wallet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('unpublishes a published article back to draft', async () => {
    const { latest } = stubEditor();
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Unpublish' }));
    expect(await screen.findByText(/Back to draft/)).toBeInTheDocument();
    expect(latest().status).toBe('draft');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });
});

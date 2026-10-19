import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  FEEDBACK_1,
  feedbackEntry,
  feedbackPage,
  feedbackStats,
  stubSupportRoutes,
  SUPPORT_ADMIN,
  SUPPORT_VIEWER,
} from './support-fixtures';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

/**
 * UC-A-25 against contract mocks: the weekly counts-by-category trend from
 * the stats endpoint, the app / category / period filters, and the free-text
 * tags (replace-set PUT, trimmed and lower-cased) behind `support:handle`.
 */
describe('feedback browser', () => {
  beforeAll(async () => {
    await import('../pages/FeedbackPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/feedback');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFeedback(user = SUPPORT_ADMIN) {
    seedStoredSession(sessionFor(user));
    let entry = feedbackEntry();
    return {
      fetchMock: stubSupportRoutes(user, (method, path, init, url) => {
        if (method === 'GET' && path === '/api/v1/admin/feedback/stats') {
          return jsonResponse(200, feedbackStats());
        }
        if (method === 'GET' && path === '/api/v1/admin/feedback') {
          if (url?.searchParams.get('category') === 'pricing') {
            return jsonResponse(
              200,
              feedbackPage([
                feedbackEntry({
                  feedbackId: 'fb-2',
                  category: 'pricing',
                  body: 'Busy-time prices feel too high on short rides.',
                  tags: [],
                }),
              ]),
            );
          }
          return jsonResponse(200, feedbackPage([entry], 154));
        }
        if (method === 'PUT' && path === `/api/v1/admin/feedback/${FEEDBACK_1}/tags`) {
          const body = JSON.parse(String(init?.body)) as { tags: string[] };
          entry = { ...entry, tags: body.tags.map((tag) => tag.trim().toLowerCase()) };
          return jsonResponse(200, entry);
        }
        return null;
      }),
      latest: () => entry,
    };
  }

  it('shows the weekly trend grid and the entries with their tags', async () => {
    const { fetchMock } = stubFeedback();
    renderShell();

    expect(await screen.findByRole('heading', { level: 1, name: 'Feedback' })).toBeInTheDocument();

    // The trend: one row per catalog category, cells per week, totals.
    const trend = await screen.findByRole('table', { name: /Entries by category/ });
    expect(within(trend).getByText('App experience')).toBeInTheDocument();
    expect(within(trend).getByText('Feature request')).toBeInTheDocument();
    expect(within(trend).getByText('21')).toBeInTheDocument();
    // The stats call is weekly with from+to (contract requires both).
    const statsCall = callsTo(fetchMock, '/admin/feedback/stats');
    expect(statsCall).toHaveLength(1);
    expect(String(statsCall[0][0])).toContain('bucket=week');
    expect(String(statsCall[0][0])).toContain('from=');
    expect(String(statsCall[0][0])).toContain('to=');

    // The entries table.
    const row = screen.getAllByRole('row')[1];
    expect(row).toHaveTextContent('Rider');
    expect(row).toHaveTextContent('App experience');
    expect(row).toHaveTextContent('It would be great if the app remembered my last destinations.');
    expect(row).toHaveTextContent('saved-places');
  });

  it('filters by category and period through the URL', async () => {
    const { fetchMock } = stubFeedback();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText(/last destinations/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'pricing');
    expect(await screen.findByText(/Busy-time prices/)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'category=pricing').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'all');
    // "All time" drops the from bound entirely.
    const lastListCall = callsTo(fetchMock, '/api/v1/admin/feedback?').at(-1);
    expect(String(lastListCall?.[0])).not.toContain('from=');
  });

  it('adds a tag by replacing the entry’s tag set', async () => {
    const { fetchMock, latest } = stubFeedback();
    const user = userEvent.setup();
    renderShell();

    await screen.findByText(/last destinations/);
    await user.click(screen.getByRole('button', { name: '+ tag' }));
    await user.type(screen.getByRole('textbox', { name: 'New tag' }), 'Saved-Routes');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    // Lower-cased, existing tag kept (PUT replaces the whole set).
    expect(await screen.findByText('saved-routes')).toBeInTheDocument();
    expect(latest().tags).toEqual(['saved-places', 'saved-routes']);
    expect(callsTo(fetchMock, `/admin/feedback/${FEEDBACK_1}/tags`)).toHaveLength(1);
  });

  it('shows tags read-only without support:handle', async () => {
    stubFeedback(SUPPORT_VIEWER);
    renderShell();

    await screen.findByText(/last destinations/);
    expect(screen.getByText('saved-places')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ tag' })).not.toBeInTheDocument();
  });
});

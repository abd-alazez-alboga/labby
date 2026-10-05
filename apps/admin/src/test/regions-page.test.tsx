import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RegionSummary } from '../api/regions';
import i18n from '../i18n/i18n';
import { DRAFT_REGION, stubRegionRoutes } from './region-fixtures';
import {
  adminUser,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  stubFetchRoutes,
} from './test-utils';

// The detail page (navigation target) pulls in Leaflet — keep it out of jsdom.
vi.mock('../pages/regions/PolygonMapEditor', () => ({
  PolygonMapEditor: () => <div />,
}));

const SUMMARIES: RegionSummary[] = [
  { id: 'region-1', name: 'Damascus', state: 'active', currency: 'SYP' },
  { id: 'region-2', name: 'Homs', state: 'draft', currency: null },
];

const EDITOR = adminUser(['regions:view', 'regions:edit']);
const VIEWER = adminUser(['regions:view']);

describe('regions page', () => {
  beforeAll(async () => {
    // Warm the lazy route chunk once, so findBy timeouts measure rendering,
    // not the first import's transform cost.
    await import('../pages/RegionDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/regions');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists regions with state and currency', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubFetchRoutes((method, path) => {
      if (method === 'GET' && path === '/api/v1/users/me') {
        return jsonResponse(200, VIEWER);
      }
      if (method === 'GET' && path === '/api/v1/admin/regions') {
        return jsonResponse(200, SUMMARIES);
      }
      return null;
    });
    renderShell();

    const damascusRow = (await screen.findByText('Damascus')).closest('tr')!;
    expect(within(damascusRow).getByText('Active')).toBeInTheDocument();
    expect(within(damascusRow).getByText('SYP')).toBeInTheDocument();
    const homsRow = screen.getByText('Homs').closest('tr')!;
    expect(within(homsRow).getByText('Draft')).toBeInTheDocument();
  });

  it('creates a draft with only a name and lands on its detail page', async () => {
    seedStoredSession(sessionFor(EDITOR));
    const fetchMock = stubRegionRoutes(EDITOR, DRAFT_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions'
        ? jsonResponse(201, DRAFT_REGION)
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'New region' }));
    await user.type(screen.getByLabelText('Region name'), 'Damascus');
    await user.click(screen.getByRole('button', { name: 'Create region' }));

    // Only the name travels — the rest of the bundle is draft work (UC-A-05).
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ name: 'Damascus' });
    expect(await screen.findByRole('heading', { name: 'Damascus' })).toBeInTheDocument();
  });

  it('surfaces the duplicate-name conflict on create', async () => {
    seedStoredSession(sessionFor(EDITOR));
    stubRegionRoutes(EDITOR, DRAFT_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions'
        ? jsonResponse(409, { status: 409, message: 'duplicate' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'New region' }));
    await user.type(screen.getByLabelText('Region name'), 'Damascus');
    await user.click(screen.getByRole('button', { name: 'Create region' }));

    expect(await screen.findByText('A region with this name already exists.')).toBeInTheDocument();
  });

  it('navigates to the detail page from a region link', async () => {
    seedStoredSession(sessionFor(EDITOR));
    stubRegionRoutes(EDITOR);
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('link', { name: 'Damascus' }));

    expect(await screen.findByRole('heading', { name: 'Damascus' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Region configuration' })).toBeInTheDocument();
  });

  it('hides creation without regions:edit', async () => {
    seedStoredSession(sessionFor(VIEWER));
    stubFetchRoutes((method, path) => {
      if (method === 'GET' && path === '/api/v1/users/me') {
        return jsonResponse(200, VIEWER);
      }
      if (method === 'GET' && path === '/api/v1/admin/regions') {
        return jsonResponse(200, SUMMARIES);
      }
      return null;
    });
    renderShell();

    expect(await screen.findByText('Damascus')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New region' })).not.toBeInTheDocument();
  });
});

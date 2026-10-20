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

  it('offers the SRS §9 defaults in the bundle right after creating (I24, I26–I28)', async () => {
    seedStoredSession(sessionFor(EDITOR));
    stubRegionRoutes(EDITOR, DRAFT_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions'
        ? jsonResponse(201, DRAFT_REGION)
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'New region' }));
    await user.type(screen.getByLabelText('Region name'), 'Damascus');
    await user.click(screen.getByRole('button', { name: 'Create region' }));

    await screen.findByRole('heading', { name: 'Damascus' });
    expect(screen.getByText(/New region: unset values start at the SRS defaults/)).toBeVisible();
    const expected: [string, number][] = [
      ['Cancellation grace (min)', 2],
      ['Cancellation fee', 2],
      ['Wait grace (min)', 5],
      ['Wait rate (per min)', 0.25],
      ['Pickup-fee threshold (km)', 10],
      ['Pickup fee (per km)', 0.5],
      ['Rating reward amount', 20],
      ['Rating reward: min average rating', 4.8],
      ['Rating reward: min weekly trips', 30],
      ['Driver: min average rating', 3],
      ['Driver: min rated rides', 20],
      ['Rider: min average rating', 2.5],
      ['Rider: min rated rides', 10],
      ['Warn when acceptance below (%)', 50],
      ['Warn when cancellation above (%)', 15],
      ['Minimum sample', 20],
    ];
    for (const [label, value] of expected) {
      expect(screen.getByLabelText(label), label).toHaveValue(value);
    }
    expect(
      screen
        .getAllByLabelText('Weekly trips above')
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['0', '100', '200']);
    expect(
      screen.getAllByLabelText('Commission (%)').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['25', '20', '15']);
    expect(
      screen.getAllByLabelText('Trips per week').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['40', '60']);
    expect(
      screen.getAllByLabelText('Bonus amount').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['50', '100']);
    // Owner ruling 2026-10-20: the peak-hour bonus is not prefilled — it is set with its windows.
    expect(screen.getByLabelText(/^Bonus per trip/)).toHaveValue(null);
    expect(
      screen.getByText(/The peak-hour bonus starts empty: set it together with a peak window\./),
    ).toBeVisible();
  });

  it('never prefills an existing region opened from the list', async () => {
    seedStoredSession(sessionFor(EDITOR));
    stubRegionRoutes(EDITOR, DRAFT_REGION);
    window.history.pushState({}, '', '/regions/region-1');
    renderShell();

    await screen.findByRole('heading', { name: 'Damascus' });
    expect(screen.getByLabelText('Cancellation fee')).toHaveValue(null);
    expect(screen.queryByText(/New region: unset values start/)).toBeNull();
    expect(screen.queryAllByLabelText('Weekly trips above')).toHaveLength(0);
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

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SurgeState, SurgeZone } from '../api/regions';
import i18n from '../i18n/i18n';
import { formatClock, toSurgeOverlay } from '../pages/surge';
import { COMPLETE_REGION, ZONE_POLYGON, stubRegionRoutes } from './region-fixtures';
import {
  adminUser,
  callsTo,
  emptyResponse,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  type FetchRouteHandler,
} from './test-utils';

vi.mock('../pages/regions/PolygonMapEditor', () => ({
  PolygonMapEditor: () => <div />,
}));

const PRICING_EDITOR = adminUser(['regions:view', 'pricing:view', 'pricing:edit']);
const PRICING_VIEWER = adminUser(['regions:view', 'pricing:view']);
const REGIONS_ONLY = adminUser(['regions:view']);

const NEXT_CYCLE = new Date(Date.now() + 90_000).toISOString();
const COMPUTED_AT = new Date(Date.now() - 30_000).toISOString();
const SET_AT = new Date(Date.now() - 60_000).toISOString();

function zoneState(
  id: string,
  name: string,
  values: Partial<SurgeState['zones'][number]> = {},
): SurgeState['zones'][number] {
  return {
    id,
    name,
    polygon: ZONE_POLYGON,
    currentMultiplier: 1,
    computedMultiplier: 1,
    overrideMultiplier: null,
    overrideSetAt: null,
    overridePending: false,
    demandCount: 0,
    supplyCount: 3,
    computedAt: COMPUTED_AT,
    level: 0,
    effectiveCap: 2,
    ...values,
  };
}

/** The design's four Damascus zones, name-sorted like the backend. */
const SURGE_STATE: SurgeState = {
  regionId: 'region-1',
  surgeCap: 2,
  nextCycleAt: NEXT_CYCLE,
  zones: [
    zoneState('z-baramkeh', 'Baramkeh'),
    zoneState('z-kafr', 'Kafr Sousa', {
      overrideMultiplier: 1.8,
      overrideSetAt: SET_AT,
      overridePending: true,
      demandCount: 1,
      supplyCount: 4,
    }),
    zoneState('z-mazzeh', 'Mazzeh', {
      currentMultiplier: 2,
      computedMultiplier: 2,
      level: 3,
      demandCount: 11,
      supplyCount: 2,
    }),
    zoneState('z-old', 'Old City', {
      currentMultiplier: 1.5,
      computedMultiplier: 1.2,
      overrideMultiplier: 1.5,
      overrideSetAt: SET_AT,
      level: 2,
      demandCount: 5,
      supplyCount: 2,
    }),
  ],
};

const STEPS = [
  { ratio: 2, multiplier: 1.2 },
  { ratio: 3, multiplier: 1.5 },
  { ratio: 5, multiplier: 2 },
];

const ZONE_CONFIG: SurgeZone[] = SURGE_STATE.zones.map((zone) => ({
  id: zone.id,
  regionId: 'region-1',
  name: zone.name,
  polygon: zone.polygon,
  thresholdSteps: STEPS,
  multiplierCap: null,
  overrideMultiplier: zone.overrideMultiplier,
  overrideSetAt: zone.overrideSetAt,
}));

const STATE_PATH = '/api/v1/admin/regions/region-1/surge-state';

/** Strips the LTR isolates the UI wraps multipliers in, for plain-text asserts. */
function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/[\u2066-\u2069]/g, '');
}

function stubSurge(
  user = PRICING_EDITOR,
  {
    state = () => SURGE_STATE,
    zones = () => jsonResponse(200, ZONE_CONFIG),
    extra,
  }: {
    state?: () => SurgeState;
    zones?: () => Response;
    extra?: FetchRouteHandler;
  } = {},
) {
  seedStoredSession(sessionFor(user));
  return stubRegionRoutes(user, COMPLETE_REGION, (method, path, init) => {
    const handled = extra?.(method, path, init);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === STATE_PATH) {
      return jsonResponse(200, state());
    }
    if (method === 'GET' && path === '/api/v1/admin/regions/region-1/surge-zones') {
      return zones();
    }
    return null;
  });
}

async function zonesTable() {
  return (await screen.findByRole('heading', { name: 'Zones' })).closest('section')!;
}

function panel() {
  return screen.getByRole('complementary', { name: /^Surge override for/ });
}

describe('region surge page (UC-A-09)', () => {
  beforeAll(async () => {
    await import('../pages/RegionSurgePage');
    await import('../pages/RegionDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/regions/region-1/surge');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the tiles, the zone table and the pending override chip', async () => {
    stubSurge();
    renderShell();

    const table = await zonesTable();
    expect(screen.getByRole('heading', { level: 1, name: 'Surge zones' })).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Damascus' })).toHaveAttribute(
      'href',
      '/regions/region-1',
    );

    // Tiles: 2 of 4 surging (Mazzeh 2.0×, Old City 1.5×), next cycle, last run, cap.
    expect(screen.getByText('of 4').closest('.kpi')).toHaveTextContent('Zones surging2 of 4');
    expect(screen.getByText('Next cycle').closest('.kpi')).toHaveTextContent(
      `Next cycle${formatClock(NEXT_CYCLE, 'en')}Last run ${formatClock(COMPUTED_AT, 'en')}`,
    );
    expect(screen.getByText('Region cap').closest('.kpi')).toHaveTextContent('2.0×');

    const rows = within(table).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'ZoneNowAutomaticRequests / free driversManual override',
      'Baramkeh1.0×1.0×0 / 3Automatic',
      `Kafr Sousa1.0×1.0×1 / 41.8×applies at ${formatClock(NEXT_CYCLE, 'en')}`,
      'Mazzeh2.0×2.0×11 / 2Automatic',
      `Old City1.5×1.2×5 / 21.5×· set ${formatClock(SET_AT, 'en')}`,
    ]);
    // Now chips: solid at the cap, tinted while surging, plain at 1.0×.
    expect(rows[3].querySelector('.surge-now')).toHaveClass('surge-now--max');
    expect(rows[4].querySelector('.surge-now')).toHaveClass('surge-now--surging');
    expect(rows[1].querySelector('.surge-now')).toHaveClass('surge-now--none');

    // The footnote renders the region's shared threshold steps.
    expect(
      plain((await within(table).findByText(/requests per free driver/)).textContent),
    ).toContain(
      'Automatic steps: 2+ requests per free driver → 1.2×, 3+ → 1.5×, 5+ → 2.0×, capped at the zone and region cap.',
    );
  });

  it("judges 'max' by the zone's own cap, the same in the table and the overlay", async () => {
    // Old City: its own cap 1.5 is below the region cap 2.0, and it sits at 1.5.
    const capped: SurgeState = {
      ...SURGE_STATE,
      zones: SURGE_STATE.zones.map((zone) =>
        zone.id === 'z-old' ? { ...zone, effectiveCap: 1.5 } : zone,
      ),
    };
    stubSurge(PRICING_EDITOR, { state: () => capped });
    renderShell();

    const table = await zonesTable();
    const row = within(table).getAllByRole('row')[4];
    expect(row.querySelector('.surge-now')).toHaveClass('surge-now--max');
    expect(toSurgeOverlay(capped).find((zone) => zone.id === 'z-old')).toMatchObject({
      level: 2,
      band: 'max',
      strength: 1,
    });
    // The override panel checks against the same effective cap.
    await userEvent.setup().click(within(table).getByRole('button', { name: 'Old City' }));
    expect(plain(within(panel()).getByText(/^Now/).textContent)).toBe(
      'Now 1.5× · automatic 1.2× · cap 1.5×',
    );
  });

  it("shows 'Not updating' instead of 'Live' while refreshes fail", async () => {
    let reads = 0;
    stubSurge(PRICING_EDITOR, {
      extra: (method, path) => {
        if (method === 'GET' && path === STATE_PATH) {
          reads += 1;
          return reads === 1 ? jsonResponse(200, SURGE_STATE) : jsonResponse(500, {});
        }
        if (method === 'DELETE' && path.endsWith('/override')) {
          return emptyResponse(204);
        }
        return null;
      },
    });
    renderShell();
    const user = userEvent.setup();
    const table = await zonesTable();
    expect(screen.getByText('Live')).toBeInTheDocument();

    // The override change refetches; that read fails.
    await user.click(within(table).getByRole('button', { name: 'Old City' }));
    await user.click(within(panel()).getByRole('button', { name: 'Reset to automatic' }));

    expect(await screen.findByText('Not updating')).toBeInTheDocument();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByText(/refresh/i, { selector: '.banner' })).toBeInTheDocument();
  });

  it('falls back to the generic footnote when zones use different steps', async () => {
    stubSurge(PRICING_EDITOR, {
      zones: () =>
        jsonResponse(200, [
          ZONE_CONFIG[0],
          { ...ZONE_CONFIG[1], thresholdSteps: [{ ratio: 4, multiplier: 1.3 }] },
        ]),
    });
    renderShell();

    const table = await zonesTable();
    expect(
      await within(table).findByText(/the multiplier rises with the number of requests/),
    ).toBeInTheDocument();
  });

  it('selects the first zone by default and switches the panel on click', async () => {
    stubSurge();
    renderShell();
    const user = userEvent.setup();
    const table = await zonesTable();

    expect(within(panel()).getByRole('heading', { name: 'Baramkeh' })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Set override' })).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: 'Reset to automatic' })).toBeNull();

    await user.click(within(table).getByRole('button', { name: 'Old City' }));
    expect(within(table).getByRole('button', { name: 'Old City' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(panel()).getByRole('heading', { name: 'Old City' })).toBeInTheDocument();
    expect(plain(within(panel()).getByText(/^Now/).textContent)).toBe(
      'Now 1.5× · automatic 1.2× · cap 2.0×',
    );
    expect(within(panel()).getByLabelText('Manual multiplier')).toHaveValue('1.5');
    expect(within(panel()).getByRole('button', { name: 'Update override' })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Reset to automatic' })).toBeInTheDocument();
    expect(within(panel()).getByText(/audit-logged/)).toBeInTheDocument();

    // The pending zone explains when the change lands.
    await user.click(within(table).getByRole('button', { name: 'Kafr Sousa' }));
    expect(plain(within(panel()).getByRole('status').textContent)).toContain(
      `1.8× takes effect at the next cycle (${formatClock(NEXT_CYCLE, 'en')})`,
    );
  });

  it('sets an override with the typed multiplier, then refetches to show it pending', async () => {
    let current = SURGE_STATE;
    const fetchMock = stubSurge(PRICING_EDITOR, {
      state: () => current,
      extra: (method, path) => {
        if (method === 'PUT' && path === '/api/v1/admin/surge-zones/z-baramkeh/override') {
          current = {
            ...SURGE_STATE,
            zones: SURGE_STATE.zones.map((zone) =>
              zone.id === 'z-baramkeh'
                ? {
                    ...zone,
                    overrideMultiplier: 1.75,
                    overrideSetAt: SET_AT,
                    overridePending: true,
                  }
                : zone,
            ),
          };
          return jsonResponse(200, { ...ZONE_CONFIG[0], overrideMultiplier: 1.75 });
        }
        return null;
      },
    });
    renderShell();
    const user = userEvent.setup();
    const table = await zonesTable();

    await user.type(within(panel()).getByLabelText('Manual multiplier'), '1.75');
    await user.click(within(panel()).getByRole('button', { name: 'Set override' }));

    await waitFor(() =>
      expect(within(table).getAllByRole('row')[1].textContent).toBe(
        `Baramkeh1.0×1.0×0 / 31.75×applies at ${formatClock(NEXT_CYCLE, 'en')}`,
      ),
    );
    const [put] = callsTo(fetchMock, '/surge-zones/z-baramkeh/override');
    expect(put[1]?.method).toBe('PUT');
    expect(JSON.parse(String(put[1]?.body))).toEqual({ multiplier: 1.75 });
    expect(callsTo(fetchMock, STATE_PATH).length).toBe(2);
    expect(within(panel()).getByRole('button', { name: 'Update override' })).toBeInTheDocument();
  });

  it('validates the multiplier client-side (format, 1.0 … cap, 2 decimals)', async () => {
    const fetchMock = stubSurge();
    renderShell();
    const user = userEvent.setup();
    await zonesTable();
    const input = within(panel()).getByLabelText('Manual multiplier');
    const submit = within(panel()).getByRole('button', { name: 'Set override' });

    for (const [value, message] of [
      ['abc', 'Enter a multiplier like 1.5, with at most 2 decimals.'],
      ['1.234', 'Enter a multiplier like 1.5, with at most 2 decimals.'],
      ['-1.5', 'Enter a multiplier like 1.5, with at most 2 decimals.'],
      ['0.9', 'Enter a multiplier between 1.0× and the 2.0× cap.'],
      ['2.01', 'Enter a multiplier between 1.0× and the 2.0× cap.'],
    ]) {
      await user.clear(input);
      await user.type(input, value);
      await user.click(submit);
      expect(plain(within(panel()).getByRole('alert').textContent)).toBe(message);
    }
    expect(callsTo(fetchMock, '/override')).toHaveLength(0);
  });

  it('shows the backend cap when the override is above it (400 override_above_cap)', async () => {
    stubSurge(PRICING_EDITOR, {
      // The client checks the state's effective cap (2.0×); the backend's 400 wins.
      zones: () => jsonResponse(500, {}),
      extra: (method, path) =>
        method === 'PUT' && path.endsWith('/override')
          ? jsonResponse(400, {
              status: 400,
              message: "The override may not exceed the zone's surge cap of 1.80",
              code: 'override_above_cap',
              details: { cap: 1.8 },
            })
          : null,
    });
    renderShell();
    const user = userEvent.setup();
    await zonesTable();

    await user.type(within(panel()).getByLabelText('Manual multiplier'), '1.9');
    await user.click(within(panel()).getByRole('button', { name: 'Set override' }));

    expect(plain((await within(panel()).findByRole('alert')).textContent)).toBe(
      "The override can't exceed this zone's 1.8× cap.",
    );
  });

  it('shows the server message for other validation rejections', async () => {
    stubSurge(PRICING_EDITOR, {
      extra: (method, path) =>
        method === 'PUT' && path.endsWith('/override')
          ? jsonResponse(400, { status: 400, message: 'multiplier: must be at least 1.00' })
          : null,
    });
    renderShell();
    const user = userEvent.setup();
    await zonesTable();

    await user.type(within(panel()).getByLabelText('Manual multiplier'), '1.5');
    await user.click(within(panel()).getByRole('button', { name: 'Set override' }));

    const alert = await within(panel()).findByRole('alert');
    expect(alert).toHaveTextContent('The server rejected the multiplier.');
    expect(alert).toHaveTextContent('multiplier: must be at least 1.00');
  });

  it('resets a zone to automatic and refetches the state', async () => {
    const fetchMock = stubSurge(PRICING_EDITOR, {
      extra: (method, path) =>
        method === 'DELETE' && path === '/api/v1/admin/surge-zones/z-old/override'
          ? emptyResponse(204)
          : null,
    });
    renderShell();
    const user = userEvent.setup();
    const table = await zonesTable();

    await user.click(within(table).getByRole('button', { name: 'Old City' }));
    await user.click(within(panel()).getByRole('button', { name: 'Reset to automatic' }));

    await waitFor(() => expect(callsTo(fetchMock, STATE_PATH).length).toBe(2));
    const [reset] = callsTo(fetchMock, '/surge-zones/z-old/override');
    expect(reset[1]?.method).toBe('DELETE');
  });

  it('is read-only without pricing:edit', async () => {
    stubSurge(PRICING_VIEWER);
    renderShell();
    const user = userEvent.setup();
    const table = await zonesTable();

    await user.click(within(table).getByRole('button', { name: 'Old City' }));
    expect(within(panel()).queryByLabelText('Manual multiplier')).toBeNull();
    expect(within(panel()).queryByRole('button')).toBeNull();
    expect(within(panel()).getByText(/View only/)).toBeInTheDocument();
    expect(within(panel()).getByText('Manual override:').parentElement).toHaveTextContent(
      `1.5× · set ${formatClock(SET_AT, 'en')}`,
    );
  });

  it('gates the route on pricing:view', async () => {
    const fetchMock = stubSurge(REGIONS_ONLY);
    renderShell();

    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(callsTo(fetchMock, STATE_PATH)).toHaveLength(0);
  });

  it('is reachable from the region detail page with pricing:view', async () => {
    stubSurge(PRICING_VIEWER);
    window.history.pushState({}, '', '/regions/region-1');
    renderShell();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('link', { name: 'Live surge' }));
    expect(await screen.findByRole('heading', { name: 'Zones' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/regions/region-1/surge');
  });

  it('renders Arabic with Western digits and LTR multipliers', async () => {
    await i18n.changeLanguage('ar');
    stubSurge();
    renderShell();

    const table = (await screen.findByRole('heading', { name: 'المناطق' })).closest('section')!;
    const chip = within(table).getAllByText('2.0×')[0];
    expect(chip).toHaveAttribute('dir', 'ltr');
    expect(within(table).getByText('11 / 2')).toBeInTheDocument();
    expect(screen.getByText('من 4')).toBeInTheDocument();
  });
});

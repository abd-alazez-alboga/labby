import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeoJsonPolygon } from '../api/regions';
import type { PolygonMapEditorProps } from '../pages/regions/PolygonMapEditor';
import i18n from '../i18n/i18n';
import { formatMoment } from '../pages/money/money-format';
import { COMPLETE_REGION, SERVICE_TYPES, stubRegionRoutes } from './region-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
} from './test-utils';

/**
 * Review V1 W37 / W38: every regions-v1 409 code reads as its own localized
 * message (zone names and missing parts interpolated), and disabling a
 * service type that claimed scheduled rides still use asks before repeating
 * the call with `acknowledgeClaimedRides=true`.
 */

const mapMock = vi.hoisted(() => ({ nextPolygon: null as unknown }));

vi.mock('../pages/regions/PolygonMapEditor', () => ({
  PolygonMapEditor: ({ label, editable, onPolygonChange }: PolygonMapEditorProps) =>
    editable ? (
      <button
        type="button"
        onClick={() => onPolygonChange(mapMock.nextPolygon as GeoJsonPolygon | null)}
      >
        {`draw:${label}`}
      </button>
    ) : null,
}));

const FULL_ACCESS = adminUser([
  'regions:view',
  'regions:edit',
  'pricing:view',
  'pricing:edit',
  'rides:view',
]);

const ZONE_POLYGON: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [36.31, 33.51],
      [36.35, 33.51],
      [36.35, 33.55],
      [36.31, 33.51],
    ],
  ],
};

const CLAIMED_RIDE = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const CLAIMED_AT = '2026-10-24T07:30:00Z';

function conflict(code: string, details?: Record<string, unknown>) {
  return jsonResponse(409, { status: 409, message: 'conflict', code, details });
}

function saveConflict(code: string, details?: Record<string, unknown>) {
  seedStoredSession(sessionFor(FULL_ACCESS));
  return stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
    method === 'PUT' && path === '/api/v1/admin/regions/region-1' ? conflict(code, details) : null,
  );
}

async function sectionOf(name: string) {
  return (await screen.findByRole('heading', { name })).closest('section')!;
}

describe('region 409 codes (W37) and claimed scheduled rides (W38)', () => {
  beforeAll(async () => {
    await import('../pages/RegionDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/regions/region-1');
    mapMock.nextPolygon = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the surge zones a boundary edit would leave outside', async () => {
    saveConflict('zones_outside_boundary', { zoneNames: ['Mazzeh', 'Old City'] });
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Save bundle' }));

    expect(
      await screen.findByText(
        'The new boundary would leave these surge zones outside the region: Mazzeh and Old City. Move or delete them first.',
      ),
    ).toBeInTheDocument();
  });

  it('tells a boundary overlap apart from a duplicate name', async () => {
    saveConflict('boundary_overlap');
    const user = userEvent.setup();
    const { unmount } = renderShell();

    await user.click(await screen.findByRole('button', { name: 'Save bundle' }));
    expect(
      await screen.findByText(
        "The boundary overlaps another region. Redraw it so the regions don't overlap.",
      ),
    ).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();

    saveConflict('region_name_taken');
    renderShell();
    await user.click(await screen.findByRole('button', { name: 'Save bundle' }));
    expect(await screen.findByText('A region with this name already exists.')).toBeInTheDocument();
  });

  it('lists what an active region would lose, in the checklist wording', async () => {
    saveConflict('active_region_incomplete', { missing: ['currency', 'incentive values'] });
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Save bundle' }));

    expect(
      await screen.findByText(
        'An active region must keep its mandatory configuration. This save would remove: Currency and Incentive values.',
      ),
    ).toBeInTheDocument();
  });

  it('lists the missing parts of a refused activation', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions/region-1/activate'
        ? conflict('region_incomplete', { missing: ['boundary', 'surge cap'] })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Activate region' }));

    expect(
      await screen.findByText(
        'The server refused activation — still missing: Boundary polygon and Surge cap.',
      ),
    ).toBeInTheDocument();
  });

  it('reads the zone names in Arabic', async () => {
    saveConflict('zones_outside_boundary', { zoneNames: ['المزة', 'المدينة القديمة'] });
    await i18n.changeLanguage('ar');
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'حفظ الحزمة' }));

    const alert = await screen.findByText(/الحدود الجديدة ستترك مناطق التسعير الديناميكي هذه/);
    expect(alert).toHaveTextContent('المزة و');
    expect(alert).toHaveTextContent('المدينة القديمة');
  });

  it.each([
    ['surge_zone_name_taken', 'This zone name is already used in this region.'],
    [
      'zone_outside_boundary',
      "The zone's polygon lies outside the region boundary. Redraw it inside.",
    ],
    [
      'region_has_no_boundary',
      'This region has no boundary yet. Draw and save the boundary before adding zones.',
    ],
  ])('maps the surge-zone 409 %s', async (code, message) => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions/region-1/surge-zones'
        ? conflict(code)
        : null,
    );
    mapMock.nextPolygon = ZONE_POLYGON;
    const user = userEvent.setup();
    renderShell();

    const section = await sectionOf('Surge zones');
    await user.click(within(section).getByRole('button', { name: 'Add surge zone' }));
    await user.type(within(section).getByLabelText('Zone name'), 'Airport');
    await user.click(within(section).getByRole('button', { name: 'draw:Surge zone map' }));
    await user.click(within(section).getByRole('button', { name: 'Save zone' }));

    expect(await within(section).findByText(message)).toBeInTheDocument();
  });

  it('maps service_type_name_taken on create', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions/region-1/service-types'
        ? conflict('service_type_name_taken')
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const section = await sectionOf('Service types');
    await user.click(within(section).getByRole('button', { name: 'Add service type' }));
    await user.type(within(section).getByLabelText('English name'), 'Economy');
    await user.type(within(section).getByLabelText('Arabic name'), 'اقتصادي');
    await user.type(within(section).getByLabelText('Base fare'), '1');
    await user.type(within(section).getByLabelText('Per-km rate'), '1');
    await user.type(within(section).getByLabelText('Per-minute rate'), '1');
    await user.click(within(section).getByRole('button', { name: 'Save service type' }));

    expect(
      await within(section).findByText('This English name is already used in this region.'),
    ).toBeInTheDocument();
  });

  it('lists the claimed scheduled rides and disables anyway once acknowledged', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    let putCount = 0;
    const fetchMock = stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) => {
      if (method !== 'PUT' || path !== '/api/v1/admin/service-types/st-1') {
        return null;
      }
      putCount += 1;
      // The first PUT is held back; the acknowledged repeat goes through.
      return putCount > 1
        ? jsonResponse(200, { ...SERVICE_TYPES[0], enabled: false })
        : conflict('service_type_has_claimed_rides', {
            rides: [
              {
                rideId: CLAIMED_RIDE,
                scheduledAt: CLAIMED_AT,
                claimedDriverUserId: 'driver-1',
              },
            ],
          });
    });
    const user = userEvent.setup();
    renderShell();

    const section = await sectionOf('Service types');
    const economyRow = within(section).getByText('Economy').closest('tr')!;
    await user.click(within(economyRow).getByRole('button', { name: 'Disable' }));

    const dialog = await within(section).findByRole('alertdialog', {
      name: 'Claimed scheduled rides still use this type',
    });
    expect(dialog).toHaveTextContent(
      'These claimed scheduled rides use Economy. Resolve them first, or disable anyway — the claimed rides still run.',
    );
    expect(within(dialog).getByRole('link', { name: 'R-AAAAAAAA' })).toHaveAttribute(
      'href',
      `/rides/${CLAIMED_RIDE}`,
    );
    expect(dialog).toHaveTextContent(formatMoment(CLAIMED_AT, 'en'));
    // Nothing changed yet.
    expect(within(economyRow).getByText('Enabled')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Disable anyway' }));

    const puts = callsTo(fetchMock, '/api/v1/admin/service-types/st-1');
    expect(puts).toHaveLength(2);
    expect(String(puts[0][0])).not.toContain('acknowledgeClaimedRides');
    expect(String(puts[1][0])).toContain('?acknowledgeClaimedRides=true');
    expect(JSON.parse(String((puts[1][1] as RequestInit).body)).enabled).toBe(false);
    expect(await within(economyRow).findByText('Disabled')).toBeInTheDocument();
    expect(within(section).queryByRole('alertdialog')).toBeNull();
  });

  it('keeps the type enabled when the warning is cancelled', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    const fetchMock = stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
      method === 'PUT' && path === '/api/v1/admin/service-types/st-1'
        ? conflict('service_type_has_claimed_rides', {
            rides: [{ rideId: CLAIMED_RIDE, scheduledAt: CLAIMED_AT, claimedDriverUserId: null }],
          })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const section = await sectionOf('Service types');
    const economyRow = within(section).getByText('Economy').closest('tr')!;
    await user.click(within(economyRow).getByRole('button', { name: 'Disable' }));
    const dialog = await within(section).findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(within(section).queryByRole('alertdialog')).toBeNull();
    expect(callsTo(fetchMock, '/api/v1/admin/service-types/st-1')).toHaveLength(1);
    expect(within(economyRow).getByText('Enabled')).toBeInTheDocument();
  });
});

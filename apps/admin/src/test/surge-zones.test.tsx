import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeoJsonPolygon } from '../api/regions';
import type { PolygonMapEditorProps } from '../pages/regions/PolygonMapEditor';
import i18n from '../i18n/i18n';
import { COMPLETE_REGION, SURGE_ZONES, ZONE_POLYGON, stubRegionRoutes } from './region-fixtures';
import {
  adminUser,
  emptyResponse,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
} from './test-utils';

/** See region-detail-page.test.tsx — the same contract-GeoJSON map stub. */
const mapMock = vi.hoisted(() => ({ nextPolygon: null as unknown }));

vi.mock('../pages/regions/PolygonMapEditor', () => ({
  PolygonMapEditor: ({
    label,
    polygon,
    overlays,
    editable,
    onPolygonChange,
  }: PolygonMapEditorProps) => (
    <div>
      <span data-testid={`map-polygon:${label}`}>{JSON.stringify(polygon)}</span>
      <span data-testid={`map-overlays:${label}`}>{JSON.stringify(overlays ?? [])}</span>
      {editable ? (
        <button
          type="button"
          onClick={() => onPolygonChange(mapMock.nextPolygon as GeoJsonPolygon | null)}
        >
          {`draw:${label}`}
        </button>
      ) : null}
    </div>
  ),
}));

const PRICING_EDITOR = adminUser(['regions:view', 'pricing:view', 'pricing:edit']);

const NEW_POLYGON: GeoJsonPolygon = {
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

async function zonesSection() {
  return (await screen.findByRole('heading', { name: 'Surge zones' })).closest('section')!;
}

describe('surge zones editor', () => {
  beforeAll(async () => {
    // Warm the lazy route chunk once, so findBy timeouts measure rendering,
    // not the first import's transform cost.
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

  it('creates a zone from a drawn polygon with its threshold steps (UC-A-08)', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    const fetchMock = stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions/region-1/surge-zones'
        ? jsonResponse(201, {
            id: 'zone-2',
            regionId: 'region-1',
            name: 'Airport',
            polygon: NEW_POLYGON,
            thresholdSteps: [
              { ratio: 2, multiplier: 1.2 },
              { ratio: 3, multiplier: 1.5 },
            ],
            multiplierCap: null,
            overrideMultiplier: null,
            overrideSetAt: null,
          })
        : null,
    );
    const user = userEvent.setup();
    mapMock.nextPolygon = NEW_POLYGON;
    renderShell();

    const section = await zonesSection();
    await user.click(within(section).getByRole('button', { name: 'Add surge zone' }));
    await user.type(within(section).getByLabelText('Zone name'), 'Airport');
    await user.click(within(section).getByRole('button', { name: 'draw:Surge zone map' }));
    // I24: a new zone starts with the SRS §9 example steps (≥2→1.2, ≥3→1.5, ≥5→2.0), editable.
    const ratioInputs = within(section).getAllByLabelText('Demand/supply ratio ≥');
    const multiplierInputs = within(section).getAllByLabelText('Multiplier');
    expect(ratioInputs.map((input) => (input as HTMLInputElement).value)).toEqual(['2', '3', '5']);
    expect(multiplierInputs.map((input) => (input as HTMLInputElement).value)).toEqual([
      '1.2',
      '1.5',
      '2',
    ]);
    await user.click(within(section).getAllByRole('button', { name: 'Remove step' })[2]);
    await user.click(within(section).getByRole('button', { name: 'Save zone' }));

    expect(await within(section).findByText('Airport')).toBeInTheDocument();
    // The drawn [lng, lat] GeoJSON travels to the POST byte-identical.
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: 'Airport',
      polygon: NEW_POLYGON,
      thresholdSteps: [
        { ratio: 2, multiplier: 1.2 },
        { ratio: 3, multiplier: 1.5 },
      ],
      multiplierCap: null,
    });
  });

  it('round-trips a stored zone polygon back into the map and out unchanged on save', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    const fetchMock = stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION, (method, path) =>
      method === 'PUT' && path === '/api/v1/admin/surge-zones/zone-1'
        ? jsonResponse(200, SURGE_ZONES[0])
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const section = await zonesSection();
    await user.click(within(section).getByRole('button', { name: 'Edit' }));

    // GET -> map prop: exactly what the backend stored.
    const shown = within(section).getByTestId('map-polygon:Surge zone map');
    expect(JSON.parse(shown.textContent!)).toEqual(ZONE_POLYGON);
    // The boundary renders as dashed context under the editable zone.
    const overlays = JSON.parse(
      within(section).getByTestId('map-overlays:Surge zone map').textContent!,
    ) as { id: string }[];
    expect(overlays.map((overlay) => overlay.id)).toEqual(['boundary']);

    // Save without redrawing -> PUT carries the identical polygon back.
    await user.click(within(section).getByRole('button', { name: 'Save zone' }));
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      name: 'Old town',
      polygon: ZONE_POLYGON,
      thresholdSteps: [
        { ratio: 2, multiplier: 1.2 },
        { ratio: 3, multiplier: 1.5 },
      ],
      multiplierCap: 2,
    });
  });

  it('refuses to save a zone without a drawn polygon', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    const fetchMock = stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION);
    const user = userEvent.setup();
    renderShell();

    const section = await zonesSection();
    await user.click(within(section).getByRole('button', { name: 'Add surge zone' }));
    await user.type(within(section).getByLabelText('Zone name'), 'Airport');
    await user.click(within(section).getByRole('button', { name: 'Save zone' }));

    expect(
      await within(section).findByText("Draw the zone's polygon on the map first."),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')).toBeUndefined();
  });

  it('surfaces the outside-the-region 409 from the backend', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions/region-1/surge-zones'
        ? jsonResponse(409, { status: 409, message: 'outside boundary' })
        : null,
    );
    const user = userEvent.setup();
    mapMock.nextPolygon = NEW_POLYGON;
    renderShell();

    const section = await zonesSection();
    await user.click(within(section).getByRole('button', { name: 'Add surge zone' }));
    await user.type(within(section).getByLabelText('Zone name'), 'Airport');
    await user.click(within(section).getByRole('button', { name: 'draw:Surge zone map' }));
    await user.click(within(section).getByRole('button', { name: 'Save zone' }));

    expect(
      await within(section).findByText(
        'Not allowed: the zone name is already used in this region, or the polygon lies outside the region boundary.',
      ),
    ).toBeInTheDocument();
  });

  it('deletes a zone after confirmation', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION, (method, path) =>
      method === 'DELETE' && path === '/api/v1/admin/surge-zones/zone-1'
        ? emptyResponse(204)
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const section = await zonesSection();
    expect(within(section).getByText('Old town')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Delete' }));
    await user.click(within(section).getByRole('button', { name: 'Confirm' }));

    expect(await within(section).findByText('No surge zones yet.')).toBeInTheDocument();
    expect(within(section).queryByText('Old town')).not.toBeInTheDocument();
  });
});

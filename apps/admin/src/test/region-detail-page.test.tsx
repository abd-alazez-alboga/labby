import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeoJsonPolygon } from '../api/regions';
import type { PolygonMapEditorProps } from '../pages/regions/PolygonMapEditor';
import i18n from '../i18n/i18n';
import { BOUNDARY, COMPLETE_REGION, DRAFT_REGION, stubRegionRoutes } from './region-fixtures';
import { adminUser, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

/**
 * The Leaflet layer is mocked at the component boundary: the stub renders
 * the polygon PROP as JSON (what the page would draw back) and a button
 * that fires onPolygonChange with `mapMock.nextPolygon` (what an admin
 * would draw) — so GeoJSON round-trips are asserted on the component's
 * props/events without a real map.
 */
const mapMock = vi.hoisted(() => ({ nextPolygon: null as unknown }));

vi.mock('../pages/regions/PolygonMapEditor', () => ({
  PolygonMapEditor: ({ label, polygon, editable, onPolygonChange }: PolygonMapEditorProps) => (
    <div>
      <span data-testid={`map-polygon:${label}`}>{JSON.stringify(polygon)}</span>
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

const FULL_ACCESS = adminUser(['regions:view', 'regions:edit', 'pricing:view', 'pricing:edit']);
const REGION_EDITOR_NO_PRICING = adminUser(['regions:view', 'regions:edit']);
const PRICING_VIEWER = adminUser(['regions:view', 'pricing:view']);

describe('region detail page', () => {
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

  it('saves the full bundle PUT with filled values, cleared nulls and the drawn boundary', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    const fetchMock = stubRegionRoutes(FULL_ACCESS, DRAFT_REGION, (method, path) =>
      method === 'PUT' && path === '/api/v1/admin/regions/region-1'
        ? jsonResponse(200, { ...DRAFT_REGION, boundary: BOUNDARY, currency: 'SYP' })
        : null,
    );
    const user = userEvent.setup();
    mapMock.nextPolygon = BOUNDARY;
    renderShell();

    await user.type(await screen.findByLabelText('Currency (ISO 4217)'), 'syp');
    await user.type(screen.getByLabelText('Emergency number'), '112');
    await user.type(screen.getByLabelText('Cancellation grace (min)'), '5');
    await user.type(screen.getByLabelText('Cancellation fee'), '2');
    await user.click(screen.getByRole('button', { name: 'Add tier' }));
    await user.type(screen.getByLabelText('Weekly trips above'), '0');
    await user.type(screen.getByLabelText('Commission (%)'), '25');
    await user.click(screen.getByRole('button', { name: 'draw:Region boundary map' }));
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));

    expect(await screen.findByText('Region saved.')).toBeInTheDocument();
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      name: 'Damascus',
      boundary: BOUNDARY,
      currency: 'SYP',
      emergencyNumber: '112',
      cancellationGraceMin: 5,
      cancellationFee: 2,
      waitGraceMin: null,
      waitPerMinRate: null,
      pickupFeeThresholdKm: null,
      pickupFeePerKm: null,
      surgeCap: null,
      commissionTiers: [{ weeklyTripsAbove: 0, percent: 25 }],
      incentiveValues: null,
      suspensionThresholds: null,
    });
  }, 15_000); // fills every bundle field incl. the M11 trust fields — slow under load

  it('renders the saved boundary back into the map identically (round-trip)', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION);
    renderShell();

    const shown = await screen.findByTestId('map-polygon:Region boundary map');
    expect(JSON.parse(shown.textContent!)).toEqual(BOUNDARY);
  });

  it('shows every mandatory item as missing on a bare draft and disarms Activate', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    stubRegionRoutes(FULL_ACCESS, DRAFT_REGION, (method, path) =>
      method === 'GET' && path === '/api/v1/admin/regions/region-1/service-types'
        ? jsonResponse(200, [])
        : null,
    );
    renderShell();

    expect(await screen.findByText('Boundary polygon')).toBeInTheDocument();
    expect(screen.getAllByText('Missing').length).toBe(11);
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate region' })).toBeDisabled();
  });

  it('arms Activate when the checklist is complete and activates the region', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions/region-1/activate'
        ? jsonResponse(200, { ...COMPLETE_REGION, state: 'active' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    expect(await screen.findByText('Boundary polygon')).toBeInTheDocument();
    expect(screen.getAllByText('Done').length).toBe(11);
    const activate = screen.getByRole('button', { name: 'Activate region' });
    expect(activate).toBeEnabled();

    await user.click(activate);

    expect(await screen.findByText('This region is active.')).toBeInTheDocument();
  });

  it('surfaces the activation 409 honestly — the server is the truth', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions/region-1/activate'
        ? jsonResponse(409, { status: 409, message: 'incomplete: incentives' })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Activate region' }));

    expect(
      await screen.findByText(
        'The server rejected activation — the mandatory bundle is still incomplete. ' +
          "The server's completeness check is the truth; save your changes and review the checklist.",
      ),
    ).toBeInTheDocument();
    // Still a draft: the button stays.
    expect(screen.getByRole('button', { name: 'Activate region' })).toBeInTheDocument();
  });

  it('blocks saving a half-filled all-or-nothing group instead of dropping it', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    const fetchMock = stubRegionRoutes(FULL_ACCESS, DRAFT_REGION);
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText('Driver: min average rating'), '3');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));

    expect(
      await screen.findByText(
        'Suspension thresholds are saved as a whole — fill all four values or clear them all.',
      ),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')).toBeUndefined();
  });

  it('saves the M11 flag levels and metric warnings with the thresholds', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    const fetchMock = stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
      method === 'PUT' && path === '/api/v1/admin/regions/region-1'
        ? jsonResponse(200, COMPLETE_REGION)
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText('Driver flag below (avg rating)'), '3.6');
    await user.type(screen.getByLabelText('Warn when acceptance below (%)'), '45');
    await user.type(screen.getByLabelText('Warn when cancellation above (%)'), '20');
    await user.selectOptions(screen.getByLabelText('Window'), '7');
    await user.type(screen.getByLabelText('Minimum sample'), '10');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));

    expect(await screen.findByText('Region saved.')).toBeInTheDocument();
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    const body = JSON.parse(String(putCall?.[1]?.body)) as Record<string, unknown>;
    // A blank rider flag level is omitted (server default: min + 0.5).
    expect(body.suspensionThresholds).toEqual({
      driver: { minAvgRating: 3, minRatedRides: 20, warnAvgRating: 3.6 },
      rider: { minAvgRating: 2.5, minRatedRides: 10 },
    });
    expect(body.metricWarnings).toEqual({
      minAcceptancePercent: 45,
      maxCancellationPercent: 20,
      windowDays: 7,
      minSample: 10,
    });
  });

  it('blocks a flag level at or below the suspension level and half-filled metric warnings', async () => {
    seedStoredSession(sessionFor(FULL_ACCESS));
    const fetchMock = stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION);
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText('Rider flag below (avg rating)'), '2.5');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    expect(
      await screen.findByText(
        'A flag level must be higher than the suspension level of the same role.',
      ),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Rider flag below (avg rating)'));
    await user.type(screen.getByLabelText('Minimum sample'), '10');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    expect(
      await screen.findByText('Fill in all four metric warning fields, or leave them all blank.'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')).toBeUndefined();
  });

  it('renders the bundle read-only without regions:edit', async () => {
    seedStoredSession(sessionFor(PRICING_VIEWER));
    stubRegionRoutes(PRICING_VIEWER, COMPLETE_REGION);
    renderShell();

    expect(await screen.findByLabelText('Currency (ISO 4217)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save bundle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate region' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^draw:/ })).not.toBeInTheDocument();
  });

  it('hides the pricing sections entirely without pricing:view', async () => {
    seedStoredSession(sessionFor(REGION_EDITOR_NO_PRICING));
    const fetchMock = stubRegionRoutes(REGION_EDITOR_NO_PRICING, COMPLETE_REGION);
    renderShell();

    expect(
      await screen.findByRole('heading', { name: 'Region configuration' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Service types' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Time-window surcharges' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Surge zones' })).not.toBeInTheDocument();
    // The pricing:view endpoints are never even called.
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes('service-types')).length,
    ).toBe(0);
  });

  describe('peak-hour bonus windows (M15-T3)', () => {
    const PEAK_ERROR = 'A bonus above 0 needs at least one window. Start and end must differ.';

    function putBody(fetchMock: ReturnType<typeof stubRegionRoutes>) {
      const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      return putCall ? (JSON.parse(String(putCall[1]?.body)) as Record<string, unknown>) : null;
    }

    it('loads the windows from the region with day chips, times, overnight note and zone', async () => {
      seedStoredSession(sessionFor(FULL_ACCESS));
      stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION);
      renderShell();

      expect(await screen.findByLabelText('Bonus per trip (SYP)')).toHaveValue(1);
      expect(
        screen.getByText(
          'Paid for each completed trip REQUESTED inside a window, region local time (Asia/Damascus).',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Weekly trip bonus · the highest tier reached pays'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Changes apply from the next weekly evaluation (Monday, region time).'),
      ).toBeInTheDocument();

      const starts = screen.getAllByLabelText('Starts');
      const ends = screen.getAllByLabelText('Ends');
      expect(starts.map((input) => (input as HTMLInputElement).value)).toEqual(['07:00', '22:00']);
      expect(ends.map((input) => (input as HTMLInputElement).value)).toEqual(['09:30', '02:00']);

      const [weekdays, weekend] = screen.getAllByRole('group', { name: 'Days' });
      expect(within(weekdays).getByRole('button', { name: 'Mon' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(within(weekdays).getByRole('button', { name: 'Fri' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(within(weekend).getByRole('button', { name: 'Sat' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // Only the 22:00–02:00 window runs past midnight.
      expect(screen.getAllByText('Overnight: ends the next day')).toHaveLength(1);
    });

    it('adds and removes windows and shows the overnight note when end is before start', async () => {
      seedStoredSession(sessionFor(FULL_ACCESS));
      stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION);
      const user = userEvent.setup();
      renderShell();

      await user.click(await screen.findByRole('button', { name: 'Add window' }));
      expect(screen.getAllByRole('group', { name: 'Days' })).toHaveLength(3);

      const starts = screen.getAllByLabelText('Starts');
      const ends = screen.getAllByLabelText('Ends');
      await user.type(starts[2], '23:00');
      await user.type(ends[2], '01:00');
      expect(screen.getAllByText('Overnight: ends the next day')).toHaveLength(2);

      await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
      expect(screen.getAllByRole('group', { name: 'Days' })).toHaveLength(2);
      expect(
        screen.getAllByLabelText('Starts').map((input) => (input as HTMLInputElement).value),
      ).toEqual(['22:00', '23:00']);
    });

    it('sends the edited windows in the bundle PUT as contract times', async () => {
      seedStoredSession(sessionFor(FULL_ACCESS));
      const fetchMock = stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
        method === 'PUT' && path === '/api/v1/admin/regions/region-1'
          ? jsonResponse(200, COMPLETE_REGION)
          : null,
      );
      const user = userEvent.setup();
      renderShell();

      const [weekdays] = await screen.findAllByRole('group', { name: 'Days' });
      await user.click(within(weekdays).getByRole('button', { name: 'Fri' }));
      await user.click(within(weekdays).getByRole('button', { name: 'Mon' }));
      await user.click(screen.getByRole('button', { name: 'Save bundle' }));

      expect(await screen.findByText('Region saved.')).toBeInTheDocument();
      expect(putBody(fetchMock)?.incentiveValues).toEqual({
        weeklyTripBonuses: [{ trips: 40, amount: 50 }],
        peakHourBonusPerTrip: 1,
        peakWindows: [
          { daysOfWeek: [2, 3, 4, 5], startsAt: '07:00:00', endsAt: '09:30:00' },
          { daysOfWeek: [5, 6], startsAt: '22:00:00', endsAt: '02:00:00' },
        ],
        ratingReward: { amount: 20, minAvgRating: 4.8, minWeeklyTrips: 30 },
      });
    });

    it('blocks saving a bonus above 0 without a window, or a window whose start equals its end', async () => {
      seedStoredSession(sessionFor(FULL_ACCESS));
      const fetchMock = stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION);
      const user = userEvent.setup();
      renderShell();

      await user.click((await screen.findAllByRole('button', { name: 'Remove' }))[1]);
      await user.click(screen.getByRole('button', { name: 'Remove' }));
      await user.click(screen.getByRole('button', { name: 'Save bundle' }));
      expect(await screen.findByText(PEAK_ERROR)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Add window' }));
      await user.click(screen.getByRole('button', { name: 'Tue' }));
      await user.type(screen.getByLabelText('Starts'), '08:00');
      await user.type(screen.getByLabelText('Ends'), '08:00');
      await user.click(screen.getByRole('button', { name: 'Save bundle' }));
      expect(await screen.findByText(PEAK_ERROR)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Tue' }));
      await user.click(screen.getByRole('button', { name: 'Save bundle' }));
      expect(
        await screen.findByText('Every window needs at least one day, a start and an end.'),
      ).toBeInTheDocument();
      expect(putBody(fetchMock)).toBeNull();
    });

    it('maps the backend peak-window 400 codes to the peak message', async () => {
      seedStoredSession(sessionFor(FULL_ACCESS));
      stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION, (method, path) =>
        method === 'PUT' && path === '/api/v1/admin/regions/region-1'
          ? jsonResponse(400, {
              status: 400,
              code: 'peak_windows_required',
              message: 'A peak-hour bonus above 0 needs at least one window',
            })
          : null,
      );
      const user = userEvent.setup();
      renderShell();

      await user.click(await screen.findByRole('button', { name: 'Save bundle' }));

      expect(await screen.findByText(PEAK_ERROR)).toBeInTheDocument();
      expect(
        screen.queryByText('The request was rejected — check the values and try again.'),
      ).not.toBeInTheDocument();
    });

    it('renders the peak sub-section in Arabic, right to left', async () => {
      await i18n.changeLanguage('ar');
      seedStoredSession(sessionFor(FULL_ACCESS));
      stubRegionRoutes(FULL_ACCESS, COMPLETE_REGION);
      renderShell();

      expect(await screen.findByText('مكافأة ساعات الذروة')).toBeInTheDocument();
      expect(document.documentElement).toHaveAttribute('dir', 'rtl');
      expect(screen.getByLabelText('المكافأة لكل رحلة (SYP)')).toHaveValue(1);
      const [weekdays] = screen.getAllByRole('group', { name: 'الأيام' });
      expect(within(weekdays).getByRole('button', { name: 'الاثنين' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getAllByText('بعد منتصف الليل: تنتهي في اليوم التالي')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'إضافة فترة' })).toBeInTheDocument();
    });
  });

  it('shows the pricing sections read-only with pricing:view but no pricing:edit', async () => {
    seedStoredSession(sessionFor(PRICING_VIEWER));
    stubRegionRoutes(PRICING_VIEWER, COMPLETE_REGION);
    renderShell();

    const section = (await screen.findByRole('heading', { name: 'Service types' })).closest(
      'section',
    )!;
    expect(within(section).getByText('Economy')).toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: 'Add service type' }),
    ).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add surge zone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add surcharge window' })).not.toBeInTheDocument();
  });
});

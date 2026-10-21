import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Region } from '../api/regions';
import i18n from '../i18n/i18n';
import { COMPLETE_REGION, DRAFT_REGION, stubRegionRoutes } from './region-fixtures';
import { adminUser, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

/**
 * V1 audit W3 / I23 / I18 (board V1FRegionFloorSettings): the region bundle's
 * time zone, driver balance floor + warning margin in the region's currency,
 * and scheduled-ride timing — each sent only when set (or, for the zone,
 * changed), since the contract keeps a value the client leaves out.
 */

vi.mock('../pages/regions/PolygonMapEditor', () => ({ PolygonMapEditor: () => <div /> }));

const EDITOR = adminUser(['regions:view', 'regions:edit']);
const PUT_PATH = '/api/v1/admin/regions/region-1';

function stub(region: Region) {
  seedStoredSession(sessionFor(EDITOR));
  return stubRegionRoutes(EDITOR, region, (method, path, init) =>
    method === 'PUT' && path === PUT_PATH
      ? jsonResponse(200, { ...region, ...(JSON.parse(String(init?.body)) as Partial<Region>) })
      : null,
  );
}

function putBody(fetchMock: ReturnType<typeof stub>): Record<string, unknown> | null {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
  return call ? (JSON.parse(String(call[1]?.body)) as Record<string, unknown>) : null;
}

describe('region floor, time zone and scheduled settings (V1 audit W3 / I23 / I18)', () => {
  beforeAll(async () => {
    await import('../pages/RegionDetailPage');
    await import('../pages/RegionsPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/regions/region-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves the floor and margin in the region currency and previews them', async () => {
    const fetchMock = stub(COMPLETE_REGION);
    const user = userEvent.setup();
    renderShell();

    const floor = await screen.findByLabelText('Driver debt floor (SYP)');
    expect(floor).toHaveValue(null);
    expect(floor).toHaveAccessibleDescription(
      '0 or below. At this balance the driver stops getting ride offers and scheduled rides (board, claims and claimed rides) until they settle at the office.',
    );
    await user.type(floor, '-500000');
    await user.type(screen.getByLabelText('Warn drivers when within (SYP)'), '100000');

    const preview = screen.getByText('What drivers in Damascus get').parentElement!;
    expect(within(preview).getByText('SYP −400,000')).toBeInTheDocument();
    expect(within(preview).getByText('SYP −500,000')).toBeInTheDocument();
    expect(
      within(preview).getByText("Both amounts are in this region's currency."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    expect(await screen.findByText('Region saved.')).toBeInTheDocument();
    const body = putBody(fetchMock)!;
    expect(body.driverBalanceFloor).toBe(-500000);
    expect(body.floorWarningMargin).toBe(100000);
    // Untouched: the zone and the scheduled timing are left out (kept server-side).
    expect('timeZone' in body).toBe(false);
    expect('scheduledSettings' in body).toBe(false);
  });

  it('shows stored values and omits blank ones', async () => {
    const fetchMock = stub({
      ...COMPLETE_REGION,
      driverBalanceFloor: -250000,
      floorWarningMargin: null,
    });
    const user = userEvent.setup();
    renderShell();

    expect(await screen.findByLabelText('Driver debt floor (SYP)')).toHaveValue(-250000);
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    await screen.findByText('Region saved.');
    const body = putBody(fetchMock)!;
    expect(body.driverBalanceFloor).toBe(-250000);
    expect('floorWarningMargin' in body).toBe(false);
  });

  it('blocks a floor above 0 and a warning amount of 0', async () => {
    const fetchMock = stub(COMPLETE_REGION);
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText('Driver debt floor (SYP)'), '5');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("The floor can't be above 0.");

    await user.clear(screen.getByLabelText('Driver debt floor (SYP)'));
    await user.type(screen.getByLabelText('Warn drivers when within (SYP)'), '0');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The warning amount must be more than 0.',
    );
    expect(putBody(fetchMock)).toBeNull();
  });

  it('changes the time zone, listing each zone with its UTC offset', async () => {
    const fetchMock = stub(COMPLETE_REGION);
    const user = userEvent.setup();
    renderShell();

    const zone = await screen.findByLabelText('Time zone');
    expect(zone).toHaveValue('Asia/Damascus');
    expect(zone).toHaveAccessibleDescription(
      'Surcharge windows, peak-hour windows and the incentive week run on this clock.',
    );
    const labels = within(zone)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/^Asia\/Damascus · UTC[+−-]\d{2}:\d{2}$/);
    await user.selectOptions(zone, 'Asia/Beirut');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));

    await screen.findByText('Region saved.');
    expect(putBody(fetchMock)!.timeZone).toBe('Asia/Beirut');
  });

  it('keeps a stored zone outside the list selectable', async () => {
    stub({ ...COMPLETE_REGION, timeZone: 'Europe/Berlin' });
    renderShell();

    const zone = await screen.findByLabelText('Time zone');
    expect(zone).toHaveValue('Europe/Berlin');
    expect(within(zone).getAllByRole('option')).toHaveLength(4);
  });

  it('saves the four scheduled-ride minutes and enforces their order', async () => {
    const fetchMock = stub(COMPLETE_REGION);
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText('First reminder before pickup (min)'), '1440');
    await user.type(screen.getByLabelText('Second reminder before pickup (min)'), '10');
    await user.type(screen.getByLabelText('Fallback to live dispatch (min)'), '15');
    await user.type(screen.getByLabelText('Earliest booking (min)'), '30');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The second reminder must be earlier than the first reminder and later than the fallback.',
    );

    await user.clear(screen.getByLabelText('Second reminder before pickup (min)'));
    await user.type(screen.getByLabelText('Second reminder before pickup (min)'), '60');
    await user.clear(screen.getByLabelText('Earliest booking (min)'));
    await user.type(screen.getByLabelText('Earliest booking (min)'), '15');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The earliest booking must be longer than the fallback.',
    );

    await user.clear(screen.getByLabelText('Earliest booking (min)'));
    await user.type(screen.getByLabelText('Earliest booking (min)'), '30');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    await screen.findByText('Region saved.');
    expect(putBody(fetchMock)!.scheduledSettings).toEqual({
      reminderFirstMin: 1440,
      reminderSecondMin: 60,
      fallbackLeadMin: 15,
      minLeadMin: 30,
    });
  }, 15_000); // three saves of four typed fields — slow under load

  it('blocks a half-filled scheduled group', async () => {
    const fetchMock = stub(COMPLETE_REGION);
    const user = userEvent.setup();
    renderShell();

    await user.type(await screen.findByLabelText('First reminder before pickup (min)'), '1440');
    await user.click(screen.getByRole('button', { name: 'Save bundle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fill in all four scheduled-ride fields, or leave them all blank.',
    );
    expect(putBody(fetchMock)).toBeNull();
  });

  it('prefills the scheduled defaults but never the floor on a new region', async () => {
    window.history.pushState({}, '', '/regions');
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
    expect(screen.getByLabelText('First reminder before pickup (min)')).toHaveValue(1440);
    expect(screen.getByLabelText('Second reminder before pickup (min)')).toHaveValue(60);
    expect(screen.getByLabelText('Fallback to live dispatch (min)')).toHaveValue(15);
    expect(screen.getByLabelText('Earliest booking (min)')).toHaveValue(30);
    // No currency yet: the labels carry no unit, and nothing is prefilled.
    expect(screen.getByLabelText('Driver debt floor')).toHaveValue(null);
    expect(screen.getByLabelText('Warn drivers when within')).toHaveValue(null);
  });

  it('renders the new sections in Arabic', async () => {
    await i18n.changeLanguage('ar');
    stub(COMPLETE_REGION);
    renderShell();

    expect(await screen.findByLabelText('الحد الأدنى لدين السائق (ل.س)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'الرحلات المجدولة' })).toBeInTheDocument();
    expect(screen.getByLabelText('المنطقة الزمنية')).toBeInTheDocument();
  });
});

import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  COMPLETE_REGION,
  SERVICE_TYPES,
  SURCHARGE_WINDOWS,
  stubRegionRoutes,
} from './region-fixtures';
import {
  adminUser,
  emptyResponse,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
} from './test-utils';

// Keep Leaflet out of jsdom; the surge-zone map has its own test file.
vi.mock('../pages/regions/PolygonMapEditor', () => ({
  PolygonMapEditor: () => <div />,
}));

const PRICING_EDITOR = adminUser(['regions:view', 'pricing:view', 'pricing:edit']);

async function serviceTypesSection() {
  return (await screen.findByRole('heading', { name: 'Service types' })).closest('section')!;
}

async function surchargesSection() {
  return (await screen.findByRole('heading', { name: 'Time-window surcharges' })).closest(
    'section',
  )!;
}

describe('region pricing editors', () => {
  beforeAll(async () => {
    // Warm the lazy route chunk once, so findBy timeouts measure rendering,
    // not the first import's transform cost.
    await import('../pages/RegionDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/regions/region-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists service types including disabled ones, with no delete anywhere (UC-A-07)', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION);
    renderShell();

    const section = await serviceTypesSection();
    const vanRow = within(section).getByText('Van').closest('tr')!;
    expect(within(vanRow).getByText('Disabled')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('adds a service type with its pricing', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    const fetchMock = stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions/region-1/service-types'
        ? jsonResponse(201, {
            id: 'st-3',
            regionId: 'region-1',
            nameEn: 'Premium',
            nameAr: 'مميز',
            baseFare: 3,
            perKmRate: 0.8,
            perMinRate: 0.3,
            minimumFare: 5,
            enabled: true,
          })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const section = await serviceTypesSection();
    await user.click(within(section).getByRole('button', { name: 'Add service type' }));
    await user.type(within(section).getByLabelText('English name'), 'Premium');
    await user.type(within(section).getByLabelText('Arabic name'), 'مميز');
    await user.type(within(section).getByLabelText('Base fare'), '3');
    await user.type(within(section).getByLabelText('Per-km rate'), '0.8');
    await user.type(within(section).getByLabelText('Per-minute rate'), '0.3');
    // I24: a new service type starts at the SRS §9 minimum fare, editable.
    expect(within(section).getByLabelText('Minimum fare')).toHaveValue(1.5);
    await user.clear(within(section).getByLabelText('Minimum fare'));
    await user.type(within(section).getByLabelText('Minimum fare'), '5');
    await user.click(within(section).getByRole('button', { name: 'Save service type' }));

    expect(await within(section).findByText('Premium')).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      nameEn: 'Premium',
      nameAr: 'مميز',
      baseFare: 3,
      perKmRate: 0.8,
      perMinRate: 0.3,
      minimumFare: 5,
      enabled: true,
    });
  });

  it('disables a service type through the full-upsert PUT', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    const fetchMock = stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION, (method, path) =>
      method === 'PUT' && path === '/api/v1/admin/service-types/st-1'
        ? jsonResponse(200, { ...SERVICE_TYPES[0], enabled: false })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const section = await serviceTypesSection();
    const economyRow = within(section).getByText('Economy').closest('tr')!;
    await user.click(within(economyRow).getByRole('button', { name: 'Disable' }));

    const updatedRow = (await within(section).findByText('Economy')).closest('tr')!;
    expect(await within(updatedRow).findByText('Disabled')).toBeInTheDocument();
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      nameEn: 'Economy',
      nameAr: 'اقتصادي',
      baseFare: 1,
      perKmRate: 0.3,
      perMinRate: 0.1,
      minimumFare: 1.5,
      enabled: false,
    });
  });

  it('adds a surcharge window with ISO days of week', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    const fetchMock = stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION, (method, path) =>
      method === 'POST' && path === '/api/v1/admin/regions/region-1/surcharge-windows'
        ? jsonResponse(201, {
            id: 'win-2',
            regionId: 'region-1',
            label: 'Weekend evening',
            startsAt: '18:00:00',
            endsAt: '22:30:00',
            daysOfWeek: [5, 6],
            percent: 15,
          })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const section = await surchargesSection();
    await user.click(within(section).getByRole('button', { name: 'Add surcharge window' }));
    await user.type(within(section).getByLabelText('Label'), 'Weekend evening');
    fireEvent.change(within(section).getByLabelText('Starts at'), { target: { value: '18:00' } });
    fireEvent.change(within(section).getByLabelText('Ends at'), { target: { value: '22:30' } });
    await user.click(within(section).getByRole('checkbox', { name: 'Fri' }));
    await user.click(within(section).getByRole('checkbox', { name: 'Sat' }));
    await user.type(within(section).getByLabelText('Surcharge (%)'), '15');
    await user.click(within(section).getByRole('button', { name: 'Save window' }));

    expect(await within(section).findByText('Weekend evening')).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      label: 'Weekend evening',
      startsAt: '18:00:00',
      endsAt: '22:30:00',
      daysOfWeek: [5, 6],
      percent: 15,
    });
  });

  it('edits a surcharge window in place', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    const fetchMock = stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION, (method, path) =>
      method === 'PUT' && path === '/api/v1/admin/surcharge-windows/win-1'
        ? jsonResponse(200, { ...SURCHARGE_WINDOWS[0], percent: 30 })
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const section = await surchargesSection();
    await user.click(within(section).getByRole('button', { name: 'Edit' }));
    const percentInput = within(section).getByLabelText('Surcharge (%)');
    await user.clear(percentInput);
    await user.type(percentInput, '30');
    await user.click(within(section).getByRole('button', { name: 'Save window' }));

    expect(await within(section).findByText('+30%')).toBeInTheDocument();
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      label: 'Morning rush',
      startsAt: '07:30:00',
      endsAt: '09:00:00',
      daysOfWeek: [1, 2, 3, 4, 5],
      percent: 30,
    });
  });

  it('deletes a surcharge window after confirmation', async () => {
    seedStoredSession(sessionFor(PRICING_EDITOR));
    stubRegionRoutes(PRICING_EDITOR, COMPLETE_REGION, (method, path) =>
      method === 'DELETE' && path === '/api/v1/admin/surcharge-windows/win-1'
        ? emptyResponse(204)
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    const section = await surchargesSection();
    expect(within(section).getByText('Morning rush')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Delete' }));
    await user.click(within(section).getByRole('button', { name: 'Confirm' }));

    expect(await within(section).findByText('No surcharge windows yet.')).toBeInTheDocument();
    expect(within(section).queryByText('Morning rush')).not.toBeInTheDocument();
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveOps } from '../api/comms';
import i18n from '../i18n/i18n';
import type { LiveOpsMapProps } from '../pages/liveops/LiveOpsMap';
import { formatClock } from '../pages/surge';
import {
  ACKNOWLEDGED_SOS,
  LIVE_OPS,
  OPEN_SOS,
  SOS_AT,
  SOS_RIDE_ID,
  stubCommsRoutes,
} from './comms-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  type FetchRouteHandler,
} from './test-utils';

// The page's one Leaflet seam: the mock prints the props the real map draws.
vi.mock('../pages/liveops/LiveOpsMap', () => ({
  LiveOpsMap: (props: LiveOpsMapProps) => (
    <div role="region" aria-label={props.label}>
      {props.drivers.map((driver) => (
        <span key={driver.driverUserId}>
          <button type="button" onClick={() => props.onDriverClick(driver.driverUserId)}>
            {`driver ${driver.name} ${driver.status}`}
          </button>
        </span>
      ))}
      {props.rides.map((ride) => (
        <span key={ride.rideId}>{`route ${ride.rideId} ${ride.sosOpen ? 'sos' : 'ok'}`}</span>
      ))}
      {props.sosEvents.map((event) => (
        <button
          key={event.sosEventId}
          type="button"
          onClick={() => props.onRideClick(event.rideId)}
        >
          {`pin ${event.rideId}`}
        </button>
      ))}
      <span>
        {props.surgeZones === null
          ? 'surge off'
          : `surge ${props.surgeZones
              .filter((zone) => zone.band !== 'none')
              .map((zone) => `${zone.name} ${zone.multiplier}× s${zone.strength}`)
              .join(', ')}`}
      </span>
      <span>{props.focus ? `focus ${props.focus.lat},${props.focus.lng}` : 'focus none'}</span>
    </div>
  ),
}));

const VIEWER = adminUser(['rides:view', 'regions:view']);
const SUPPORT_VIEWER = adminUser(['rides:view', 'regions:view', 'support:view']);
const SUPPORT_HANDLER = adminUser(['rides:view', 'regions:view', 'support:view', 'support:handle']);

const LIVE_OPS_PATH = '/api/v1/admin/regions/region-1/live-ops';
const SOS_LIST_PATH = '/api/v1/admin/sos-events';

function stubLiveOps(
  user = SUPPORT_HANDLER,
  {
    snapshot = () => LIVE_OPS,
    sosItems = () => [OPEN_SOS],
    extra,
  }: {
    snapshot?: () => LiveOps;
    sosItems?: (status: string | null) => (typeof OPEN_SOS)[];
    extra?: FetchRouteHandler;
  } = {},
) {
  seedStoredSession(sessionFor(user));
  return stubCommsRoutes(user, (method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === LIVE_OPS_PATH) {
      return jsonResponse(200, snapshot());
    }
    if (method === 'GET' && path === SOS_LIST_PATH) {
      return jsonResponse(200, {
        items: sosItems(url?.searchParams.get('status') ?? null),
        nextCursor: null,
      });
    }
    return null;
  });
}

function sosPanel() {
  return screen.getByRole('heading', { name: 'SOS alerts' }).closest('section')!;
}

describe('live ops map page (UC-A-19/20, ADM-03)', () => {
  beforeAll(async () => {
    await import('../pages/LiveOpsPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/live-ops');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders idle vs on-ride drivers, the route line, the SOS pin and the legend', async () => {
    stubLiveOps();
    renderShell();

    const map = await screen.findByRole('region', { name: 'Live operations map' });
    expect(within(map).getByText('driver Yara M. idle')).toBeInTheDocument();
    expect(within(map).getByText('driver Samer A. on_ride')).toBeInTheDocument();
    expect(within(map).getByText(`route ${SOS_RIDE_ID} sos`)).toBeInTheDocument();
    expect(within(map).getByText(`pin ${SOS_RIDE_ID}`)).toBeInTheDocument();
    // The surge overlay is on by default; only surging zones are drawn.
    expect(within(map).getByText('surge Mazzeh 2× s1')).toBeInTheDocument();

    expect(screen.getByText('Live · every 5 s')).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Map legend' });
    expect(within(legend).getByText('Idle driver')).toBeInTheDocument();
    expect(within(legend).getByText('On a ride')).toBeInTheDocument();
    expect(within(legend).getByText('Surge zone')).toBeInTheDocument();
    expect(within(legend).getByText('SOS')).toBeInTheDocument();

    // "On the map" counts.
    const counts = screen.getByRole('heading', { name: 'On the map' }).closest('section')!;
    expect(within(counts).getByText('Online drivers').parentElement).toHaveTextContent(
      '2 · 1 on rides',
    );
    expect(within(counts).getByText('Active rides').parentElement).toHaveTextContent('1');
    expect(within(counts).getByText('Zones surging').parentElement).toHaveTextContent('1 of 2');
  });

  it('toggles the surge overlay off and focuses the map from the SOS banner', async () => {
    stubLiveOps();
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Live operations map' });

    // The banner names the ride, the rider and the moment (approved red pattern).
    const banner = screen.getAllByRole('alert').find((el) => el.className.includes('sos-banner'))!;
    expect(banner).toHaveTextContent('SOS — ride');
    expect(banner).toHaveTextContent('Lina K.');
    expect(banner).toHaveTextContent(formatClock(SOS_AT, 'en'));

    await user.click(within(banner).getByRole('button', { name: 'Focus on map' }));
    expect(screen.getByText(`focus ${OPEN_SOS.lat},${OPEN_SOS.lng}`)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Surge overlay' }));
    expect(screen.getByText('surge off')).toBeInTheDocument();
  });

  it('clicks through a driver dot and an SOS pin to their details', async () => {
    stubLiveOps();
    renderShell();
    const user = userEvent.setup();
    const map = await screen.findByRole('region', { name: 'Live operations map' });

    await user.click(within(map).getByRole('button', { name: `pin ${SOS_RIDE_ID}` }));
    expect(window.location.pathname).toBe(`/rides/${SOS_RIDE_ID}`);

    window.history.pushState({}, '', '/live-ops');
    renderShell();
    const map2 = await screen.findAllByRole('region', { name: 'Live operations map' });
    await user.click(
      within(map2[map2.length - 1]).getByRole('button', { name: 'driver Yara M. idle' }),
    );
    expect(window.location.pathname).toBe('/driver-ledgers/driver-yara');
  });

  it('acknowledges an open alert with a stand-down note and refreshes the feed', async () => {
    let acknowledged = false;
    const fetchMock = stubLiveOps(SUPPORT_HANDLER, {
      snapshot: () => (acknowledged ? { ...LIVE_OPS, sosEvents: [] } : LIVE_OPS),
      sosItems: () => (acknowledged ? [] : [OPEN_SOS]),
      extra: (method, path, init) => {
        if (
          method === 'POST' &&
          path === `/api/v1/admin/sos-events/${OPEN_SOS.sosEventId}/acknowledge`
        ) {
          expect(JSON.parse(String(init?.body))).toEqual({ note: 'Called the rider, all fine' });
          acknowledged = true;
          return jsonResponse(200, {
            ...OPEN_SOS,
            acknowledged: {
              byUserId: 'admin-1',
              byName: 'Signed-in Admin',
              at: SOS_AT,
              note: 'Called the rider, all fine',
            },
          });
        }
        return null;
      },
    });
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Live operations map' });

    const panel = sosPanel();
    expect(within(panel).getByText('OPEN')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('Stand-down note'), 'Called the rider, all fine');
    await user.click(within(panel).getByRole('button', { name: 'Acknowledge' }));

    expect(await within(panel).findByText(/Stood down by Signed-in Admin/)).toBeInTheDocument();
    expect(panel.querySelector('.chip--success')).toHaveTextContent('Acknowledged');
    // The acknowledgement re-reads the live snapshot (pin gone) and the badge list.
    await waitFor(() => expect(callsTo(fetchMock, LIVE_OPS_PATH).length).toBeGreaterThan(1));
  });

  it('filters the alert list by status', async () => {
    stubLiveOps(SUPPORT_HANDLER, {
      sosItems: (status) =>
        status === 'all' ? [OPEN_SOS, ACKNOWLEDGED_SOS] : status === 'open' ? [OPEN_SOS] : [],
    });
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Live operations map' });

    const panel = sosPanel();
    expect(within(panel).getByText('OPEN')).toBeInTheDocument();
    expect(within(panel).queryByText(/Stood down by/)).toBeNull();

    await user.click(within(panel).getByRole('button', { name: 'All' }));
    expect(await within(panel).findByText(/Stood down by Samir A\./)).toHaveTextContent(
      '“False alarm, pocket press”',
    );
  });

  it('hides the acknowledge controls without support:handle', async () => {
    stubLiveOps(SUPPORT_VIEWER);
    renderShell();
    await screen.findByRole('region', { name: 'Live operations map' });

    const panel = sosPanel();
    expect(within(panel).getByText('OPEN')).toBeInTheDocument();
    expect(within(panel).queryByLabelText('Stand-down note')).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(
      within(panel).getByText('Acknowledging needs the Handle support permission.'),
    ).toBeInTheDocument();
  });

  it('hides the whole alert panel and nav badge without support:view (pins stay)', async () => {
    const fetchMock = stubLiveOps(VIEWER);
    renderShell();
    const map = await screen.findByRole('region', { name: 'Live operations map' });

    expect(screen.queryByRole('heading', { name: 'SOS alerts' })).toBeNull();
    expect(screen.queryByLabelText('Open SOS alerts')).toBeNull();
    // The pins still come from the rides:view live-ops feed.
    expect(within(map).getByText(`pin ${SOS_RIDE_ID}`)).toBeInTheDocument();
    expect(callsTo(fetchMock, SOS_LIST_PATH)).toHaveLength(0);
  });

  it('shows the open-alert count on the Live map nav entry', async () => {
    stubLiveOps(SUPPORT_HANDLER);
    renderShell();

    const badge = await screen.findByLabelText('Open SOS alerts');
    expect(badge).toHaveTextContent('1');
    expect(badge.closest('a')).toHaveAttribute('href', '/live-ops');
  });

  it('surfaces a NEW open alert as a sticky critical toast on any page', async () => {
    let items = [OPEN_SOS];
    stubLiveOps(SUPPORT_HANDLER, { sosItems: () => items });
    window.history.pushState({}, '', '/');
    renderShell();

    // The first read seeds the badge silently.
    expect(await screen.findByLabelText('Open SOS alerts')).toHaveTextContent('1');
    expect(screen.queryByTestId('toast')).toBeNull();

    // A second open alert arrives; the focus re-poll picks it up.
    items = [
      {
        ...OPEN_SOS,
        sosEventId: 'sos-open-9',
        triggeredBy: { ...OPEN_SOS.triggeredBy, name: 'Hadi R.' },
      },
      OPEN_SOS,
    ];
    window.dispatchEvent(new Event('focus'));

    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveTextContent('SOS alert');
    expect(toast).toHaveTextContent('Hadi R.');
    // Sticky critical pattern: no close ×, only the explicit acknowledgement.
    expect(within(toast).getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(within(toast).queryByLabelText('Dismiss')).toBeNull();
    expect(within(toast).getByRole('button', { name: 'Open live map' })).toBeInTheDocument();
  });

  it('switches regions through the selector', async () => {
    const fetchMock = stubLiveOps(SUPPORT_HANDLER, {
      extra: (method, path) =>
        method === 'GET' && path === '/api/v1/admin/regions/region-2/live-ops'
          ? jsonResponse(200, {
              ...LIVE_OPS,
              regionId: 'region-2',
              drivers: [],
              rides: [],
              surgeZones: [],
              sosEvents: [],
            })
          : null,
    });
    renderShell();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Live operations map' });

    await user.selectOptions(screen.getByLabelText('Region'), 'region-2');
    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/v1/admin/regions/region-2/live-ops').length).toBe(1),
    );
  });

  it('renders Arabic with Western digits', async () => {
    await i18n.changeLanguage('ar');
    stubLiveOps();
    renderShell();

    await screen.findByRole('region', { name: 'خريطة العمليات المباشرة' });
    expect(screen.getByText('مباشر · كل 5 ثوانٍ')).toBeInTheDocument();
    const counts = screen.getByRole('heading', { name: 'على الخريطة' }).closest('section')!;
    expect(within(counts).getByText('السائقون المتصلون').parentElement).toHaveTextContent(
      '2 · 1 في رحلات',
    );
  });
});

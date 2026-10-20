import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import type { RideTraceMapProps } from '../pages/rides/RideTraceMap';
import { formatClock } from '../pages/surge';
import {
  ACCEPTED_AT,
  ACKNOWLEDGED_SOS,
  CHAT_LOG,
  OPEN_SOS,
  RIDE_DETAIL,
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

// The detail's one Leaflet seam: the mock prints what the real map draws.
vi.mock('../pages/rides/RideTraceMap', () => ({
  RideTraceMap: (props: RideTraceMapProps) => (
    <div role="region" aria-label={props.label}>
      <span>{`trace ${props.trace.filter((p) => p.phase === 'to_pickup').length} to_pickup / ${
        props.trace.filter((p) => p.phase === 'in_ride').length
      } in_ride`}</span>
      {props.sosEvents.map((event) => (
        <span key={event.sosEventId}>{`sos-pin ${event.rideId}`}</span>
      ))}
    </div>
  ),
}));

const VIEWER = adminUser(['rides:view', 'regions:view']);
const SUPPORT_VIEWER = adminUser(['rides:view', 'regions:view', 'support:view']);
const SUPPORT_HANDLER = adminUser(['rides:view', 'regions:view', 'support:view', 'support:handle']);

/** Strips the LTR isolates the UI wraps money/multipliers in, for plain asserts. */
function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/[⁦-⁩]/g, '');
}

const DETAIL_PATH = `/api/v1/admin/rides/${SOS_RIDE_ID}`;
const CHAT_PATH = `${DETAIL_PATH}/chat`;
const SOS_LIST_PATH = '/api/v1/admin/sos-events';

function stubDetail(user = SUPPORT_HANDLER, extra?: FetchRouteHandler) {
  seedStoredSession(sessionFor(user));
  return stubCommsRoutes(user, (method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === DETAIL_PATH) {
      return jsonResponse(200, RIDE_DETAIL);
    }
    if (method === 'GET' && path === CHAT_PATH) {
      return jsonResponse(200, CHAT_LOG);
    }
    if (method === 'GET' && path === SOS_LIST_PATH) {
      return jsonResponse(200, { items: [OPEN_SOS, ACKNOWLEDGED_SOS], nextCursor: null });
    }
    return null;
  });
}

describe('ride detail page (UC-A-18, CHAT-03)', () => {
  beforeAll(async () => {
    await import('../pages/RideDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/rides/${SOS_RIDE_ID}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the timeline with the SOS moment, the offers trail and the fare', async () => {
    const fetchMock = stubDetail();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ride R-AAAAAAAA' }),
    ).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText(`SOS open · ${formatClock(SOS_AT, 'en')}`)).toBeInTheDocument();

    // Timeline: the state moments plus the permanent SOS moment, in order.
    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('section')!;
    const items = within(timeline).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Requested'),
      expect.stringContaining('Finding a driver'),
      expect.stringContaining('Accepted — Samer A.'),
      expect.stringContaining('Driver arrived'),
      expect.stringContaining('Started'),
      expect.stringContaining('SOS by rider'),
    ]);
    expect(plain(items[0].textContent)).toContain('Estimate SYP 23,000 · surge 1.0×');
    expect(items[2]).toHaveTextContent('Offer 2 · pickup 1.1 km away');
    expect(items[5]).toHaveClass('timeline__item--sos');
    expect(items[5]).toHaveTextContent(formatClock(SOS_AT, 'en'));
    expect(items[5]).toHaveTextContent('Alert open · the event is permanent');

    // Offers trail, in candidate order.
    const offers = screen.getByRole('heading', { name: 'Offers trail' }).closest('section')!;
    const trail = within(offers).getAllByRole('listitem');
    expect(trail[0]).toHaveTextContent('Yara M. · 0.6 km');
    expect(trail[0]).toHaveTextContent('Declined');
    expect(trail[1]).toHaveTextContent('Samer A. · 1.1 km');
    expect(trail[1]).toHaveTextContent(`Accepted · ${formatClock(ACCEPTED_AT, 'en')}`);

    // Fare components (no final fare yet — the estimate shows).
    const fare = screen.getByRole('heading', { name: 'Fare' }).closest('section')!;
    expect(fare).toHaveTextContent('Base fare');
    expect(fare).toHaveTextContent('Distance');
    expect(within(fare).getByText('Estimate (metered)').parentElement).toHaveTextContent(
      'SYP 23,000',
    );

    // The trace map got both phases and the SOS pin; the caption names the moment.
    const map = screen.getByRole('region', { name: 'GPS trace' });
    expect(map).toHaveTextContent('trace 2 to_pickup / 2 in_ride');
    expect(map).toHaveTextContent(`sos-pin ${SOS_RIDE_ID}`);
    expect(screen.getByText(`GPS trace · SOS at ${formatClock(SOS_AT, 'en')}`)).toBeInTheDocument();

    // The open-SOS banner points at the live map on the alert's region and ride (A-H3).
    const banner = screen.getAllByRole('alert').find((el) => el.className.includes('sos-banner'))!;
    expect(banner).toHaveTextContent('SOS by Lina K.');
    expect(within(banner).getByRole('link', { name: 'Open live map' })).toHaveAttribute(
      'href',
      `/live-ops?region=region-1&ride=${SOS_RIDE_ID}`,
    );

    // The per-ride SOS lookup walks the region's alert list (the badge polls status=open).
    const lookup = callsTo(fetchMock, SOS_LIST_PATH)
      .map(([input]) => new URL(String(input)))
      .find((url) => url.searchParams.get('status') === 'all');
    expect(lookup?.searchParams.get('regionId')).toBe('region-1');
  });

  it('shows the read-only chat log with support:view', async () => {
    stubDetail(SUPPORT_VIEWER);
    renderShell();

    const chat = (await screen.findByRole('heading', { name: 'Chat log' })).closest('section')!;
    expect(within(chat).getByText('Read-only · View support permission')).toBeInTheDocument();
    const bubbles = await within(chat).findAllByRole('listitem');
    expect(bubbles).toHaveLength(3);
    // The quick reply renders its localized text; senders get their names.
    expect(bubbles[0]).toHaveTextContent('Samer A.');
    expect(bubbles[0]).toHaveTextContent('On my way');
    expect(bubbles[0]).toHaveClass('chat-log__bubble--driver');
    expect(bubbles[1]).toHaveTextContent('Lina K.');
    expect(bubbles[1]).toHaveTextContent("I'm at the pharmacy entrance, blue jacket");
    expect(bubbles[1]).toHaveClass('chat-log__bubble--rider');
  });

  it('explains when no chat thread exists (never accepted)', async () => {
    stubDetail(SUPPORT_VIEWER, (method, path) =>
      method === 'GET' && path === CHAT_PATH
        ? jsonResponse(404, { status: 404, message: 'No thread' })
        : null,
    );
    renderShell();

    const chat = (await screen.findByRole('heading', { name: 'Chat log' })).closest('section')!;
    expect(
      await within(chat).findByText('No chat — the ride was never accepted.'),
    ).toBeInTheDocument();
  });

  it('hides the chat log, SOS facts and alert lookups without support:view', async () => {
    const fetchMock = stubDetail(VIEWER);
    renderShell();

    await screen.findByRole('heading', { level: 1, name: 'Ride R-AAAAAAAA' });
    expect(screen.queryByRole('heading', { name: 'Chat log' })).toBeNull();
    expect(screen.queryByText(/SOS open/)).toBeNull();
    expect(screen.queryByText(/SOS by rider/)).toBeNull();
    expect(callsTo(fetchMock, SOS_LIST_PATH)).toHaveLength(0);
    expect(callsTo(fetchMock, CHAT_PATH)).toHaveLength(0);
  });

  it('shows party phones only with support:handle (artboard note)', async () => {
    stubDetail(SUPPORT_HANDLER);
    renderShell();
    await screen.findByRole('heading', { level: 1, name: 'Ride R-AAAAAAAA' });

    expect(screen.getByRole('link', { name: '+963911111111' })).toHaveAttribute(
      'href',
      'tel:+963911111111',
    );
    expect(screen.getByRole('link', { name: '+963922222222' })).toHaveAttribute(
      'href',
      'tel:+963922222222',
    );
    expect(screen.queryByText(/phones on this page need/)).toBeNull();
  });

  it('withholds phones without support:handle and says why', async () => {
    stubDetail(SUPPORT_VIEWER);
    renderShell();
    await screen.findByRole('heading', { level: 1, name: 'Ride R-AAAAAAAA' });

    expect(screen.queryByText('+963911111111')).toBeNull();
    expect(screen.queryByText('+963922222222')).toBeNull();
    expect(
      screen.getByText(/phones on this page need the Handle support permission/),
    ).toBeInTheDocument();
    // V1 audit I107: names sit in <bdi>, so the line is asserted as a whole.
    const meta = document.querySelector('.ride-detail__meta');
    expect(meta).toHaveTextContent('rider Lina K.');
    expect(meta).toHaveTextContent('driver Samer A.');
  });

  it('isolates user names in <bdi> and names the region in the meta line (I81, I107)', async () => {
    stubDetail(SUPPORT_HANDLER);
    renderShell();
    await screen.findByRole('heading', { level: 1, name: 'Ride R-AAAAAAAA' });

    const meta = document.querySelector('.ride-detail__meta')!;
    await waitFor(() => expect(meta).toHaveTextContent('Damascus'));
    const isolated = [...meta.querySelectorAll('bdi')].map((node) => node.textContent);
    expect(isolated).toEqual(expect.arrayContaining(['Damascus', 'Lina K.', 'Samer A.']));
    const offers = screen.getByRole('heading', { name: 'Offers trail' }).closest('section')!;
    expect([...offers.querySelectorAll('bdi')].map((node) => node.textContent)).toEqual([
      'Yara M.',
      'Samer A.',
    ]);
  });

  it('lays the Arabic title out RTL, isolating only the ride ref (I81)', async () => {
    await i18n.changeLanguage('ar');
    stubDetail();
    renderShell();

    const title = await screen.findByRole('heading', { level: 1, name: 'الرحلة R-AAAAAAAA' });
    expect(title).not.toHaveAttribute('dir');
    expect(title.querySelector('bdi')).toHaveTextContent('R-AAAAAAAA');
  });

  it('shows the shared chip, creator meta and the Members card (A12ChatLogMembers, W1, W17)', async () => {
    const shared = {
      ...RIDE_DETAIL,
      ride: {
        ...RIDE_DETAIL.ride,
        state: 'completed' as const,
        kind: 'shared' as const,
        paymentStatus: 'split' as const,
        shared: {
          totalSeats: 4,
          seatsTaken: 4,
          members: [
            {
              memberId: 'm-rana',
              firstName: 'Rana',
              isCreator: true,
              partySize: 2,
              status: 'completed' as const,
              paymentMethod: 'cash' as const,
              shareAmount: 12000,
              paymentStatus: 'paid_cash' as const,
            },
            {
              memberId: 'm-omar',
              firstName: 'Omar',
              isCreator: false,
              partySize: 1,
              status: 'completed' as const,
              paymentMethod: 'wallet' as const,
              shareAmount: 6000,
              paymentStatus: 'paid_wallet' as const,
            },
            {
              memberId: 'm-lina',
              firstName: 'Lina',
              isCreator: false,
              partySize: 1,
              status: 'no_show' as const,
              paymentMethod: 'cash' as const,
              cancellationFee: 2000,
              paymentStatus: null,
            },
          ],
        },
      },
      riderName: 'Rana H.',
    };
    stubDetail(SUPPORT_VIEWER, (method, path) =>
      method === 'GET' && path === DETAIL_PATH ? jsonResponse(200, shared) : null,
    );
    renderShell();

    await screen.findByRole('heading', { level: 1, name: 'Ride R-AAAAAAAA' });
    expect(screen.getByText('Shared · 4 seats')).toBeInTheDocument();
    const meta = document.querySelector('.ride-detail__meta')!;
    expect(meta).toHaveTextContent('created by Rana H.');
    expect(meta).toHaveTextContent('3 parties');
    // Each member pays for themselves: no ride-level payment method in the meta.
    expect(meta).not.toHaveTextContent('Cash');

    const members = screen.getByRole('heading', { name: 'Members' }).closest('section')!;
    const rows = within(members).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Rana · creator · party of 2Completed · paid cash',
      'Omar · party of 1Completed · paid wallet',
      'Lina · party of 1Absent · fee charged',
    ]);
    expect(within(rows[2]).getByText('Absent · fee charged')).toHaveAttribute(
      'data-tone',
      'danger',
    );

    // W1: the completed shared ride's status is labelled, never a raw key.
    const fare = screen.getByRole('heading', { name: 'Fare' }).closest('section')!;
    expect(fare).toHaveTextContent('Paid per member');
    expect(fare).not.toHaveTextContent('rideDetail.paymentStatus');

    // The chat card's footnote says thread reads are audited.
    const chat = screen.getByRole('heading', { name: 'Chat log' }).closest('section')!;
    expect(
      await within(chat).findByText('Opening a thread is recorded in the audit log'),
    ).toBeInTheDocument();
  });

  it('switches between the private threads of a shared ride (M12, one read per member)', async () => {
    const shared = {
      ...RIDE_DETAIL,
      ride: {
        ...RIDE_DETAIL.ride,
        kind: 'shared' as const,
        shared: {
          members: [
            {
              memberId: 'm-rana',
              firstName: 'Rana',
              isCreator: true,
              partySize: 2,
              status: 'completed' as const,
            },
            {
              memberId: 'm-omar',
              firstName: 'Omar',
              isCreator: false,
              partySize: 1,
              status: 'no_show' as const,
            },
            {
              memberId: 'm-sami',
              firstName: 'Sami',
              isCreator: false,
              partySize: 1,
              status: 'left' as const,
            },
          ],
        },
      },
    };
    const fetchMock = stubDetail(SUPPORT_VIEWER, (method, path, _init, url) => {
      if (method === 'GET' && path === DETAIL_PATH) {
        return jsonResponse(200, shared);
      }
      if (method === 'GET' && path === CHAT_PATH) {
        return url?.searchParams.get('memberId') === 'm-omar'
          ? jsonResponse(200, { ...CHAT_LOG, items: [CHAT_LOG.items[1]] })
          : jsonResponse(200, CHAT_LOG);
      }
      return null;
    });
    renderShell();
    const user = userEvent.setup();

    const chat = (await screen.findByRole('heading', { name: 'Chat log' })).closest('section')!;
    expect(
      within(chat).getByText(
        'Each member chats privately with the driver. Pick a member to read their thread.',
      ),
    ).toBeInTheDocument();
    const group = within(chat).getByRole('group', { name: 'Member threads' });
    const tabs = within(group).getAllByRole('button');
    // A pre-dispatch leaver never had a thread: not listed.
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Rana · creator', 'Omar']);
    expect(tabs[0]).toHaveAttribute('aria-pressed', 'true');
    const first = await within(chat).findAllByRole('listitem');
    expect(first[1]).toHaveTextContent('Rana');

    await user.click(tabs[1]);
    await waitFor(() => expect(within(chat).getAllByRole('listitem')).toHaveLength(1));
    expect(within(chat).getByRole('listitem')).toHaveTextContent('Omar');
    const asked = callsTo(fetchMock, CHAT_PATH).map(([input]) =>
      new URL(String(input)).searchParams.get('memberId'),
    );
    expect(asked).toEqual(['m-rana', 'm-omar']);
  });

  it('drops a late "earlier messages" answer after switching member (review W11)', async () => {
    const shared = {
      ...RIDE_DETAIL,
      ride: {
        ...RIDE_DETAIL.ride,
        kind: 'shared' as const,
        shared: {
          members: [
            {
              memberId: 'm-rana',
              firstName: 'Rana',
              isCreator: true,
              partySize: 1,
              status: 'completed' as const,
            },
            {
              memberId: 'm-omar',
              firstName: 'Omar',
              isCreator: false,
              partySize: 1,
              status: 'completed' as const,
            },
          ],
        },
      },
    };
    let releaseOlder: (response: Response) => void = () => {};
    stubDetail(SUPPORT_VIEWER, (method, path, _init, url) => {
      if (method === 'GET' && path === DETAIL_PATH) {
        return jsonResponse(200, shared);
      }
      if (method === 'GET' && path === CHAT_PATH) {
        const member = url?.searchParams.get('memberId');
        if (url?.searchParams.get('before')) {
          // Rana's older page: held until after the switch.
          return new Promise<Response>((resolve) => {
            releaseOlder = resolve;
          });
        }
        return member === 'm-rana'
          ? jsonResponse(200, { ...CHAT_LOG, nextCursor: 'cursor-1' })
          : jsonResponse(200, { ...CHAT_LOG, items: [CHAT_LOG.items[2]], nextCursor: null });
      }
      return null;
    });
    renderShell();
    const user = userEvent.setup();
    const chat = (await screen.findByRole('heading', { name: 'Chat log' })).closest('section')!;
    await within(chat).findAllByRole('listitem');
    await user.click(within(chat).getByRole('button', { name: 'Load earlier messages' }));
    await user.click(within(chat).getByRole('button', { name: 'Omar' }));
    await waitFor(() => expect(within(chat).getAllByRole('listitem')).toHaveLength(1));
    releaseOlder(jsonResponse(200, { ...CHAT_LOG, items: [CHAT_LOG.items[0]], nextCursor: null }));
    // Rana's late page never lands under Omar's tab.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(chat).getAllByRole('listitem')).toHaveLength(1);
    expect(within(chat).getByRole('listitem')).toHaveTextContent('Stuck in traffic');
  });

  it('renders Arabic with Western digits and the Arabic service type', async () => {
    await i18n.changeLanguage('ar');
    stubDetail();
    renderShell();

    await screen.findByRole('heading', { level: 1, name: 'الرحلة R-AAAAAAAA' });
    expect(screen.getByText(/اقتصادي/)).toBeInTheDocument();
    const fare = screen.getByRole('heading', { name: 'الأجرة' }).closest('section')!;
    expect(fare).toHaveTextContent('ل.س 23,000');
  });
});

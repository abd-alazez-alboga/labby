import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import type { RideTraceMapProps } from '../pages/rides/RideTraceMap';
import { CHAT_LOG, RIDE_DETAIL, SOS_RIDE_ID } from './comms-fixtures';
import { bodyOf } from './onboarding-fixtures';
import {
  adminUser,
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  sessionFor,
  type FetchRouteHandler,
} from './test-utils';
import {
  adminReport,
  REPORT_1,
  REPORTS_VIEWER,
  stubTrustRoutes,
  TRUST_ADMIN,
} from './trust-fixtures';

// The evidence reuses the ride detail's Leaflet trace: mock its one seam.
vi.mock('../pages/rides/RideTraceMap', () => ({
  RideTraceMap: (props: RideTraceMapProps) => (
    <div role="region" aria-label={props.label}>
      {`trace ${props.trace.length} points`}
    </div>
  ),
}));

const DETAIL = `/api/v1/admin/reports/${REPORT_1}`;
const RESOLVE = `${DETAIL}/resolve`;

function stubDetail(user = TRUST_ADMIN, extra?: FetchRouteHandler) {
  seedStoredSession(sessionFor(user));
  return stubTrustRoutes(user, (method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'GET' && path === DETAIL) {
      return jsonResponse(200, adminReport());
    }
    if (method === 'GET' && path === `/api/v1/admin/rides/${SOS_RIDE_ID}`) {
      return jsonResponse(200, RIDE_DETAIL);
    }
    if (method === 'GET' && path === `/api/v1/admin/rides/${SOS_RIDE_ID}/chat`) {
      return jsonResponse(200, CHAT_LOG);
    }
    return null;
  });
}

/**
 * UC-A-17 steps 2–3 against contract mocks (trust-v1.yaml + the M10 ride
 * evidence): the report text and photo, the ride facts + trace + chat log,
 * both parties' history, and the final resolve flow — success, the
 * mandatory note, the 409 race — plus permission gating and Arabic RTL.
 */
describe('report detail', () => {
  beforeAll(async () => {
    await import('../pages/ReportDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/reports/${REPORT_1}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows what the reporter wrote, the ride evidence and both parties', async () => {
    stubDetail();
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Unsafe driving' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What the rider wrote' })).toBeInTheDocument();
    expect(
      screen.getByText('He was speeding on the Mezzeh highway and using his phone.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Report photo 1' })).toHaveAttribute(
      'src',
      'http://api.test.local/api/v1/files/photo-1?token=abc',
    );

    // Ride evidence: trace + facts, with the link to the full ride detail.
    expect(await screen.findByRole('region', { name: 'GPS trace' })).toHaveTextContent(
      'trace 4 points',
    );
    expect(screen.getByRole('link', { name: 'Open ride detail' })).toHaveAttribute(
      'href',
      `/rides/${SOS_RIDE_ID}`,
    );
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(await screen.findByText('none')).toBeInTheDocument(); // no SOS on this ride

    // Chat log (support:view), bubbles labelled with the report's party names.
    expect(await screen.findByText('Stuck in traffic')).toBeInTheDocument();
    // The sender name sits in <bdi> (V1 audit I107): match the bubble's meta line as a whole.
    const metas = [...document.querySelectorAll('.chat-log__meta')].map((el) => el.textContent);
    expect(metas.some((text) => /^Samer Haddad ·/.test(text ?? ''))).toBe(true);

    // Parties with their prior history; names open the trust profile.
    const parties = screen.getByRole('region', { name: 'Parties' });
    expect(parties).toHaveTextContent('Reported · driver');
    expect(parties).toHaveTextContent('5 reports against · 2 substantiated · 0 filed');
    expect(parties).toHaveTextContent('Reporter · rider');
    expect(within(parties).getByRole('link', { name: 'Rana Khoury' })).toHaveAttribute(
      'href',
      expect.stringContaining('/trust'),
    );

    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(
      screen.getByText(/Rana Khoury is told the outcome only; notes stay internal/),
    ).toBeInTheDocument();
  });

  it('resolves as substantiated with the internal note', async () => {
    const fetchMock = stubDetail(TRUST_ADMIN, (method, path) =>
      method === 'POST' && path === RESOLVE
        ? jsonResponse(
            200,
            adminReport({
              status: 'substantiated',
              resolvedAt: '2026-10-15T10:00:00Z',
              resolutionNote: 'Trace shows 92 km/h on Mezzeh highway.',
              resolvedBy: { userId: 'admin-1', name: 'Support One' },
            }),
          )
        : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('radio', { name: 'Substantiated' }));
    await user.type(
      screen.getByLabelText('Notes · required, internal only'),
      'Trace shows 92 km/h on Mezzeh highway.',
    );
    await user.click(screen.getByRole('button', { name: 'Resolve as substantiated' }));

    expect(
      await screen.findByText(
        'Report resolved as Substantiated. The reporter has been told the outcome.',
      ),
    ).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST', RESOLVE)).toEqual({
      outcome: 'substantiated',
      note: 'Trace shows 92 km/h on Mezzeh highway.',
    });
    // Final: the form gives way to the decision.
    expect(screen.queryByRole('button', { name: /^Resolve/ })).not.toBeInTheDocument();
    const decision = screen.getByRole('region', { name: 'Decision' });
    expect(decision).toHaveTextContent('Trace shows 92 km/h on Mezzeh highway.');
    expect(decision).toHaveTextContent('By Support One');
  });

  it('requires an outcome and a note before sending', async () => {
    const fetchMock = stubDetail();
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText('Choose an outcome.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Unsubstantiated' }));
    await user.type(screen.getByLabelText('Notes · required, internal only'), '   ');
    await user.click(screen.getByRole('button', { name: 'Resolve as unsubstantiated' }));
    expect(
      await screen.findByText("Write a note — it's required and stays internal."),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, '/resolve')).toHaveLength(0);
  });

  it('shows the winning decision on 409 already_resolved', async () => {
    let raced = false;
    stubDetail(TRUST_ADMIN, (method, path) => {
      if (method === 'POST' && path === RESOLVE) {
        raced = true;
        return jsonResponse(409, {
          status: 409,
          message: 'Report already resolved',
          code: 'already_resolved',
        });
      }
      if (method === 'GET' && path === DETAIL && raced) {
        return jsonResponse(
          200,
          adminReport({
            status: 'unsubstantiated',
            resolvedAt: '2026-10-15T09:00:00Z',
            resolutionNote: 'No evidence in the trace.',
            resolvedBy: { userId: 'admin-2', name: 'Support Two' },
          }),
        );
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('radio', { name: 'Substantiated' }));
    await user.type(screen.getByLabelText('Notes · required, internal only'), 'Speeding');
    await user.click(screen.getByRole('button', { name: 'Resolve as substantiated' }));

    expect(
      await screen.findByText(
        'Another admin already resolved this report. Their decision is shown below.',
      ),
    ).toBeInTheDocument();
    const decision = await screen.findByRole('region', { name: 'Decision' });
    expect(decision).toHaveTextContent('No evidence in the trace.');
    expect(decision).toHaveTextContent('By Support Two');
    expect(screen.queryByLabelText('Notes · required, internal only')).not.toBeInTheDocument();
  });

  it('hides the resolve form without reports:handle and the evidence without its permissions', async () => {
    const fetchMock = stubDetail(REPORTS_VIEWER);
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Unsafe driving' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resolve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(
      screen.getByText("The ride's facts and GPS trace need the “View rides” permission."),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The chat log needs the “View support tickets” permission.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, '/api/v1/admin/rides/')).toHaveLength(0));
  });

  it('hides the resolve form with reports:handle on an already-resolved report', async () => {
    stubDetail(adminUser(['reports:view', 'reports:handle']), (method, path) =>
      method === 'GET' && path === DETAIL
        ? jsonResponse(
            200,
            adminReport({
              status: 'substantiated',
              resolvedAt: '2026-10-14T10:00:00Z',
              resolutionNote: 'Confirmed.',
              resolvedBy: { userId: 'admin-1', name: 'Support One' },
            }),
          )
        : null,
    );
    renderShell();

    expect(await screen.findByRole('region', { name: 'Decision' })).toHaveTextContent('Confirmed.');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it("explains a shared ride's per-member chat instead of failing (M12)", async () => {
    stubDetail(TRUST_ADMIN, (method, path) =>
      method === 'GET' && path === `/api/v1/admin/rides/${SOS_RIDE_ID}/chat`
        ? jsonResponse(400, {
            status: 400,
            message: 'memberId is required',
            code: 'member_required',
          })
        : null,
    );
    renderShell();

    expect(
      await screen.findByText(
        "This is a shared ride with one private chat per member. Open the ride's page to read a member's chat.",
      ),
    ).toBeInTheDocument();
  });

  it('renders in Arabic, right to left, with Western digits', async () => {
    stubDetail();
    await i18n.changeLanguage('ar');
    renderShell();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'قيادة غير آمنة' }),
    ).toBeInTheDocument();
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('heading', { name: 'ما كتبه الراكب' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'الطرفان' })).toHaveTextContent(
      '5 بلاغات ضده · 2 ثابتة · 0 مقدَّمة منه',
    );
    expect(screen.getByRole('button', { name: 'حسم' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'البلاغات' }).length).toBeGreaterThan(0);
  });
});

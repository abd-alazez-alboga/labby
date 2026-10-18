import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  CHALLENGE_WEEKLY,
  CHALLENGES_ADMIN,
  CHALLENGES_VIEWER,
  challengeDetail,
  challengeFixture,
  stubGrowthRoutes,
} from './growth-fixtures';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

/**
 * UC-A-28 — one challenge (growth-v1.yaml GET /admin/challenges/{id} and
 * POST …/end): the participation view with live progress and credited
 * rewards, the Participants / Completed / Points-granted KPIs, and End early
 * (completions keep their points), gated by `challenges:manage`.
 */
describe('challenge detail', () => {
  beforeAll(async () => {
    await import('../pages/ChallengeDetailPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', `/challenges/${CHALLENGE_WEEKLY}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDetail(user = CHALLENGES_ADMIN, endStatus?: { status: number; body: unknown }) {
    seedStoredSession(sessionFor(user));
    return stubGrowthRoutes(user, (method, path) => {
      if (method === 'GET' && path === `/api/v1/admin/challenges/${CHALLENGE_WEEKLY}`) {
        return jsonResponse(200, challengeDetail());
      }
      if (method === 'POST' && path === `/api/v1/admin/challenges/${CHALLENGE_WEEKLY}/end`) {
        if (endStatus) {
          return jsonResponse(endStatus.status, endStatus.body);
        }
        return jsonResponse(200, challengeFixture({ endedAt: new Date().toISOString() }));
      }
      return null;
    });
  }

  it('shows the KPIs and the participation with progress and credited rewards', async () => {
    stubDetail();
    renderShell();

    expect(await screen.findByRole('heading', { name: 'Weekly 40' })).toBeInTheDocument();
    const kpis = screen.getByText('Participants').closest('.kpi-row') as HTMLElement;
    expect(within(kpis).getByText('Participants').closest('.kpi')).toHaveTextContent('148');
    expect(within(kpis).getByText('Completed').closest('.kpi')).toHaveTextContent('31');
    // Points granted = completions × reward (owner-approved deviation).
    expect(within(kpis).getByText('Points granted').closest('.kpi')).toHaveTextContent('15,500');

    const samer = screen.getByText('Samer K.').closest('tr')!;
    expect(within(samer).getByText('40 of 40')).toBeInTheDocument();
    expect(within(samer).getByText('+500 pts credited')).toBeInTheDocument();
    const huda = screen.getByText('Huda M.').closest('tr')!;
    expect(within(huda).getByText('33 of 40')).toBeInTheDocument();
    expect(within(huda).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('ends early after a confirm; completions keep their points', async () => {
    const fetchMock = stubDetail();
    renderShell();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Weekly 40' });
    expect(screen.getByText(/The 31 already finished keep their 500 points\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'End early' }));
    const confirm = screen.getByRole('group', { name: 'End early' });
    await user.click(within(confirm).getByRole('button', { name: 'End early' }));

    expect(
      await screen.findByText('Challenge ended — completions keep their points.'),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, `/challenges/${CHALLENGE_WEEKLY}/end`)).toHaveLength(1);
    expect(await screen.findByText('Ended early')).toBeInTheDocument();
  });

  it('reports an already-ended challenge', async () => {
    stubDetail(CHALLENGES_ADMIN, {
      status: 409,
      body: { status: 409, message: 'already_ended', code: 'already_ended' },
    });
    renderShell();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Weekly 40' });
    await user.click(screen.getByRole('button', { name: 'End early' }));
    const confirm = screen.getByRole('group', { name: 'End early' });
    await user.click(within(confirm).getByRole('button', { name: 'End early' }));

    expect(await screen.findByText('The challenge is already ended.')).toBeInTheDocument();
  });

  it('hides the end panel without challenges:manage', async () => {
    stubDetail(CHALLENGES_VIEWER);
    renderShell();

    await screen.findByRole('heading', { name: 'Weekly 40' });
    expect(screen.queryByRole('button', { name: 'End early' })).toBeNull();
  });
});

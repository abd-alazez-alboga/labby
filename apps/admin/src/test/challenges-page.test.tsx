import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  CHALLENGE_SPRINT,
  CHALLENGES_ADMIN,
  CHALLENGES_VIEWER,
  challengeFixture,
  challengePage,
  DAMASCUS_ID,
  stubGrowthRoutes,
} from './growth-fixtures';
import { callsTo, jsonResponse, renderShell, seedStoredSession, sessionFor } from './test-utils';

const FROM_LOCAL = '2026-10-20T00:00';
const TO_LOCAL = '2026-10-26T23:59';

/**
 * UC-A-28 against contract mocks (growth-v1.yaml): the challenges list with
 * participation counters and statuses, creation (EN + AR names, role, region,
 * goal, window, reward — owner-approved two-name deviation 2026-10-18), and
 * `challenges:manage` gating of the form.
 */
describe('challenges admin', () => {
  beforeAll(async () => {
    await import('../pages/ChallengesPage');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/challenges');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubList(user = CHALLENGES_ADMIN, createStatus?: { status: number; body: unknown }) {
    seedStoredSession(sessionFor(user));
    return stubGrowthRoutes(user, (method, path) => {
      if (method === 'GET' && path === '/api/v1/admin/challenges') {
        return jsonResponse(
          200,
          challengePage([
            challengeFixture(),
            challengeFixture({
              challengeId: CHALLENGE_SPRINT,
              titleEn: 'September sprint',
              titleAr: 'سباق أيلول',
              goalTarget: 30,
              rewardPoints: 400,
              startsAt: '2026-09-01T00:00:00Z',
              endsAt: '2026-09-30T23:59:00Z',
              endedAt: '2026-09-20T10:00:00Z',
              participantCount: 96,
              completedCount: 58,
            }),
          ]),
        );
      }
      if (method === 'POST' && path === '/api/v1/admin/challenges') {
        if (createStatus) {
          return jsonResponse(createStatus.status, createStatus.body);
        }
        return jsonResponse(201, challengeFixture({ titleEn: 'Weekend rider' }));
      }
      return null;
    });
  }

  it('lists challenges with who, goal → reward, participation and status', async () => {
    stubList();
    renderShell();

    const row = (await screen.findByText('Weekly 40')).closest('tr')!;
    expect(within(row).getByText('Drivers · Damascus')).toBeInTheDocument();
    expect(within(row).getByText('40 rides → 500 pts')).toBeInTheDocument();
    expect(within(row).getByText('148 / 31')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();

    const sprint = screen.getByText('September sprint').closest('tr')!;
    expect(within(sprint).getByText('Ended early')).toBeInTheDocument();
  });

  it('creates a challenge with both names, role, region, goal, window and reward', async () => {
    const fetchMock = stubList();
    renderShell();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name (English)'), 'Weekend rider');
    await user.type(screen.getByLabelText('Name (Arabic)'), 'راكب نهاية الأسبوع');
    await user.selectOptions(screen.getByLabelText('Who'), 'rider');
    await user.selectOptions(screen.getByLabelText('Region'), DAMASCUS_ID);
    await user.selectOptions(screen.getByLabelText('Goal'), 'shared_rides');
    await user.type(screen.getByLabelText('Count'), '2');
    await user.type(screen.getByLabelText('From'), FROM_LOCAL);
    await user.type(screen.getByLabelText('To'), TO_LOCAL);
    await user.type(screen.getByLabelText('Reward points'), '300');
    await user.click(screen.getByRole('button', { name: 'Create challenge' }));

    expect(await screen.findByText('Weekend rider created.')).toBeInTheDocument();
    const posts = callsTo(fetchMock, '/api/v1/admin/challenges').filter(
      ([, init]) => init?.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
      regionId: DAMASCUS_ID,
      role: 'rider',
      titleEn: 'Weekend rider',
      titleAr: 'راكب نهاية الأسبوع',
      goalType: 'shared_rides',
      goalTarget: 2,
      rewardPoints: 300,
      startsAt: new Date(FROM_LOCAL).toISOString(),
      endsAt: new Date(TO_LOCAL).toISOString(),
    });
  });

  it('rejects an inverted window before calling the backend', async () => {
    const fetchMock = stubList();
    renderShell();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name (English)'), 'Backwards');
    await user.type(screen.getByLabelText('Name (Arabic)'), 'معكوس');
    await user.selectOptions(screen.getByLabelText('Region'), DAMASCUS_ID);
    await user.type(screen.getByLabelText('Count'), '5');
    await user.type(screen.getByLabelText('From'), TO_LOCAL);
    await user.type(screen.getByLabelText('To'), FROM_LOCAL);
    await user.type(screen.getByLabelText('Reward points'), '100');
    await user.click(screen.getByRole('button', { name: 'Create challenge' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the dates — the window is invalid.',
    );
    expect(
      callsTo(fetchMock, '/api/v1/admin/challenges').filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(0);
  });

  it('hides the create form without challenges:manage', async () => {
    stubList(CHALLENGES_VIEWER);
    renderShell();

    await screen.findByText('Weekly 40');
    expect(screen.queryByText('New challenge')).toBeNull();
  });
});

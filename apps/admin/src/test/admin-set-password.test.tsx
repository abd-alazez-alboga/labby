import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  callsTo,
  emptyResponse,
  jsonResponse,
  renderShell,
  stubFetchRoutes,
  type FetchRouteHandler,
} from './test-utils';

/**
 * V1 audit H2 (UC-A-01 / AUTH-06, board V1FAdminSetPassword): a new or
 * locked-out admin sets a password signed out — phone → 6-digit code → new
 * password + confirm — on the auth-v1 password-reset rail.
 */

const START = '/api/v1/auth/password-reset/start';
const VERIFY = '/api/v1/auth/password-reset/verify';
const COMPLETE = '/api/v1/auth/password-reset/complete';

function stubReset(extra?: FetchRouteHandler) {
  return stubFetchRoutes((method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method === 'POST' && path === START) {
      return emptyResponse(204);
    }
    if (method === 'POST' && path === VERIFY) {
      return jsonResponse(200, { resetToken: 'reset-token-1' });
    }
    if (method === 'POST' && path === COMPLETE) {
      return emptyResponse(204);
    }
    return null;
  });
}

function bodyOf(fetchMock: ReturnType<typeof stubFetchRoutes>, path: string, index = 0) {
  const call = callsTo(fetchMock, path)[index];
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

async function sendCodeFor(user: ReturnType<typeof userEvent.setup>, phone = '0988 640 112') {
  await user.type(await screen.findByLabelText('Phone number'), phone);
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByRole('heading', { name: 'Enter the code' });
}

async function typeCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(screen.getByRole('textbox', { name: 'Digit 1 of 6' }));
  await user.keyboard(code);
}

describe('admin set / reset password (V1 audit H2)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/login');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links from sign-in to the signed-out set-password page', async () => {
    stubReset();
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('link', { name: 'Set or reset your password' }));

    expect(
      await screen.findByRole('heading', { name: 'Set or reset your password' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(
      screen.getByText(
        'If this number has a Labby account, the code arrives by SMS within a minute. It works for 5 minutes.',
      ),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/set-password');
  });

  it('runs phone → code → password and lands on sign-in with the banner and the phone', async () => {
    const fetchMock = stubReset();
    window.history.pushState({}, '', '/set-password');
    const user = userEvent.setup();
    renderShell();

    await sendCodeFor(user);
    // The typed national form travels canonical (E.164), like every admin phone.
    expect(bodyOf(fetchMock, START)).toEqual({ phone: '+963988640112' });
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('+963988640112')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await typeCode(user, '481205');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(bodyOf(fetchMock, VERIFY)).toEqual({ phone: '+963988640112', code: '481205' });

    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await user.type(screen.getByLabelText('New password'), 'Qasioun-2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'Qasioun-2026');
    // Each field has its own eye toggle.
    const [revealNew] = screen.getAllByRole('button', { name: 'Show password' });
    await user.click(revealNew);
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(bodyOf(fetchMock, COMPLETE)).toEqual({
      resetToken: 'reset-token-1',
      newPassword: 'Qasioun-2026',
    });
    expect(
      await screen.findByText('Password set. Sign in with your phone number and new password.'),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(screen.getByLabelText('Phone number')).toHaveValue('+963988640112');
  });

  it('shows the wrong-code message on 400 and keeps the step', async () => {
    stubReset((method, path) =>
      method === 'POST' && path === VERIFY
        ? jsonResponse(400, { status: 400, message: 'wrong code' })
        : null,
    );
    window.history.pushState({}, '', '/set-password');
    const user = userEvent.setup();
    renderShell();

    await sendCodeFor(user);
    await typeCode(user, '000000');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is not correct. Try again.',
    );
    expect(screen.getByRole('heading', { name: 'Enter the code' })).toBeInTheDocument();
  });

  it('offers a new code when the code expired (410) and re-sends it', async () => {
    const fetchMock = stubReset((method, path) =>
      method === 'POST' && path === VERIFY
        ? jsonResponse(410, { status: 410, message: 'expired' })
        : null,
    );
    window.history.pushState({}, '', '/set-password');
    const user = userEvent.setup();
    renderShell();

    await sendCodeFor(user);
    await typeCode(user, '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code expired or was tried too many times. Request a new one.',
    );
    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(callsTo(fetchMock, START)).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Digit 1 of 6' })).toHaveValue('');
  });

  it('holds the resend link for the 60 s cooldown', async () => {
    stubReset();
    window.history.pushState({}, '', '/set-password');
    const user = userEvent.setup();
    renderShell();

    await sendCodeFor(user);

    expect(screen.getByRole('button', { name: 'Resend code (60s)' })).toBeDisabled();
  });

  it('refuses mismatched passwords before anything is sent', async () => {
    const fetchMock = stubReset();
    window.history.pushState({}, '', '/set-password');
    const user = userEvent.setup();
    renderShell();

    await sendCodeFor(user);
    await typeCode(user, '481205');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Choose a new password' });

    await user.type(screen.getByLabelText('New password'), 'Qasioun-2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'Qasioun-2025');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(callsTo(fetchMock, COMPLETE)).toHaveLength(0);
  });

  it('goes back to the phone step from "Change number", keeping the number', async () => {
    stubReset();
    window.history.pushState({}, '', '/set-password');
    const user = userEvent.setup();
    renderShell();

    await sendCodeFor(user);
    await user.click(screen.getByRole('button', { name: 'Change number' }));

    expect(screen.getByLabelText('Phone number')).toHaveValue('0988 640 112');
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('renders the flow in Arabic, right to left, with Western digits', async () => {
    stubReset();
    await i18n.changeLanguage('ar');
    window.history.pushState({}, '', '/set-password');
    const user = userEvent.setup();
    renderShell();

    expect(
      await screen.findByRole('heading', { name: 'تعيين كلمة المرور أو إعادة تعيينها' }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    await user.type(screen.getByLabelText('رقم الهاتف'), '0988640112');
    await user.click(screen.getByRole('button', { name: 'إرسال الرمز' }));
    const group = await screen.findByRole('group', { name: 'رمز من 6 أرقام' });
    // The code boxes stay left-to-right in Arabic.
    expect(group).toHaveAttribute('dir', 'ltr');
    expect(within(group).getAllByRole('textbox')).toHaveLength(6);
    expect(screen.getByText('الخطوة 2 من 3')).toBeInTheDocument();
  });
});

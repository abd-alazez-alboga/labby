import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/i18n';
import {
  callsTo,
  jsonResponse,
  renderShell,
  seedStoredSession,
  stubFetchRoutes,
  TEST_USER,
} from './test-utils';

describe('language switching', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.sessionStorage.clear();
    seedStoredSession(); // the shell is behind the auth guard since M2-T5
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flips the document to RTL and translates the shell when switching to Arabic', async () => {
    const user = userEvent.setup();
    renderShell();

    // Wait for the lazy-loaded dashboard chunk before interacting — clicking
    // earlier races the Suspense resolution and makes the test flaky (H1).
    await screen.findByText(
      'Your role does not include analytics. Use the menu to open the pages you can work on.',
    );
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    // Shell strings re-render in Arabic
    expect(screen.getByRole('heading', { name: 'لوحة تحكم لبي' })).toBeInTheDocument();
    expect(
      await screen.findByText('لا يشمل دورك التحليلات. استخدم القائمة لفتح الصفحات المتاحة لك.'),
    ).toBeInTheDocument();
  });

  it('flips back to LTR when switching to English again', async () => {
    const user = userEvent.setup();
    renderShell();

    await screen.findByText(
      'Your role does not include analytics. Use the menu to open the pages you can work on.',
    );
    await user.click(screen.getByRole('button', { name: 'Switch language' }));
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    await user.click(screen.getByRole('button', { name: 'تغيير اللغة' }));
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('persists the chosen language', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(window.localStorage.getItem('labby.admin.language')).toBe('ar');
  });

  it('saves the switched language to the signed-in account (UC-S-10, W14)', async () => {
    const fetchMock = stubFetchRoutes((method, path, init) => {
      if (path === '/api/v1/users/me' && method === 'GET') {
        return jsonResponse(200, TEST_USER);
      }
      if (path === '/api/v1/users/me' && method === 'PUT') {
        return jsonResponse(200, { ...TEST_USER, ...JSON.parse(String(init?.body)) });
      }
      return null;
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Switch language' }));

    await waitFor(() =>
      expect(
        callsTo(fetchMock, '/api/v1/users/me').some(([, init]) => init?.method === 'PUT'),
      ).toBe(true),
    );
    const put = callsTo(fetchMock, '/api/v1/users/me').find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]?.body))).toEqual({ name: TEST_USER.name, language: 'ar' });
  });

  it('keeps the switch working when saving to the account fails', async () => {
    stubFetchRoutes((method, path) =>
      path === '/api/v1/users/me' && method === 'GET'
        ? jsonResponse(200, TEST_USER)
        : path === '/api/v1/users/me'
          ? jsonResponse(500, { status: 500, message: 'boom' })
          : null,
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Switch language' }));
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('does not touch any account when signed out (login page)', async () => {
    window.sessionStorage.clear();
    const fetchMock = stubFetchRoutes(() => null);
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Switch language' }));
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(
      callsTo(fetchMock, '/api/v1/users/me').filter(([, init]) => init?.method === 'PUT'),
    ).toHaveLength(0);
  });
});

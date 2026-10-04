import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import i18n from '../i18n/i18n';
import { renderShell } from './test-utils';

describe('language switching', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.history.pushState({}, '', '/');
  });

  it('flips the document to RTL and translates the shell when switching to Arabic', async () => {
    const user = userEvent.setup();
    renderShell();

    expect(document.documentElement.getAttribute('dir')).toBe('ltr');

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    // Shell strings re-render in Arabic
    expect(screen.getByRole('heading', { name: 'لوحة تحكم لابي' })).toBeInTheDocument();
    expect(await screen.findByText('تصل لوحة تحكم المشرف في مرحلة لاحقة.')).toBeInTheDocument();
  });

  it('flips back to LTR when switching to English again', async () => {
    const user = userEvent.setup();
    renderShell();

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
});

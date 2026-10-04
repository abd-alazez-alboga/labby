import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import i18n from '../i18n/i18n';
import { renderShell } from './test-utils';

describe('app shell', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.history.pushState({}, '', '/');
  });

  it('renders navbar, sidenav brand, and the lazy dashboard page', async () => {
    renderShell();

    // Navbar
    expect(screen.getByRole('heading', { name: 'Labby Admin' })).toBeInTheDocument();
    // Sidenav brand (Labby logo) + nav link
    expect(screen.getByRole('img', { name: 'Labby' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    // Lazy-loaded dashboard page content
    expect(
      await screen.findByText('The admin dashboard arrives in a later milestone.'),
    ).toBeInTheDocument();
  });

  it('renders the lazy not-found page for unknown routes', async () => {
    window.history.pushState({}, '', '/definitely-not-a-route');
    renderShell();

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
});

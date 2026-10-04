import { renderRouter, screen } from 'expo-router/testing-library';

import { HomeScreen } from '../components/home-screen';
import { initI18n, setAppLanguage } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';

describe('driver app shell', () => {
  beforeEach(async () => {
    await initI18n();
    await setAppLanguage('en');
  });

  it('renders the real route tree with the home screen', async () => {
    renderRouter('src/app');

    expect(await screen.findByTestId('home-screen')).toBeTruthy();
    expect(screen.getByText('Welcome to Labby Driver')).toBeTruthy();
    expect(screen.getByText('Your trips will appear here once rides go live.')).toBeTruthy();
  });

  it('renders the home screen with a settings link', async () => {
    renderRouter(
      {
        index: () => (
          <LocaleProvider initialLanguage="en">
            <HomeScreen />
          </LocaleProvider>
        ),
      },
      { initialUrl: '/' },
    );

    expect(await screen.findByTestId('settings-link')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });
});

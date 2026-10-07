import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts (no CDN): Manrope for Latin, IBM Plex Sans Arabic for
// Arabic (it tops out at 700, so 800 falls back to 700 in AR).
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';

import './theme/tokens.css';
import './theme/global.css';

import { App } from './app/App';
import { FatalErrorPage } from './app/FatalErrorPage';
import { ConfigProvider } from './config/ConfigContext';
import { loadRuntimeConfig } from './config/runtime-config';
import { initI18n } from './i18n/i18n';

/**
 * Boot sequence: fetch runtime config (public/config.json) BEFORE rendering
 * anything, then init i18n, then mount the app. If the config cannot be
 * loaded the app renders a fatal error state instead of starting half-broken.
 */
async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Missing #root element');
  }
  const root = createRoot(container);

  try {
    const config = await loadRuntimeConfig();
    await initI18n();
    root.render(
      <StrictMode>
        <ConfigProvider config={config}>
          <App />
        </ConfigProvider>
      </StrictMode>,
    );
  } catch (error) {
    console.error('Labby Admin failed to start:', error);
    root.render(<FatalErrorPage detail={error instanceof Error ? error.message : undefined} />);
  }
}

void bootstrap();

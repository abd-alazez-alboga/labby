import { render } from '@testing-library/react';

import { App } from '../app/App';
import { ConfigProvider } from '../config/ConfigContext';
import type { RuntimeConfig } from '../config/runtime-config';

export const TEST_CONFIG: RuntimeConfig = {
  apiBaseUrl: 'http://api.test.local',
  environment: 'test',
};

/** Renders the full app shell the same way main.tsx mounts it. */
export function renderShell(config: RuntimeConfig = TEST_CONFIG) {
  return render(
    <ConfigProvider config={config}>
      <App />
    </ConfigProvider>,
  );
}

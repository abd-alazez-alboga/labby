import { createContext, useContext, type ReactNode } from 'react';

import type { RuntimeConfig } from './runtime-config';

const ConfigContext = createContext<RuntimeConfig | null>(null);

export function ConfigProvider({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: ReactNode;
}) {
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

/** Typed access to the runtime config loaded at boot. */
// eslint-disable-next-line react-refresh/only-export-components
export function useConfig(): RuntimeConfig {
  const config = useContext(ConfigContext);
  if (config === null) {
    throw new Error('useConfig must be used inside <ConfigProvider> (config is loaded at boot)');
  }
  return config;
}

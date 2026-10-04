import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { directionFor, setAppLanguage } from './index';
import type { Direction, Language } from './index';

export interface LocaleContextValue {
  language: Language;
  /**
   * JS-level direction flag, updated immediately on language switch.
   * Native mirroring (I18nManager) follows after an app restart —
   * see syncNativeDirection in src/i18n/index.ts.
   */
  direction: Direction;
  setLanguage: (language: Language) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: Language;
  children: React.ReactNode;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback(async (next: Language) => {
    await setAppLanguage(next);
    setLanguageState(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ language, direction: directionFor(language), setLanguage }),
    [language, setLanguage],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return value;
}

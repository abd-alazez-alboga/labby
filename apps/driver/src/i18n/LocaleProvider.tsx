import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { I18nManager } from 'react-native';

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
  /**
   * Whether row/position styles must be flipped MANUALLY: true only while
   * the language is RTL but the native layout has not restarted into RTL
   * yet. Once `I18nManager.isRTL` is live, React Native mirrors rows and
   * logical start/end itself — flipping again would undo it. Key structural
   * overrides (row-reverse, absolute start/end) on this; text alignment
   * stays on `direction`.
   */
  flipRows: boolean;
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

  const value = useMemo<LocaleContextValue>(() => {
    const direction = directionFor(language);
    let nativeRTL = false;
    try {
      nativeRTL = I18nManager.isRTL;
    } catch {
      // native module unavailable in some test environments
    }
    return {
      language,
      direction,
      flipRows: direction === 'rtl' && !nativeRTL,
      setLanguage,
    };
  }, [language, setLanguage]);

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

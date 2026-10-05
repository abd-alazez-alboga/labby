/**
 * Locale state for the shell: persists the chosen language, applies it on
 * launch, and exposes `t()` plus direction flags.
 *
 * RTL approach (documented honestly):
 * - `I18nManager.allowRTL(true)` + `forceRTL(locale === 'ar')` is called when
 *   the language changes. React Native only applies a forced direction flip
 *   to native layout **after the app restarts** — that caveat is surfaced to
 *   the user on the settings screen (settings.rtlNote).
 * - For immediate feedback the context also exposes `isRTL` / `direction`,
 *   and shell screens use direction-aware styles (row reversal, text align)
 *   driven by those flags, so the UI reads correctly right after the switch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { I18n, type TranslateOptions } from 'i18n-js';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { I18nManager } from 'react-native';

import { type AppLocale, SUPPORTED_LOCALES, translations } from './translations';

export const LANGUAGE_STORAGE_KEY = 'labby.rider.language';

const i18n = new I18n(translations);
i18n.enableFallback = true;
i18n.defaultLocale = 'en';

function deviceLocale(): AppLocale {
  const code = getLocales()[0]?.languageCode;
  return code === 'ar' ? 'ar' : 'en';
}

function applyNativeDirection(locale: AppLocale): void {
  const rtl = locale === 'ar';
  try {
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== rtl) {
      I18nManager.forceRTL(rtl); // takes full effect after app restart
    }
  } catch {
    // Native module unavailable (e.g. certain test environments) — the
    // direction-aware styles below still follow `isRTL`.
  }
}

export interface LocaleContextValue {
  locale: AppLocale;
  isRTL: boolean;
  direction: 'ltr' | 'rtl';
  /**
   * Whether row/position styles must be flipped MANUALLY: true only while the
   * locale is RTL but the native layout has not restarted into RTL yet. Once
   * `I18nManager.isRTL` is live, React Native mirrors rows and logical
   * start/end itself — flipping again would undo it. Key structural overrides
   * (row-reverse, absolute start/end) on this; text alignment stays on isRTL.
   */
  flipRows: boolean;
  t: (key: string, options?: TranslateOptions) => string;
  setLocale: (locale: AppLocale) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>('en');
  const [ready, setReady] = useState(false);

  // Applied on launch: persisted language wins, device language is the default.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stored: string | null = null;
      try {
        stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      } catch {
        // storage unavailable — fall back to device locale
      }
      const initial = SUPPORTED_LOCALES.includes(stored as AppLocale)
        ? (stored as AppLocale)
        : deviceLocale();
      if (!cancelled) {
        i18n.locale = initial;
        applyNativeDirection(initial);
        setLocaleState(initial);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback(async (next: AppLocale) => {
    i18n.locale = next;
    applyNativeDirection(next);
    setLocaleState(next);
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // persistence is best-effort; the in-memory switch already happened
    }
  }, []);

  const t = useCallback(
    (key: string, options?: TranslateOptions) => i18n.t(key, options),
    // i18n.locale is mutated alongside state; depend on locale to re-create t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const value = useMemo<LocaleContextValue>(() => {
    let nativeRTL = false;
    try {
      nativeRTL = I18nManager.isRTL;
    } catch {
      // native module unavailable in some test environments
    }
    const isRTL = locale === 'ar';
    return {
      locale,
      isRTL,
      direction: isRTL ? 'rtl' : 'ltr',
      flipRows: isRTL && !nativeRTL,
      t,
      setLocale,
    };
  }, [locale, t, setLocale]);

  if (!ready) {
    return null; // splash screen stays visible until the stored language is applied
  }

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}

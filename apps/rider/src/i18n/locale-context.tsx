/**
 * Locale state for the shell: persists the chosen language, applies it on
 * launch, and exposes `t()` plus direction flags.
 *
 * RTL approach (documented honestly):
 * - `I18nManager.allowRTL(true)` + `forceRTL(locale === 'ar')` is called when
 *   the language changes. React Native only applies a forced direction flip
 *   to native layout when the React host restarts, so a direction-changing
 *   switch reloads the app (`reloadIfDirectionChanged`, owner decision
 *   2026-10-07) and returns to the screen it happened on.
 * - The context also exposes `isRTL` / `direction` / `flipRows`; `flipRows`
 *   is the manual-mirroring fallback for a host that cannot reload (tests).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { I18n, type TranslateOptions } from "i18n-js";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { I18nManager } from "react-native";

import { reloadForDirection } from "./direction-reload";

import {
  type AppLocale,
  SUPPORTED_LOCALES,
  translations,
} from "./translations";

export const LANGUAGE_STORAGE_KEY = "labby.rider.language";

const i18n = new I18n(translations);
i18n.enableFallback = true;
i18n.defaultLocale = "en";

function deviceLocale(): AppLocale {
  const code = getLocales()[0]?.languageCode;
  return code === "ar" ? "ar" : "en";
}

/**
 * The native layout direction this process launched with. `I18nManager.isRTL`
 * already reports a pending `forceRTL` before the restart that applies it, so
 * it is read once here, at import (before any locale switch can run).
 */
const NATIVE_RTL_AT_LAUNCH: boolean = (() => {
  try {
    return I18nManager.isRTL;
  } catch {
    return false; // native module unavailable in some test environments
  }
})();

/**
 * Rows, absolute start/end and physical text alignment must be flipped by
 * hand exactly when the locale direction differs from the native layout the
 * app launched with (a switch either way, before the restart applies it).
 */
export function needsManualFlip(
  localeRTL: boolean,
  nativeRTLAtLaunch: boolean,
): boolean {
  return localeRTL !== nativeRTLAtLaunch;
}

/**
 * Reloads the app when `locale`'s direction differs from the native layout
 * the app launched with, reopening `returnTo` afterwards.
 */
export async function reloadIfDirectionChanged(
  locale: AppLocale,
  returnTo?: string,
): Promise<void> {
  if (needsManualFlip(locale === "ar", NATIVE_RTL_AT_LAUNCH)) {
    await reloadForDirection(returnTo);
  }
}

function applyNativeDirection(locale: AppLocale): void {
  const rtl = locale === "ar";
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
  direction: "ltr" | "rtl";
  /**
   * Whether row/position styles must be flipped MANUALLY: true while the
   * locale's direction differs from the native layout direction the app
   * launched with (a switch either way, before the restart applies it). Once
   * native RTL is live, React Native mirrors rows and swaps left/right itself —
   * flipping again would undo it. Key structural overrides (row-reverse,
   * absolute start/end) and physical text alignment on this.
   */
  flipRows: boolean;
  t: (key: string, options?: TranslateOptions) => string;
  setLocale: (locale: AppLocale) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("en");
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
    const isRTL = locale === "ar";
    return {
      locale,
      isRTL,
      direction: isRTL ? "rtl" : "ltr",
      flipRows: needsManualFlip(isRTL, NATIVE_RTL_AT_LAUNCH),
      t,
      setLocale,
    };
  }, [locale, t, setLocale]);

  if (!ready) {
    return null; // splash screen stays visible until the stored language is applied
  }

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return ctx;
}

/** The locale when rendered inside a LocaleProvider, else null (shared UI primitives). */
export function useOptionalLocale(): LocaleContextValue | null {
  return useContext(LocaleContext) ?? null;
}

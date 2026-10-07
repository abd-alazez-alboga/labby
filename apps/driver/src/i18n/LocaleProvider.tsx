import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { I18nManager } from "react-native";

import { reloadForDirection } from "./direction-reload";
import { directionFor, setAppLanguage } from "./index";
import type { Direction, Language } from "./index";

export interface LocaleContextValue {
  language: Language;
  /**
   * JS-level direction flag, updated immediately on language switch.
   * Native mirroring (I18nManager) follows after an app restart —
   * see syncNativeDirection in src/i18n/index.ts.
   */
  direction: Direction;
  /**
   * Whether row/position styles must be flipped MANUALLY: true while the
   * language direction differs from the native layout direction the app
   * launched with (a switch either way before the restart). Once `I18nManager.isRTL` is live, React Native mirrors rows and
   * logical start/end itself — flipping again would undo it. Key structural
   * overrides (row-reverse, absolute start/end) on this; text alignment
   * stays on `direction`.
   */
  flipRows: boolean;
  /**
   * Switches language; when the layout direction changes, the app reloads so
   * the native layout mirrors (returning to `returnTo`, if given).
   */
  setLanguage: (
    language: Language,
    options?: { returnTo?: string },
  ) => Promise<void>;
}

/**
 * The native layout direction this process launched with. `I18nManager.isRTL`
 * already reports a pending `forceRTL` before the restart that applies it, so
 * it is read once here, at import (before any language switch can run).
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
 * hand exactly when the language direction differs from the native layout
 * the app launched with (a switch either way, before the restart applies it).
 */
export function needsManualFlip(
  languageRTL: boolean,
  nativeRTLAtLaunch: boolean,
): boolean {
  return languageRTL !== nativeRTLAtLaunch;
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

  const setLanguage = useCallback(
    async (next: Language, options?: { returnTo?: string }) => {
      await setAppLanguage(next);
      setLanguageState(next);
      if ((directionFor(next) === "rtl") !== NATIVE_RTL_AT_LAUNCH) {
        await reloadForDirection(options?.returnTo);
      }
    },
    [],
  );

  const value = useMemo<LocaleContextValue>(() => {
    const direction = directionFor(language);
    return {
      language,
      direction,
      flipRows: needsManualFlip(direction === "rtl", NATIVE_RTL_AT_LAUNCH),
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
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return value;
}

/** Like useLocale, but null outside a LocaleProvider (bare unit renders). */
export function useOptionalLocale(): LocaleContextValue | null {
  return useContext(LocaleContext);
}

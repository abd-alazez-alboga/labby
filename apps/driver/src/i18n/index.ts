/* eslint-disable import/no-named-as-default-member --
   i18next is used as the documented singleton (i18n.use/init/changeLanguage). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';

import ar from './translations/ar.json';
import en from './translations/en.json';

export const LANGUAGE_STORAGE_KEY = 'labby-driver.language';

export const SUPPORTED_LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export type Direction = 'ltr' | 'rtl';

export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

export function directionFor(language: Language): Direction {
  return language === 'ar' ? 'rtl' : 'ltr';
}

/** Persisted language choice, or null when unset/unreadable. */
export async function loadStoredLanguage(): Promise<Language | null> {
  try {
    const value = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/** Best supported match for the device locale; falls back to English. */
export function deviceLanguage(): Language {
  try {
    const code = getLocales()[0]?.languageCode;
    return isSupportedLanguage(code) ? code : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Syncs the NATIVE layout direction with `language`.
 *
 * Honest caveat: `I18nManager.forceRTL` only changes what the CURRENT
 * process sees after the app is restarted (or reloaded in development).
 * Immediately after a language switch, natively mirrored layout (row
 * order, back gestures, navigation animations) still follows the old
 * direction; the JS-level `direction` flag in LocaleProvider updates
 * instantly and is what shell components use for text alignment.
 */
export function syncNativeDirection(language: Language): void {
  const shouldBeRTL = directionFor(language) === 'rtl';
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.forceRTL(shouldBeRTL);
  }
}

/**
 * Initializes i18next on launch: persisted language first, then the
 * device locale, then English. Returns the language that was applied.
 */
export async function initI18n(): Promise<Language> {
  const language = (await loadStoredLanguage()) ?? deviceLanguage();

  if (i18n.isInitialized) {
    await i18n.changeLanguage(language);
  } else {
    await i18n.use(initReactI18next).init({
      resources: {
        en: { translation: en },
        ar: { translation: ar },
      },
      lng: language,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
    });
  }

  syncNativeDirection(language);
  return language;
}

/** Switches the app language, applies direction, and persists the choice. */
export async function setAppLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  syncNativeDirection(language);
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Persistence is best-effort; the in-memory language is already switched.
  }
}

export default i18n;

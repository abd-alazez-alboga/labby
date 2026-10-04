import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ar from './ar.json';
import en from './en.json';

export type SupportedLanguage = 'en' | 'ar';

export const RTL_LANGUAGES: readonly SupportedLanguage[] = ['ar'];
const STORAGE_KEY = 'labby.admin.language';
const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

function readStoredLanguage(): SupportedLanguage {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'ar' || stored === 'en' ? stored : DEFAULT_LANGUAGE;
  } catch {
    // Storage can be unavailable (private mode, blocked); fall back silently.
    return DEFAULT_LANGUAGE;
  }
}

function persistLanguage(language: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Non-fatal: the choice just will not survive a reload.
  }
}

/** Flips document direction (rtl/ltr) and lang attribute for the given language. */
export function applyDocumentDirection(language: string): void {
  const dir = (RTL_LANGUAGES as readonly string[]).includes(language) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', language);
}

/**
 * Initializes i18next with EN + AR resources. The stored choice (localStorage)
 * wins; direction is applied immediately and re-applied + persisted on every
 * language change, so toggling flips LTR/RTL instantly.
 */
export async function initI18n(): Promise<typeof i18n> {
  const language = readStoredLanguage();

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false },
  });

  i18n.on('languageChanged', (next) => {
    applyDocumentDirection(next);
    persistLanguage(next);
  });
  applyDocumentDirection(language);

  return i18n;
}

export default i18n;

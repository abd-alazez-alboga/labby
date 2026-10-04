import { useTranslation } from 'react-i18next';

/**
 * Toggles EN <-> AR. The direction flip (ltr/rtl) and persistence happen in
 * the i18n module's languageChanged listener, so the whole document reacts
 * instantly wherever the language is changed from.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const nextLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      className="btn"
      aria-label={t('language.switchLabel')}
      onClick={() => void i18n.changeLanguage(nextLanguage)}
    >
      {t('language.switchTo')}
    </button>
  );
}

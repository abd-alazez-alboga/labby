import { useTranslation } from 'react-i18next';

import { updateMyProfile } from '../api/auth';
import { useAuth } from '../auth/AuthContext';

/**
 * Toggles EN <-> AR. The direction flip (ltr/rtl) and persistence happen in
 * the i18n module's languageChanged listener, so the whole document reacts
 * instantly wherever the language is changed from. Signed in, the choice is
 * also saved to the account (best effort, UC-S-10 / V1 audit W14) so SOS
 * pushes and the notification center follow it.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { user, apiClient } = useAuth();
  const nextLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  function switchLanguage() {
    void i18n.changeLanguage(nextLanguage);
    if (user) {
      updateMyProfile(apiClient, { name: user.name, language: nextLanguage }).catch(() => {
        // The UI already switched; the account keeps its old language until the next switch.
      });
    }
  }

  return (
    <button
      type="button"
      className="btn btn--small btn--ghost"
      aria-label={t('language.switchLabel')}
      onClick={switchLanguage}
    >
      {t('language.switchTo')}
    </button>
  );
}

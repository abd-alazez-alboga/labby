/**
 * Shell translations for the Labby rider app (EN + AR).
 * Keys are nested per screen, mirroring the admin app's i18n layout.
 */
export const translations = {
  en: {
    common: {
      appName: 'Labby',
    },
    home: {
      title: 'Home',
      welcome: 'Welcome to Labby',
      subtitle: 'Your ride, your way.',
      openSettings: 'Settings',
    },
    settings: {
      title: 'Settings',
      language: 'Language',
      english: 'English',
      arabic: 'العربية',
      direction: 'Layout direction',
      rtlNote:
        'Switching language updates text immediately. A full right-to-left layout flip is applied on the next app restart.',
    },
  },
  ar: {
    common: {
      appName: 'لابي',
    },
    home: {
      title: 'الرئيسية',
      welcome: 'أهلاً بك في لابي',
      subtitle: 'رحلتك، على طريقتك.',
      openSettings: 'الإعدادات',
    },
    settings: {
      title: 'الإعدادات',
      language: 'اللغة',
      english: 'English',
      arabic: 'العربية',
      direction: 'اتجاه الواجهة',
      rtlNote:
        'يتم تحديث النصوص فور تغيير اللغة. يُطبَّق الاتجاه الكامل من اليمين إلى اليسار بعد إعادة تشغيل التطبيق.',
    },
  },
} as const;

export type AppLocale = keyof typeof translations;
export const SUPPORTED_LOCALES: AppLocale[] = ['en', 'ar'];

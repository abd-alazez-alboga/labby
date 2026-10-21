import { useTranslation } from 'react-i18next';

/**
 * The Labby brand mark (owner-approved boards LFLogoAdminSidebar /
 * LFLogoAdminLogin, 2026-10-21): the real logo assets from assets/images —
 * the tri-spoke icon in the sidebar, the full logo (icon + wordmark) on the
 * sign-in card. Exposed to assistive tech as "Labby" / "لبي" (M15-T4); the
 * full logo stands in for the "Labby Admin" title, so it reads as the title.
 */
export function BrandMark({ variant = 'icon' }: { variant?: 'icon' | 'logo' }) {
  const { t } = useTranslation();
  if (variant === 'logo') {
    return <img className="brand__logo" src="/images/labby-logo.png" alt={t('app.title')} />;
  }
  return <img className="brand__mark" src="/images/labby-icon.png" alt={t('app.brandName')} />;
}

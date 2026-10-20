import { useTranslation } from 'react-i18next';

/**
 * The Labby brand mark: an accent square with the "L" (design system
 * 2026-10-07). Exposed to assistive tech as the brand image: "Labby" / "لبي" (M15-T4).
 */
export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { t } = useTranslation();
  return (
    <span
      className={size === 'lg' ? 'brand__mark brand__mark--lg' : 'brand__mark'}
      role="img"
      aria-label={t('app.brandName')}
    >
      <span aria-hidden="true">L</span>
    </span>
  );
}

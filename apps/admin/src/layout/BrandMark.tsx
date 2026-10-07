/**
 * The Labby brand mark: an accent square with the "L" (design system
 * 2026-10-07). Exposed to assistive tech as the "Labby" image.
 */
export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span
      className={size === 'lg' ? 'brand__mark brand__mark--lg' : 'brand__mark'}
      role="img"
      aria-label="Labby"
    >
      <span aria-hidden="true">L</span>
    </span>
  );
}

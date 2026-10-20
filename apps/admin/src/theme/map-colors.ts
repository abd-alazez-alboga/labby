/**
 * The token colours the Leaflet maps and inline SVGs need as literal values (path options and
 * divIcon HTML cannot read CSS variables). Each mirrors a token in tokens.css — keep them in step.
 */
export const MAP_COLORS = {
  /** --labby-accent: Labby purple, the one accent (design canvas 2026-10-07). */
  accent: '#59128A',
  /** --labby-text-secondary: the to-pickup leg and pickup ring. */
  muted: '#463C58',
  /** --labby-surface / --labby-on-accent. */
  surface: '#FFFFFF',
  /** --labby-sos: the owner-approved functional safety red (M10 canvas) — SOS only. */
  sos: '#D92D20',
  /** The neutral guide outline behind a polygon being edited. */
  guide: '#6B7280',
} as const;

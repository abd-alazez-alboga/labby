/** Surge domain slice (M9): the live-state facade, overlay shape and formatting. */
export {
  CYCLE_GRACE_MS,
  FALLBACK_REFRESH_MS,
  nextRefreshDelay,
  useSurgeState,
  type SurgeStateFacade,
} from './use-surge-state';
export {
  surgeLevel,
  surgeStrength,
  toSurgeOverlay,
  type SurgeLevel,
  type SurgeOverlayZone,
} from './surge-overlay';
export {
  effectiveCap,
  formatClock,
  formatMultiplier,
  formatSince,
  isolateLtr,
  parseMultiplier,
} from './surge-format';

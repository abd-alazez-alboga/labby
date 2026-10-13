/** Surge domain slice (M9): the live-state facade, overlay shape and formatting. */
export {
  CYCLE_GRACE_MS,
  cyclePeriod,
  FALLBACK_REFRESH_MS,
  INITIAL_REFRESH_TRACK,
  latestComputedAt,
  MIN_REFRESH_MS,
  nextRefreshDelay,
  planNextRead,
  STALE_RETRY_MS,
  type RefreshTrack,
  useSurgeState,
  type SurgeStateFacade,
} from './use-surge-state';
export {
  surgeBand,
  surgeStrength,
  toSurgeOverlay,
  type SurgeBand,
  type SurgeOverlayZone,
} from './surge-overlay';
export {
  formatClock,
  formatMultiplier,
  formatSince,
  isolateLtr,
  parseMultiplier,
} from './surge-format';

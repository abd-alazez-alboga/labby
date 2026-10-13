import { useTranslation } from 'react-i18next';

import { StatusChip } from '../../ui';
import { formatClock, formatMultiplier } from './surge-format';
import type { SurgeLevel } from './surge-overlay';

/** A multiplier ("1.5×"), always laid out left-to-right. */
export function Multiplier({ value }: { value: number }) {
  const { i18n } = useTranslation();
  return <span dir="ltr">{formatMultiplier(value, i18n.language)}</span>;
}

/** The "Now" chip: solid accent at the cap, accent tint while surging, plain at 1.0×. */
export function SurgeNowChip({ value, level }: { value: number; level: SurgeLevel }) {
  return (
    <span className={`surge-now surge-now--${level}`} data-level={level}>
      <Multiplier value={value} />
    </span>
  );
}

/** "applies at 12:42" — when an override change lands (the next cycle). */
export function PendingChip({ nextCycleAt }: { nextCycleAt: string | null }) {
  const { t, i18n } = useTranslation();
  return (
    <StatusChip tone="warning">
      {nextCycleAt
        ? t('surgeLive.appliesAt', { time: formatClock(nextCycleAt, i18n.language) })
        : t('surgeLive.appliesNextCycle')}
    </StatusChip>
  );
}

import { useTranslation } from 'react-i18next';

import type { FloorStatus } from '../../api/money';
import type { AdminRideSummary } from '../../api/rides';
import { StatusChip, type ChipTone } from '../../ui';
import { formatMoment, formatMoney, formatNumber, formatSigned } from './money-format';
import { useCurrencyLabel } from './use-currency-label';

/**
 * An amount, always rendered `dir="ltr"` (owner ruling 2026-10-11: Western
 * digits + LTR amounts inside the Arabic UI). `signed` shows +/− for ledger
 * columns; `currency` prefixes the translated currency label.
 */
export function Money({
  amount,
  currency,
  signed = false,
}: {
  amount: number;
  currency?: string;
  signed?: boolean;
}) {
  const { i18n } = useTranslation();
  const currencyLabel = useCurrencyLabel();
  const text = signed
    ? formatSigned(amount, i18n.language)
    : currency
      ? formatMoney(amount, currencyLabel(currency), i18n.language)
      : formatNumber(amount, i18n.language);
  return <span dir="ltr">{text}</span>;
}

const FLOOR_TONES: Record<FloorStatus, ChipTone> = {
  ok: 'success',
  warning: 'warning',
  blocked: 'danger',
};

/** COM-03 floor status as a chip: ok / near the floor / blocked. */
export function FloorStatusChip({ status }: { status: FloorStatus }) {
  const { t } = useTranslation();
  return <StatusChip tone={FLOOR_TONES[status]}>{t(`money.floor.${status}`)}</StatusChip>;
}

/**
 * Display label of a ride reference in a transaction/ledger row: the ride's
 * request moment when the ride is known (loaded via rides:view), otherwise
 * the id's short prefix — there is no admin rides screen to link until
 * M10-T4, so the reference stays plain text.
 */
export function RideRef({
  rideId,
  rides,
}: {
  rideId: string | null | undefined;
  rides: ReadonlyMap<string, AdminRideSummary>;
}) {
  const { t, i18n } = useTranslation();
  if (!rideId) {
    return <span className="table__muted">—</span>;
  }
  const ride = rides.get(rideId);
  const label = ride
    ? t('money.rideRef', { when: formatMoment(ride.requestedAt, i18n.language) })
    : t('money.rideRef', { when: rideId.slice(0, 8) });
  return <span dir="ltr">{label}</span>;
}

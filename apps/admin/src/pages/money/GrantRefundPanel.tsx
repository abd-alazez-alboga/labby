import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { postWalletCredit, type WalletCreditType, type WalletTransaction } from '../../api/money';
import type { AdminRideDetail, AdminRideSummary } from '../../api/rides';
import { useAuth } from '../../auth/AuthContext';
import { DecisionPanel, StatusChip } from '../../ui';
import { rideRef } from '../rides/ride-format';
import { classifyError } from '../onboarding/review-utils';
import { formatMoment, formatMoney, isUuid, parseAmount, rejectionDetail } from './money-format';
import { useCurrencyLabel } from './use-currency-label';

/** The ride select's "type the ID instead" option (rides beyond the newest page). */
const ENTER_RIDE_ID = '__enter-ride-id__';

/**
 * The ride a refund was opened from (the ride detail's "Refund rider", V1
 * audit W28): pre-selects Refund and the ride; its detail (when readable)
 * gives the amount hint.
 */
export interface RefundFromRide {
  rideId: string;
  detail: AdminRideDetail | null;
}

/** The amount hint: the ride's total and how it was paid, or its cancellation fee. */
function rideAmountHint(detail: AdminRideDetail): { key: string; amount: number } | null {
  const { ride } = detail;
  if (ride.fare) {
    switch (ride.paymentStatus) {
      case 'paid_wallet':
        return { key: 'money.panel.rideTotalWallet', amount: ride.fare.components.total };
      case 'paid_cash':
        return { key: 'money.panel.rideTotalCash', amount: ride.fare.components.total };
      case 'paid_mixed':
        return { key: 'money.panel.rideTotalMixed', amount: ride.fare.components.total };
      default:
        return { key: 'money.panel.rideTotal', amount: ride.fare.components.total };
    }
  }
  return ride.cancellationFee
    ? { key: 'money.panel.rideCancellationFee', amount: ride.cancellationFee }
    : null;
}

/**
 * UC-A-15 side panel: grant wallet credit or issue a refund. A refund MUST
 * link one of the user's rides (PAY-03) and both need a reason the user will
 * see. Rendered only with `wallets:manage` (the server enforces the same
 * code); the backend notifies the user and audit-logs the action. A refund
 * linked to a listed ride is locked to that ride's currency (the server
 * rejects a mismatch). Opened from a ride (W28) it starts on Refund with the
 * ride linked — amount and reason stay for the admin to fill.
 */
export function GrantRefundPanel({
  userId,
  currencies,
  rides,
  onCredited,
  initialReason = '',
  fromRide,
}: {
  userId: string;
  /** Currencies offered in the form; the wallet's, defaulting to SYP. */
  currencies: readonly string[];
  /**
   * The rides the user TOOK (as rider) for the link select — the only ones
   * the server accepts; null = not loadable (no rides:view).
   */
  rides: readonly AdminRideSummary[] | null;
  /** Called with the created transaction so the page refreshes instantly. */
  onCredited: (transaction: WalletTransaction) => void;
  /** Pre-filled reason — the M14 ticket remedy deep link (UC-A-21 A2). */
  initialReason?: string;
  /** Opened from a ride detail: Refund + that ride pre-selected (W28). */
  fromRide?: RefundFromRide;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const currencyLabel = useCurrencyLabel();

  const [type, setType] = useState<WalletCreditType>(fromRide ? 'refund' : 'grant');
  const [amountRaw, setAmountRaw] = useState('');
  const [currency, setCurrency] = useState(currencies[0] ?? 'SYP');
  // The select's value: '' (none), a listed ride id, or ENTER_RIDE_ID.
  const [rideChoice, setRideChoice] = useState(fromRide?.rideId ?? '');
  // The typed ride ID — the only input without rides:view.
  const [typedRideId, setTypedRideId] = useState(fromRide?.rideId ?? '');
  const [reason, setReason] = useState(initialReason);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const typingRideId = rides === null || rideChoice === ENTER_RIDE_ID;
  const linkedRide = (typingRideId ? typedRideId : rideChoice).trim();
  const linkedSummary = rides?.find((ride) => ride.id === linkedRide);
  // Spec D: a refund's currency must equal its linked ride's currency.
  const lockedCurrency = type === 'refund' ? (linkedSummary?.currency ?? null) : null;
  const effectiveCurrency = lockedCurrency ?? currency;
  const currencyOptions =
    lockedCurrency !== null && !currencies.includes(lockedCurrency)
      ? [...currencies, lockedCurrency]
      : currencies;

  // The "opened from ride" notice holds while that pre-selection stands.
  const selectedFromRide =
    fromRide && type === 'refund' && linkedRide === fromRide.rideId ? fromRide : null;
  const amountHint = selectedFromRide?.detail ? rideAmountHint(selectedFromRide.detail) : null;

  const amount = parseAmount(amountRaw);
  const submitLabel =
    amount !== null
      ? t('money.panel.submit', {
          amount: formatMoney(amount, currencyLabel(effectiveCurrency), i18n.language),
        })
      : t('money.panel.submitBare');

  function rideOptionLabel(ride: AdminRideSummary): string {
    const when = formatMoment(ride.requestedAt, i18n.language);
    const extra = ride.destination.label ?? t(`money.rideState.${ride.state}`);
    return `${t('money.rideRef', { when })} · ${extra}`;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    setErrorDetail(null);
    if (amount === null) {
      setErrorKey('money.panel.amountInvalid');
      return;
    }
    if (reason.trim() === '') {
      setErrorKey('money.panel.reasonRequired');
      return;
    }
    if (type === 'refund' && linkedRide === '') {
      setErrorKey('money.panel.rideRequired');
      return;
    }
    if (typingRideId && linkedRide !== '' && !isUuid(linkedRide)) {
      setErrorKey('money.panel.rideIdInvalid');
      return;
    }
    setErrorKey(null);
    setBusy(true);
    try {
      const transaction = await postWalletCredit(apiClient, userId, {
        type,
        amount,
        currency: effectiveCurrency,
        reason: reason.trim(),
        rideId: linkedRide === '' ? null : linkedRide,
      });
      setSuccess(
        t('money.panel.success', {
          amount: formatMoney(
            transaction.amount,
            currencyLabel(transaction.currency),
            i18n.language,
          ),
        }),
      );
      setAmountRaw('');
      setReason('');
      setRideChoice('');
      setTypedRideId('');
      onCredited(transaction);
    } catch (error) {
      const kind = classifyError(error);
      setErrorDetail(rejectionDetail(error, i18n.language));
      setErrorKey(
        kind === 'validation'
          ? 'money.panel.rejected'
          : kind === 'network'
            ? 'review.decisionErrors.network'
            : kind === 'forbidden'
              ? 'review.decisionErrors.forbidden'
              : 'review.decisionErrors.server',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DecisionPanel
      title={
        fromRide ? (
          <span className="decision-panel__title-row">
            {t('money.panel.title')}
            <StatusChip tone="accent">{t('money.panel.fromRideChip')}</StatusChip>
          </span>
        ) : (
          t('money.panel.title')
        )
      }
      label={t('money.panel.title')}
    >
      <form className="decision-panel__actions" onSubmit={(event) => void submit(event)}>
        {selectedFromRide ? (
          <p className="banner from-ride-notice" role="status">
            {t('money.panel.fromRide')} <bdi dir="ltr">{rideRef(selectedFromRide.rideId)}</bdi>
            {t('money.panel.fromRideEnd')}
          </p>
        ) : null}
        <div className="segmented" role="group" aria-label={t('money.panel.typeLabel')}>
          {(['grant', 'refund'] as const).map((option) => (
            <button
              key={option}
              className="segmented__option"
              type="button"
              aria-pressed={type === option}
              onClick={() => setType(option)}
            >
              {t(`money.panel.${option}`)}
            </button>
          ))}
        </div>

        <div className="form-field">
          <label htmlFor="credit-amount">
            {t('money.panel.amountLabel', { currency: currencyLabel(effectiveCurrency) })}
          </label>
          <input
            id="credit-amount"
            dir="ltr"
            inputMode="decimal"
            value={amountRaw}
            onChange={(event) => setAmountRaw(event.target.value)}
            aria-describedby={amountHint ? 'credit-amount-hint' : undefined}
          />
          {amountHint && selectedFromRide?.detail ? (
            <p id="credit-amount-hint" className="panel__hint">
              {t(amountHint.key, {
                amount: formatMoney(
                  amountHint.amount,
                  currencyLabel(selectedFromRide.detail.ride.estimate.components.currency),
                  i18n.language,
                ),
              })}
            </p>
          ) : null}
        </div>

        {currencyOptions.length > 1 ? (
          <div className="form-field">
            <label htmlFor="credit-currency">{t('money.panel.currencyLabel')}</label>
            <select
              id="credit-currency"
              value={effectiveCurrency}
              disabled={lockedCurrency !== null}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencyOptions.map((code) => (
                <option key={code} value={code}>
                  {currencyLabel(code)}
                </option>
              ))}
            </select>
            {lockedCurrency !== null ? (
              <p className="panel__hint">{t('money.panel.currencyFromRide')}</p>
            ) : null}
          </div>
        ) : null}

        <div className="form-field">
          <label htmlFor="credit-ride">
            {t(type === 'refund' ? 'money.panel.rideLabelRefund' : 'money.panel.rideLabelGrant')}
          </label>
          {rides !== null ? (
            <select
              id="credit-ride"
              value={rideChoice}
              onChange={(event) => setRideChoice(event.target.value)}
            >
              <option value="">{t('money.panel.noRide')}</option>
              {rides.map((ride) => (
                <option key={ride.id} value={ride.id}>
                  {rideOptionLabel(ride)}
                </option>
              ))}
              <option value={ENTER_RIDE_ID}>{t('money.panel.enterRideId')}</option>
            </select>
          ) : null}
          {typingRideId ? (
            <input
              id={rides === null ? 'credit-ride' : 'credit-ride-id'}
              aria-label={rides === null ? undefined : t('money.panel.rideIdPlaceholder')}
              dir="ltr"
              value={typedRideId}
              placeholder={t('money.panel.rideIdPlaceholder')}
              onChange={(event) => setTypedRideId(event.target.value)}
            />
          ) : null}
        </div>

        <div className="form-field">
          <label htmlFor="credit-reason">{t('money.panel.reasonLabel')}</label>
          <textarea
            id="credit-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {errorKey ? (
          <p className="banner banner--error" role="alert">
            {t(errorKey)}
            {errorDetail ? (
              <span className="banner__detail" dir="auto">
                {errorDetail}
              </span>
            ) : null}
          </p>
        ) : null}
        {success ? (
          <p className="banner banner--success" role="status">
            {success}
          </p>
        ) : null}

        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
          {submitLabel}
        </button>
        <p className="panel__hint">{t('money.panel.audited')}</p>
      </form>
    </DecisionPanel>
  );
}

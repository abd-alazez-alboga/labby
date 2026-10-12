import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { postWalletCredit, type WalletCreditType, type WalletTransaction } from '../../api/money';
import type { AdminRideSummary } from '../../api/rides';
import { useAuth } from '../../auth/AuthContext';
import { DecisionPanel } from '../../ui';
import { classifyError } from '../onboarding/review-utils';
import { formatMoment, formatMoney, isUuid, parseAmount } from './money-format';
import { useCurrencyLabel } from './use-currency-label';

/**
 * UC-A-15 side panel: grant wallet credit or issue a refund. A refund MUST
 * link one of the user's rides (PAY-03) and both need a reason the user will
 * see. Rendered only with `wallets:manage` (the server enforces the same
 * code); the backend notifies the user and audit-logs the action.
 */
export function GrantRefundPanel({
  userId,
  currencies,
  rides,
  onCredited,
}: {
  userId: string;
  /** Currencies offered in the form; the wallet's, defaulting to SYP. */
  currencies: readonly string[];
  /** The user's rides for the link select; null = not loadable (no rides:view). */
  rides: readonly AdminRideSummary[] | null;
  /** Called with the created transaction so the page refreshes instantly. */
  onCredited: (transaction: WalletTransaction) => void;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const currencyLabel = useCurrencyLabel();

  const [type, setType] = useState<WalletCreditType>('grant');
  const [amountRaw, setAmountRaw] = useState('');
  const [currency, setCurrency] = useState(currencies[0] ?? 'SYP');
  const [rideId, setRideId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const amount = parseAmount(amountRaw);
  const submitLabel =
    amount !== null
      ? t('money.panel.submit', {
          amount: formatMoney(amount, currencyLabel(currency), i18n.language),
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
    if (amount === null) {
      setErrorKey('money.panel.amountInvalid');
      return;
    }
    if (reason.trim() === '') {
      setErrorKey('money.panel.reasonRequired');
      return;
    }
    const linkedRide = rideId.trim();
    if (type === 'refund' && (linkedRide === '' || (rides === null && !isUuid(linkedRide)))) {
      setErrorKey('money.panel.rideRequired');
      return;
    }
    setErrorKey(null);
    setBusy(true);
    try {
      const transaction = await postWalletCredit(apiClient, userId, {
        type,
        amount,
        currency,
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
      setRideId('');
      onCredited(transaction);
    } catch (error) {
      const kind = classifyError(error);
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
    <DecisionPanel title={t('money.panel.title')} label={t('money.panel.title')}>
      <form className="decision-panel__actions" onSubmit={(event) => void submit(event)}>
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
            {t('money.panel.amountLabel', { currency: currencyLabel(currency) })}
          </label>
          <input
            id="credit-amount"
            dir="ltr"
            inputMode="decimal"
            value={amountRaw}
            onChange={(event) => setAmountRaw(event.target.value)}
          />
        </div>

        {currencies.length > 1 ? (
          <div className="form-field">
            <label htmlFor="credit-currency">{t('money.panel.currencyLabel')}</label>
            <select
              id="credit-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {currencyLabel(code)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="form-field">
          <label htmlFor="credit-ride">
            {t(type === 'refund' ? 'money.panel.rideLabelRefund' : 'money.panel.rideLabelGrant')}
          </label>
          {rides !== null ? (
            <select
              id="credit-ride"
              value={rideId}
              onChange={(event) => setRideId(event.target.value)}
            >
              <option value="">{t('money.panel.noRide')}</option>
              {rides.map((ride) => (
                <option key={ride.id} value={ride.id}>
                  {rideOptionLabel(ride)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="credit-ride"
              dir="ltr"
              value={rideId}
              placeholder={t('money.panel.rideIdPlaceholder')}
              onChange={(event) => setRideId(event.target.value)}
            />
          )}
        </div>

        <div className="form-field">
          <label htmlFor="credit-reason">{t('money.panel.reasonLabel')}</label>
          <textarea
            id="credit-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {errorKey ? (
          <p className="banner banner--error" role="alert">
            {t(errorKey)}
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

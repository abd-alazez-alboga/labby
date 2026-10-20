import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  postSettlement,
  type DriverBalanceEntry,
  type SettlementDirection,
  type SettlementResponse,
} from '../../api/money';
import { useAuth } from '../../auth/AuthContext';
import { DecisionPanel } from '../../ui';
import { classifyError } from '../onboarding/review-utils';
import { formatMoney, parseAmount, rejectionDetail } from './money-format';
import { useCurrencyLabel } from './use-currency-label';

/**
 * UC-A-27 side panel: record an off-app settlement (COM-04). Pay-in credits
 * the balance, pay-out debits it; settlements are immutable (corrections =
 * counter-settlement) and audit-logged server-side. The "After recording"
 * preview and the success notice give the instant floor-status feedback the
 * ticket asks for — including the offers-resume note when a blocked driver
 * crosses back above the floor. Rendered only with `settlements:record`.
 */
export function SettlementPanel({
  driverUserId,
  balance,
  currency,
  onRecorded,
}: {
  driverUserId: string;
  /** The balance entry of the selected currency; null when none exists yet. */
  balance: DriverBalanceEntry | null;
  /** The currency a settlement is recorded in (the page's selected one). */
  currency: string;
  /** Called with the response so the page updates balances instantly. */
  onRecorded: (response: SettlementResponse) => void;
}) {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();
  const currencyLabel = useCurrencyLabel();

  const [direction, setDirection] = useState<SettlementDirection>('pay_in');
  const [amountRaw, setAmountRaw] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const amount = parseAmount(amountRaw);
  const money = (value: number) => formatMoney(value, currencyLabel(currency), i18n.language);
  const submitLabel =
    amount !== null
      ? t(direction === 'pay_in' ? 'money.settle.submitPayIn' : 'money.settle.submitPayOut', {
          amount: money(amount),
        })
      : t('money.settle.submitBare');

  // Instant floor feedback BEFORE recording: the projected balance vs floor.
  const projected =
    amount !== null && balance !== null
      ? balance.balance + (direction === 'pay_in' ? amount : -amount)
      : null;
  const previewKey =
    projected === null || balance === null
      ? null
      : projected > balance.floor
        ? balance.status === 'blocked'
          ? 'money.settle.previewResume'
          : 'money.settle.previewAbove'
        : 'money.settle.previewBelow';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    setErrorDetail(null);
    if (amount === null) {
      setErrorKey('money.settle.amountInvalid');
      return;
    }
    setErrorKey(null);
    setBusy(true);
    const previousStatus = balance?.status ?? null;
    try {
      const trimmed = note.trim();
      const response = await postSettlement(apiClient, driverUserId, {
        amount,
        direction,
        currency,
        note: trimmed === '' ? null : trimmed,
      });
      const key =
        response.floorStatus === 'blocked'
          ? 'money.settle.successBlocked'
          : previousStatus === 'blocked'
            ? 'money.settle.successResumed'
            : 'money.settle.successOk';
      setSuccess(t(key, { balance: money(response.balance) }));
      setAmountRaw('');
      setNote('');
      onRecorded(response);
    } catch (error) {
      const kind = classifyError(error);
      setErrorDetail(rejectionDetail(error, i18n.language));
      setErrorKey(
        kind === 'validation'
          ? 'money.settle.rejected'
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
    <DecisionPanel title={t('money.settle.title')} label={t('money.settle.title')}>
      <form className="decision-panel__actions" onSubmit={(event) => void submit(event)}>
        <div className="segmented" role="group" aria-label={t('money.settle.directionLabel')}>
          {(['pay_in', 'pay_out'] as const).map((option) => (
            <button
              key={option}
              className="segmented__option"
              type="button"
              aria-pressed={direction === option}
              onClick={() => setDirection(option)}
            >
              {t(option === 'pay_in' ? 'money.settle.payIn' : 'money.settle.payOut')}
            </button>
          ))}
        </div>
        <p className="panel__hint">{t('money.settle.explainer')}</p>

        <div className="form-field">
          <label htmlFor="settlement-amount">
            {t('money.settle.amountLabel', { currency: currencyLabel(currency) })}
          </label>
          <input
            id="settlement-amount"
            dir="ltr"
            inputMode="decimal"
            value={amountRaw}
            onChange={(event) => setAmountRaw(event.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="settlement-note">{t('money.settle.noteLabel')}</label>
          <input
            id="settlement-note"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {previewKey !== null && projected !== null ? (
          <p
            className={
              previewKey === 'money.settle.previewBelow'
                ? 'banner banner--info'
                : 'banner banner--success'
            }
            role="status"
          >
            <strong>{t('money.settle.previewTitle')}</strong>{' '}
            {t(previewKey, { balance: money(projected) })}
          </p>
        ) : null}

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
        <p className="panel__hint">{t('money.settle.immutable')}</p>
      </form>
    </DecisionPanel>
  );
}

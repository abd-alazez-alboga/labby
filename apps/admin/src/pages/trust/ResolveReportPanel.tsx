import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveAdminReport, type AdminReport, type ReportOutcome } from '../../api/trust';
import { useAuth } from '../../auth/AuthContext';
import { DecisionPanel } from '../../ui';
import { conflictCode, decisionErrorKey } from './trust-format';

const OUTCOMES: readonly ReportOutcome[] = ['substantiated', 'unsubstantiated'];

/**
 * REP-02 resolve form (`reports:handle` — the page gates): outcome +
 * mandatory internal note, final once saved. The reporter learns the outcome
 * only; the backend audit-logs the decision. A 409 `already_resolved` means
 * another admin won — the page reloads to show their decision.
 */
export function ResolveReportPanel({
  report,
  onResolved,
  onConflict,
}: {
  report: AdminReport;
  onResolved: (report: AdminReport) => void;
  onConflict: () => void;
}) {
  const { t } = useTranslation();
  const { apiClient } = useAuth();
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (outcome === null) {
      setErrorKey('reportDetail.resolve.outcomeRequired');
      return;
    }
    if (note.trim() === '') {
      setErrorKey('reportDetail.resolve.noteRequired');
      return;
    }
    setErrorKey(null);
    setBusy(true);
    try {
      const resolved = await resolveAdminReport(apiClient, report.id, outcome, note.trim());
      onResolved(resolved);
    } catch (error) {
      if (conflictCode(error) === 'already_resolved') {
        setErrorKey('reportDetail.resolve.alreadyResolved');
        onConflict();
      } else {
        setErrorKey(decisionErrorKey(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <DecisionPanel title={t('reportDetail.resolve.title')} label={t('reportDetail.resolve.title')}>
      <form className="decision-panel__actions" onSubmit={(event) => void submit(event)} noValidate>
        <fieldset className="choice-group">
          <legend className="choice-group__legend">{t('reportDetail.resolve.outcomeLabel')}</legend>
          {OUTCOMES.map((option) => (
            <label key={option} className="choice">
              <input
                type="radio"
                name="report-outcome"
                value={option}
                checked={outcome === option}
                onChange={() => setOutcome(option)}
              />
              {t(`reports.status.${option}`)}
            </label>
          ))}
        </fieldset>
        <div className="form-field">
          <label htmlFor="report-note">{t('reportDetail.resolve.noteLabel')}</label>
          <textarea
            id="report-note"
            rows={4}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        {errorKey ? (
          <p className="banner banner--error" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
          {busy
            ? t('review.working')
            : outcome
              ? t(`reportDetail.resolve.submit.${outcome}`)
              : t('reportDetail.resolve.submitBare')}
        </button>
        <p className="panel__hint">
          {t('reportDetail.resolve.finalHint', { name: report.reporter.name })}
        </p>
      </form>
    </DecisionPanel>
  );
}

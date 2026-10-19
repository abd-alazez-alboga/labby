import { useTranslation } from 'react-i18next';

import { formatNumber } from '../money/money-format';
import type { CsvExportState } from './use-csv-export';

/** The outlined "Export CSV" header button (approved board A15*). */
export function ExportCsvButton({
  state,
  disabledHint,
}: {
  state: CsvExportState;
  /** Why the current view cannot be exported (the button is disabled). */
  disabledHint?: string;
}) {
  const { t } = useTranslation();
  if (!state.allowed) {
    return null;
  }
  return (
    <button
      className="btn export-btn"
      type="button"
      disabled={state.busy || disabledHint !== undefined}
      title={disabledHint}
      onClick={state.run}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M2.5 13.5h11"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {state.busy ? t('exports.preparing') : t('exports.button')}
    </button>
  );
}

/** The error banner under the header (board "Export too large"). */
export function ExportFailureBanner({ state }: { state: CsvExportState }) {
  const { t, i18n } = useTranslation();
  const failure = state.failure;
  if (failure === null) {
    return null;
  }
  let title: string;
  let body: string;
  if (failure.kind === 'too_large') {
    title = t('exports.tooLargeTitle');
    body =
      failure.rows !== null && failure.limit !== null
        ? t('exports.tooLargeBody', {
            rows: formatNumber(failure.rows, i18n.language),
            limit: formatNumber(failure.limit, i18n.language),
          })
        : t('exports.tooLargeBodyPlain');
  } else if (failure.kind === 'timeout') {
    title = t('exports.timeoutTitle');
    body = t('exports.timeoutBody');
  } else {
    title = t('exports.failedTitle');
    body = t('exports.failedBody');
  }
  return (
    <div className="export-banner" role="alert">
      <span className="export-banner__icon" aria-hidden="true">
        !
      </span>
      <div className="export-banner__text">
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      <button className="btn btn--small" type="button" onClick={state.dismiss}>
        {t('exports.dismiss')}
      </button>
    </div>
  );
}

import { useCallback, useState } from 'react';

import { exportCsv, type ExportList } from '../../api/analytics';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { usePermissions } from '../../auth/usePermissions';
import { formatNumber } from '../money/money-format';

/** Why the last export failed: too many rows (422), too slow (503) or anything else. */
export type ExportFailure =
  | { kind: 'too_large'; rows: number | null; limit: number | null }
  | { kind: 'timeout' }
  | { kind: 'failed' };

export interface CsvExportState {
  /** Whether the signed-in admin may export at all (`analytics:export`). */
  allowed: boolean;
  busy: boolean;
  failure: ExportFailure | null;
  run(): void;
  dismiss(): void;
}

function numberDetail(error: ApiError, key: string): number | null {
  const value = error.details?.[key];
  return typeof value === 'number' ? value : null;
}

/** Saves a downloaded file through a temporary object-URL link. */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers start the download after click() returns: revoke on a later task.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * One list's CSV export (ADM-06, UC-A-31): `filter` must be the exact filter
 * the list is showing, so the file holds the rows on screen (every page).
 * The server checks `analytics:export` + the list's view permission and
 * writes the audit entry; the UI only hides the button without the permission.
 */
export function useCsvExport(list: ExportList, filter: object): CsvExportState {
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ExportFailure | null>(null);

  const run = useCallback(() => {
    setBusy(true);
    setFailure(null);
    exportCsv(apiClient, list, filter)
      .then((file) => save(file.blob, file.filename ?? `labby-${list}.csv`))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'export_too_large') {
          setFailure({
            kind: 'too_large',
            rows: numberDetail(error, 'rows'),
            limit: numberDetail(error, 'limit'),
          });
        } else if (error instanceof ApiError && error.code === 'query_timeout') {
          setFailure({ kind: 'timeout' });
        } else {
          setFailure({ kind: 'failed' });
        }
      })
      .finally(() => setBusy(false));
  }, [apiClient, list, filter]);

  return {
    allowed: can('analytics:export'),
    busy,
    failure,
    run,
    dismiss: () => setFailure(null),
  };
}

/** The footer note "Export CSV downloads all N matching …" (only for exporters). */
export function exportNote(
  state: CsvExportState,
  t: (key: string, options?: Record<string, unknown>) => string,
  noun: 'rides' | 'users' | 'drivers' | 'rows' | 'tickets',
  total: number,
  language: string,
): string | null {
  return state.allowed && total > 0
    ? t(`exports.note.${noun}`, { total: formatNumber(total, language) })
    : null;
}

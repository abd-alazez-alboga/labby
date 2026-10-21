import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { listAdminReports, REPORT_STATUSES, type AdminReportSummary } from '../../api/trust';
import { useAuth } from '../../auth/AuthContext';
import { usePermissions } from '../../auth/usePermissions';
import { DataTable } from '../../ui';
import { formatDay } from '../money/money-format';
import { rideRef } from '../rides/ride-format';
import { PartyName, ReportStatusChip } from './TrustUi';

/** How many reports of each status the profile reads (the queue filters one status per call). */
const PER_STATUS = 50;

/** The reports the user FILED, as rider or driver, every status, newest first (`reports:view`). */
function useReportsMade(userId: string, refresh: number) {
  const { apiClient } = useAuth();
  const [made, setMade] = useState<{ items: AdminReportSummary[]; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMade(null);
    Promise.all(
      REPORT_STATUSES.map((status) =>
        listAdminReports(apiClient, { status, reporterUserId: userId, size: PER_STATUS }),
      ),
    )
      .then((pages) => {
        if (!cancelled) {
          setMade({
            items: pages
              .flatMap((page) => page.items)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
            total: pages.reduce((sum, page) => sum + page.totalElements, 0),
          });
        }
      })
      .catch(() => {
        // The section stays hidden; the rest of the profile stands.
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, userId, refresh]);

  return made;
}

/**
 * UC-A-13 "reports (made/received)" — the made half (V1 audit W4, board
 * V1FAdminUserReportsLedger): category (opens the report), who it is about,
 * the ride, status and filing date. The caller renders it with `reports:view`.
 */
export function ReportsMadeSection({ userId, refresh }: { userId: string; refresh: number }) {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const canRides = can('rides:view');
  const made = useReportsMade(userId, refresh);

  if (made === null) {
    return null;
  }

  return (
    <DataTable
      title={t('trust.sections.reportsMade')}
      actions={
        <span className="panel__hint">
          {t('trust.sections.reportsMadeCount', { total: made.total })}
        </span>
      }
      isEmpty={made.items.length === 0}
      empty={t('trust.sections.reportsMadeEmpty')}
    >
      <thead>
        <tr>
          <th>{t('trust.reportsMade.category')}</th>
          <th>{t('trust.reportsMade.about')}</th>
          <th>{t('trust.reportsMade.ride')}</th>
          <th>{t('trust.reportsMade.status')}</th>
          <th>{t('trust.reportsMade.filed')}</th>
        </tr>
      </thead>
      <tbody>
        {made.items.map((report) => (
          <tr key={report.id}>
            <td>
              <Link className="table__link" to={`/reports/${report.id}`}>
                {t(`reports.category.${report.category}`)}
              </Link>
            </td>
            <td>
              <PartyName party={report.reported} />
              <span className="table__muted">
                {' · '}
                {t(`trust.role.${report.reported.role}`)}
              </span>
            </td>
            <td>
              {canRides ? (
                <Link className="table__link" to={`/rides/${report.rideId}`} dir="ltr">
                  {rideRef(report.rideId)}
                </Link>
              ) : (
                <span dir="ltr">{rideRef(report.rideId)}</span>
              )}
            </td>
            <td>
              <ReportStatusChip status={report.status} />
            </td>
            <td className="table__muted table__num">
              {formatDay(report.createdAt, i18n.language)}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

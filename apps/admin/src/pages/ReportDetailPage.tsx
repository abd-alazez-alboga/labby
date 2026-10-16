import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { resolveFileUrl } from '../api/onboarding';
import {
  getAdminReport,
  type AdminReport,
  type PartySummary,
  type ReportHistory,
} from '../api/trust';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useConfig } from '../config/ConfigContext';
import { ReviewLayout, Section } from '../ui';
import { formatMoment } from './money/money-format';
import { LoadFailure } from './onboarding/ReviewUi';
import { classifyError, type FailureKind } from './onboarding/review-utils';
import { ResolveReportPanel } from './trust/ResolveReportPanel';
import { RideEvidence } from './trust/RideEvidence';
import { PartyName, ReportStatusChip } from './trust/TrustUi';

/**
 * UC-A-17 steps 2–3: one report — what the reporter wrote + photos, the
 * ride evidence (trace via `rides:view`, chat log via `support:view`), both
 * parties' prior history, and the resolve form for `reports:handle`. A
 * resolved report shows its final decision instead. `reports:view` (route).
 */
export default function ReportDetailPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { reportId = '' } = useParams<{ reportId: string }>();
  const { apiClient } = useAuth();
  const { apiBaseUrl } = useConfig();
  const { can } = usePermissions();
  const canHandle = can('reports:handle');

  const [report, setReport] = useState<AdminReport | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [resolvedNotice, setResolvedNotice] = useState(false);
  const [conflictNotice, setConflictNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getAdminReport(apiClient, reportId)
      .then((loaded) => {
        if (!cancelled) {
          setReport(loaded);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(classifyError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, reportId, attempt]);

  const category = report ? t(`reports.category.${report.category}`) : '';
  const breadcrumb = (
    <nav className="breadcrumb" aria-label={t('surgeLive.breadcrumbLabel')}>
      <Link to="/reports">{t('nav.reports')}</Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{category}</span>
    </nav>
  );

  if (report === null) {
    return (
      <section className="page">
        {breadcrumb}
        {loadError ? (
          <LoadFailure
            kind={loadError}
            notFoundKey="reportDetail.notFound"
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : (
          <div className="loading">{t('common.loading')}</div>
        )}
      </section>
    );
  }

  const rider = report.reporter.role === 'rider' ? report.reporter : report.reported;
  const driver = report.reporter.role === 'driver' ? report.reporter : report.reported;

  const statusLine =
    report.status === 'open'
      ? t('reportDetail.filed', { when: formatMoment(report.createdAt, language) })
      : t('reportDetail.resolvedOn', {
          when: report.resolvedAt ? formatMoment(report.resolvedAt, language) : '—',
        });

  return (
    <section className="page">
      {breadcrumb}
      <header className="page-header">
        <div className="page-header__main">
          <div className="page-header__text">
            <h1 className="page-header__title">{category}</h1>
          </div>
          <div className="page-header__meta ride-detail__chips">
            <ReportStatusChip status={report.status} />
            <span className="table__muted">{statusLine}</span>
          </div>
        </div>
      </header>

      {resolvedNotice ? (
        <p className="banner banner--success" role="status">
          {t('reportDetail.resolve.done', { outcome: t(`reports.status.${report.status}`) })}
        </p>
      ) : null}
      {conflictNotice ? (
        <p className="banner banner--error" role="alert">
          {t('reportDetail.resolve.alreadyResolved')}
        </p>
      ) : null}

      <ReviewLayout
        aside={
          <div className="review-layout__aside trust-aside">
            <section className="card section" aria-label={t('reportDetail.partiesLabel')}>
              <PartyBlock
                label={t('reportDetail.reported', {
                  role: t(`trust.role.${report.reported.role}`),
                })}
                party={report.reported}
                history={report.reportedHistory}
              />
              <div className="decision-panel__divider" />
              <PartyBlock
                label={t('reportDetail.reporter', {
                  role: t(`trust.role.${report.reporter.role}`),
                })}
                party={report.reporter}
                history={report.reporterHistory}
              />
            </section>

            {report.status !== 'open' ? (
              <section className="card section" aria-label={t('reportDetail.decisionTitle')}>
                <h2 className="section__heading">{t('reportDetail.decisionTitle')}</h2>
                <ReportStatusChip status={report.status} />
                {report.resolutionNote ? (
                  <p className="trust-note" dir="auto">
                    {report.resolutionNote}
                  </p>
                ) : null}
                <p className="panel__hint">
                  {t('reportDetail.decidedBy', {
                    name: report.resolvedBy?.name ?? '—',
                    when: report.resolvedAt ? formatMoment(report.resolvedAt, language) : '—',
                  })}
                </p>
              </section>
            ) : canHandle ? (
              <ResolveReportPanel
                report={report}
                onResolved={(resolved) => {
                  setReport(resolved);
                  setResolvedNotice(true);
                }}
                onConflict={() => {
                  // Another admin decided first: show their decision instead.
                  setConflictNotice(true);
                  setAttempt((n) => n + 1);
                }}
              />
            ) : null}
          </div>
        }
      >
        <Section title={t('reportDetail.wrote', { role: t(`trust.role.${report.reporter.role}`) })}>
          {report.description ? (
            <p className="trust-quote" dir="auto">
              {report.description}
            </p>
          ) : (
            <p className="panel__hint">{t('reportDetail.noText')}</p>
          )}
          {report.photoUrls.length > 0 ? (
            <div className="photo-strip">
              {report.photoUrls.map((url, index) => {
                const src = resolveFileUrl(url, apiBaseUrl);
                return (
                  <a
                    key={url}
                    className="file-view"
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      className="file-view__img"
                      src={src}
                      alt={t('reportDetail.photo', { n: index + 1 })}
                    />
                  </a>
                );
              })}
            </div>
          ) : null}
        </Section>

        <RideEvidence rideId={report.rideId} riderName={rider.name} driverName={driver.name} />
      </ReviewLayout>
    </section>
  );
}

function PartyBlock({
  label,
  party,
  history,
}: {
  label: string;
  party: PartySummary;
  history: ReportHistory;
}) {
  const { t } = useTranslation();
  return (
    <div className="party-block">
      <span className="party-block__label">{label}</span>
      <PartyName party={party} className="party-block__name" />
      <span className="party-block__history">
        {t('reportDetail.history', {
          against: history.reportsAgainst,
          substantiated: history.substantiatedAgainst,
          filed: history.reportsFiled,
        })}
      </span>
    </div>
  );
}

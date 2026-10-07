import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { listVehicleReviews, type VehicleReviewSummary } from '../api/onboarding';
import { useAuth } from '../auth/AuthContext';
import { DataTable, PageHeader, Plate } from '../ui';
import { ApplicantCell, DuplicatePlateChip, LoadFailure } from './onboarding/ReviewUi';
import { classifyError, formatDateTime, type FailureKind } from './onboarding/review-utils';

/**
 * UC-A-11 entry point: pending vehicle switches of approved drivers,
 * oldest first. Requires driver-review:view (the route guard).
 */
export default function VehicleReviewsPage() {
  const { t, i18n } = useTranslation();
  const { apiClient } = useAuth();

  const [items, setItems] = useState<VehicleReviewSummary[] | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setLoadError(null);
    listVehicleReviews(apiClient)
      .then((list) => {
        if (!cancelled) {
          setItems(list);
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
  }, [apiClient, attempt]);

  return (
    <section className="page">
      <PageHeader title={t('vehicleReviews.title')} description={t('vehicleReviews.subtitle')} />

      {loadError ? (
        <LoadFailure
          kind={loadError}
          notFoundKey="review.errors.server"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : items === null ? (
        <div className="loading">{t('common.loading')}</div>
      ) : (
        <>
          <p className="queue-count" role="status">
            {t('vehicleReviews.count', { total: items.length })}
          </p>
          <DataTable isEmpty={items.length === 0} empty={t('vehicleReviews.empty')}>
            <thead>
              <tr>
                <th>{t('vehicleReviews.columns.driver')}</th>
                <th>{t('vehicleReviews.columns.vehicle')}</th>
                <th>{t('vehicleReviews.columns.plate')}</th>
                <th>{t('vehicleReviews.columns.submitted')}</th>
                <th className="table__cell--action">
                  <span className="visually-hidden">{t('applications.columns.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.vehicleId}>
                  <td>
                    <ApplicantCell person={item.driver} />
                  </td>
                  <td dir="auto">
                    {item.make} {item.model}
                  </td>
                  <td>
                    <span className="chip-list">
                      <Plate value={item.plate} />
                      {item.duplicatePlate ? <DuplicatePlateChip /> : null}
                    </span>
                  </td>
                  <td className="table__muted">
                    {formatDateTime(item.submittedAt, i18n.language)}
                  </td>
                  <td className="table__cell--action">
                    <Link
                      className={index === 0 ? 'btn btn--primary' : 'btn'}
                      to={`/vehicle-reviews/${item.vehicleId}`}
                      aria-label={t('vehicleReviews.openFor', { name: item.driver.name })}
                    >
                      {t('applications.open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
    </section>
  );
}

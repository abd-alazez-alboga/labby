import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  getRegion,
  listServiceTypes,
  listSurchargeWindows,
  listSurgeZones,
  type Region,
  type ServiceType,
  type SurchargeWindow,
  type SurgeZone,
} from '../api/regions';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { ActivationCard } from './regions/ActivationCard';
import { BundleForm } from './regions/BundleForm';
import { ServiceTypesSection } from './regions/ServiceTypesSection';
import { SurchargeWindowsSection } from './regions/SurchargeWindowsSection';
import { SurgeZonesSection } from './regions/SurgeZonesSection';

/**
 * UC-A-05..08 in one place: a region's full ADM-01 bundle (with the
 * boundary map), the activation checklist, and the pricing-flavored
 * children. The route needs regions:view; bundle mutations need
 * regions:edit. The service-type / surcharge / surge-zone sections are
 * served under pricing:view and only render with it; their mutating
 * controls additionally need pricing:edit — the same codes the backend
 * enforces per endpoint.
 */
export default function RegionDetailPage() {
  const { t } = useTranslation();
  const { regionId } = useParams<{ regionId: string }>();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const canEditRegion = can('regions:edit');
  const canViewPricing = can('pricing:view');
  const canEditPricing = can('pricing:edit');

  const [region, setRegion] = useState<Region | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [serviceTypes, setServiceTypes] = useState<ServiceType[] | null>(null);
  const [surchargeWindows, setSurchargeWindows] = useState<SurchargeWindow[] | null>(null);
  const [surgeZones, setSurgeZones] = useState<SurgeZone[] | null>(null);
  const [pricingLoadFailed, setPricingLoadFailed] = useState(false);

  useEffect(() => {
    if (!regionId) {
      return;
    }
    let cancelled = false;
    getRegion(apiClient, regionId)
      .then((loaded) => {
        if (!cancelled) {
          setRegion(loaded);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else {
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, regionId]);

  // The pricing children live behind pricing:view — never fetched without it.
  useEffect(() => {
    if (!regionId || !canViewPricing) {
      return;
    }
    let cancelled = false;
    Promise.all([
      listServiceTypes(apiClient, regionId),
      listSurchargeWindows(apiClient, regionId),
      listSurgeZones(apiClient, regionId),
    ])
      .then(([types, windows, zones]) => {
        if (!cancelled) {
          setServiceTypes(types);
          setSurchargeWindows(windows);
          setSurgeZones(zones);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPricingLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, regionId, canViewPricing]);

  if (notFound) {
    return (
      <section>
        <h1 className="page__title">{t('regionDetail.notFoundTitle')}</h1>
        <p>
          <Link to="/regions">{t('regionDetail.backToList')}</Link>
        </p>
      </section>
    );
  }

  if (loadFailed) {
    return (
      <section>
        <p className="banner banner--error" role="alert">
          {t('regionDetail.errors.loadFailed')}
        </p>
      </section>
    );
  }

  if (region === null) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  return (
    <section>
      <h1 className="page__title">{region.name}</h1>
      <p className="page__subtitle">
        <Link to="/regions">{t('regionDetail.backToList')}</Link>
      </p>

      <ActivationCard
        region={region}
        serviceTypes={serviceTypes}
        canEdit={canEditRegion}
        onActivated={setRegion}
      />

      <BundleForm key={region.id} region={region} canEdit={canEditRegion} onSaved={setRegion} />

      {canViewPricing ? (
        pricingLoadFailed ? (
          <p className="banner banner--error" role="alert">
            {t('regionDetail.errors.pricingLoadFailed')}
          </p>
        ) : serviceTypes === null || surchargeWindows === null || surgeZones === null ? (
          <div className="loading">{t('common.loading')}</div>
        ) : (
          <>
            <ServiceTypesSection
              regionId={region.id}
              items={serviceTypes}
              canEdit={canEditPricing}
              onChange={setServiceTypes}
            />
            <SurchargeWindowsSection
              regionId={region.id}
              items={surchargeWindows}
              canEdit={canEditPricing}
              onChange={setSurchargeWindows}
            />
            <SurgeZonesSection
              regionId={region.id}
              boundary={region.boundary ?? null}
              items={surgeZones}
              canEdit={canEditPricing}
              onChange={setSurgeZones}
            />
          </>
        )
      ) : null}
    </section>
  );
}

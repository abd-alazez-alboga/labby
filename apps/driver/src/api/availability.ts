import { authFetch } from './client';
import type { DriverAvailability, LocationSample } from './realtime-types';

/**
 * Client slice of realtime-v1.yaml for driver availability (DRV-05,
 * UC-D-04) and the REST fallback of location streaming (TRK-01).
 */

/** `GET /api/v1/driver/availability` — 409 when the account has no driver profile. */
export function getAvailability(): Promise<DriverAvailability> {
  return authFetch<DriverAvailability>('/api/v1/driver/availability');
}

/**
 * `PUT /api/v1/driver/availability` — idempotent. 409 = refused (going
 * online: the GET carries the machine-readable reason; going offline: an
 * active ride, from M7 on).
 */
export function setAvailability(online: boolean): Promise<DriverAvailability> {
  return authFetch<DriverAvailability>('/api/v1/driver/availability', {
    method: 'PUT',
    body: { online },
  });
}

/** `POST /api/v1/driver/locations` — batch of 1..20 samples; 202. */
export function postLocationSamples(samples: LocationSample[]): Promise<void> {
  return authFetch<void>('/api/v1/driver/locations', {
    method: 'POST',
    body: { samples },
  });
}

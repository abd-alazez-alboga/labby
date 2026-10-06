import { authFetch } from './client';
import type {
  ApplicationResubmitRequest,
  ApplicationSubmitRequest,
  DocumentRenewalRequest,
  DocumentSlot,
  DocumentType,
  DriverApplication,
  DriverDocument,
  FileKind,
  UploadedFile,
  VehicleSwitchRequest,
  VehicleWithDocuments,
} from './onboarding-types';
import { getConfig } from '../config';

/**
 * Typed client for the driver side of the M5 onboarding contract
 * (backend/docs/api/onboarding-v1.yaml). Every function maps 1:1 to a
 * contract operation; tests mock fetch at this contract level.
 */

export interface LocalFile {
  uri: string;
  name: string;
  mimeType: string;
}

/** POST /api/v1/driver/files (multipart file + kind) — 201 | 400 type | 413 size. */
export function uploadDriverFile(
  file: LocalFile,
  kind: FileKind,
): Promise<UploadedFile> {
  const form = new FormData();
  // React Native's fetch uploads {uri,name,type} descriptors as file parts.
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  form.append('kind', kind);
  return authFetch<UploadedFile>('/api/v1/driver/files', {
    method: 'POST',
    body: form,
  });
}

/** GET /api/v1/driver/application — 200 | 404 never applied (UC-D-03). */
export function getMyApplication(): Promise<DriverApplication> {
  return authFetch<DriverApplication>('/api/v1/driver/application');
}

/** POST /api/v1/driver/application — 201 | 400 per-item errors | 409 open/approved. */
export function submitApplication(
  body: ApplicationSubmitRequest,
): Promise<DriverApplication> {
  return authFetch<DriverApplication>('/api/v1/driver/application', {
    method: 'POST',
    body,
  });
}

/** POST /api/v1/driver/application/resubmit — flagged items only (UC-D-02). */
export function resubmitApplication(
  body: ApplicationResubmitRequest,
): Promise<DriverApplication> {
  return authFetch<DriverApplication>('/api/v1/driver/application/resubmit', {
    method: 'POST',
    body,
  });
}

/** GET /api/v1/driver/vehicles — own vehicles with documents, newest first. */
export function getMyVehicles(): Promise<VehicleWithDocuments[]> {
  return authFetch<VehicleWithDocuments[]>('/api/v1/driver/vehicles');
}

/** POST /api/v1/driver/vehicles — vehicle switch (UC-D-18) — 201 | 400 | 409. */
export function submitVehicleSwitch(
  body: VehicleSwitchRequest,
): Promise<VehicleWithDocuments> {
  return authFetch<VehicleWithDocuments>('/api/v1/driver/vehicles', {
    method: 'POST',
    body,
  });
}

/** GET /api/v1/driver/documents — the four current slots | 409 not approved. */
export function getMyDocuments(): Promise<DocumentSlot[]> {
  return authFetch<DocumentSlot[]>('/api/v1/driver/documents');
}

/** POST /api/v1/driver/documents/{type}/renewal (UC-D-19) — 201 | 400 | 409. */
export function submitDocumentRenewal(
  type: DocumentType,
  body: DocumentRenewalRequest,
): Promise<DriverDocument> {
  return authFetch<DriverDocument>(
    `/api/v1/driver/documents/${type}/renewal`,
    { method: 'POST', body },
  );
}

/**
 * Resolves a contract file URL (`FileRef.url`, `UserProfile.photoUrl`):
 * API-relative ones (`/api/v1/files/{token}`) against the API base URL,
 * absolute ones unchanged. These URLs need NO Authorization header and
 * expire — refetch the owning resource instead of caching them.
 */
export function resolveFileUrl(url: string): string {
  return new URL(url, getConfig().apiBaseUrl).toString();
}

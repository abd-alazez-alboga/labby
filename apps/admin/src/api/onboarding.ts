import type { ApiClient } from './client';

/**
 * Contract types and calls for the M5 admin review endpoints (driver
 * applications, vehicle switches, document expiry + renewals).
 * Source of truth: backend/docs/api/onboarding-v1.yaml. Reads are gated by
 * `driver-review:view`, every decision by `driver-review:decide` — the same
 * codes the UI gates on (RBAC-03; the server enforces regardless).
 *
 * Files (NFR-S2): every `FileRef.url` is minted per response and EXPIRES at
 * `urlExpiresAt` — never cache it; refetch the owning resource for fresh
 * URLs. See `resolveFileUrl` for how a URL becomes loadable.
 */

export type ApplicationStatus =
  'submitted' | 'under_review' | 'needs_changes' | 'approved' | 'rejected';

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'submitted',
  'under_review',
  'needs_changes',
  'approved',
  'rejected',
];

/** The queue's contract default (UC-A-10 step 1). */
export const DEFAULT_QUEUE_STATUSES: readonly ApplicationStatus[] = ['submitted', 'under_review'];

export type ReviewStatus = 'pending' | 'changes_requested' | 'approved' | 'rejected' | 'superseded';

export type DocumentType =
  'government_id' | 'drivers_license' | 'vehicle_registration' | 'insurance';

/** Canonical display (and request-changes) order of the four documents. */
export const DOCUMENT_TYPES: readonly DocumentType[] = [
  'government_id',
  'drivers_license',
  'vehicle_registration',
  'insurance',
];

export type FileContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export interface FileRef {
  fileId: string;
  contentType: FileContentType;
  /** API-relative (`/api/v1/files/{token}`) or absolute; needs no Authorization header. */
  url: string;
  urlExpiresAt: string;
}

export interface ServiceTypeRef {
  id: string;
  regionId: string;
  regionName: string;
  nameEn: string;
  nameAr: string;
}

export interface DriverDocument {
  id: string;
  type: DocumentType;
  vehicleId?: string | null;
  number: string;
  /** Calendar date (YYYY-MM-DD); valid THROUGH this day. */
  expiresOn: string;
  file: FileRef;
  reviewStatus: ReviewStatus;
  reviewNote?: string | null;
  submittedAt?: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate: string;
  seats: number;
  photos: FileRef[];
  reviewStatus: ReviewStatus;
  reviewNote?: string | null;
  active: boolean;
  serviceTypes: ServiceTypeRef[];
  submittedAt?: string;
}

export interface VehicleWithDocuments extends Vehicle {
  documents: DriverDocument[];
}

export interface PersonalItem {
  name: string;
  photo?: FileRef | null;
  reviewStatus: 'pending' | 'changes_requested' | 'approved';
  reviewNote?: string | null;
}

export interface ApplicationEvent {
  fromStatus?: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  note?: string | null;
  at: string;
}

export interface Applicant {
  userId: string;
  name: string;
  phone: string;
}

export interface AdminDriverApplication {
  id: string;
  status: ApplicationStatus;
  submittedAt: string;
  decidedAt?: string | null;
  rejectionReason?: string | null;
  personal: PersonalItem;
  documents: DriverDocument[];
  vehicle: Vehicle;
  /** Oldest first. */
  history: ApplicationEvent[];
  applicant: Applicant;
  /** The plate is on ANOTHER driver's active vehicle; blocks approval (UC-A-10 E1). */
  duplicatePlate: boolean;
}

export interface ApplicationSummary {
  id: string;
  applicant: Applicant;
  status: ApplicationStatus;
  submittedAt: string;
  plate: string;
  duplicatePlate: boolean;
}

export interface ApplicationSummaryPage {
  items: ApplicationSummary[];
  page: number;
  size: number;
  totalItems: number;
}

export interface ApplicationQuery {
  statuses: readonly ApplicationStatus[];
  page: number;
  size: number;
}

export type ReviewItemKind = 'personal' | 'document' | 'vehicle';

export interface ChangeRequestItem {
  item: ReviewItemKind;
  /** Present iff item = document. */
  documentType?: DocumentType;
  note: string;
}

export interface RequestChangesRequest {
  items: ChangeRequestItem[];
  /** Optional overall note, recorded in the stage history. */
  note?: string;
}

export interface ApproveRequest {
  serviceTypeIds: string[];
}

export interface ReasonRequest {
  reason: string;
}

export interface VehicleReviewSummary {
  vehicleId: string;
  driver: Applicant;
  make: string;
  model: string;
  plate: string;
  submittedAt: string;
  duplicatePlate: boolean;
}

export interface VehicleReview {
  driver: Applicant;
  vehicle: VehicleWithDocuments;
  /** The driver's active vehicle until the switch is approved. */
  currentVehicle?: Vehicle | null;
  duplicatePlate: boolean;
}

export interface DocumentRenewal {
  driver: Applicant;
  renewal: DriverDocument;
  current: DriverDocument;
  /** The driver role is suspended for document expiry. */
  driverSuspended: boolean;
}

export interface ExpiryRow {
  document: DriverDocument;
  driver: Applicant;
  /** expiresOn − today; negative once expired. */
  daysLeft: number;
  driverSuspended: boolean;
  renewalPending: boolean;
  reminder30SentAt?: string | null;
  reminder7SentAt?: string | null;
}

export interface ExpiryDashboard {
  horizonDays: number;
  upcoming: ExpiryRow[];
  expired: ExpiryRow[];
}

/* ---------- Files ---------- */

const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:/i;

/**
 * Turns a `FileRef.url` into a loadable URL. Absolute URLs (future object
 * stores) pass through the URL constructor untouched; API-relative ones are
 * resolved against the runtime-config API base exactly like every other API
 * path in `client.ts` (base + path), so a base with a path prefix keeps it.
 */
export function resolveFileUrl(url: string, apiBaseUrl: string): string {
  if (ABSOLUTE_URL.test(url)) {
    return new URL(url).href;
  }
  const base = apiBaseUrl.replace(/\/+$/, '');
  return new URL(`${base}${url.startsWith('/') ? url : `/${url}`}`).href;
}

/* ---------- Applications (UC-A-10) ---------- */

/** GET /admin/driver-applications — oldest submission first; driver-review:view. */
export function listApplications(
  client: ApiClient,
  query: ApplicationQuery,
): Promise<ApplicationSummaryPage> {
  const params = new URLSearchParams();
  for (const status of query.statuses) {
    params.append('status', status);
  }
  params.set('page', String(query.page));
  params.set('size', String(query.size));
  return client.get<ApplicationSummaryPage>(`/api/v1/admin/driver-applications?${params}`);
}

/** GET /admin/driver-applications/{id} — with fresh file URLs; driver-review:view. */
export function getApplication(
  client: ApiClient,
  applicationId: string,
): Promise<AdminDriverApplication> {
  return client.get<AdminDriverApplication>(`/api/v1/admin/driver-applications/${applicationId}`);
}

/** POST …/start-review — submitted → under_review; 409 = not submitted / lost race. */
export function startReview(
  client: ApiClient,
  applicationId: string,
): Promise<AdminDriverApplication> {
  return client.post<AdminDriverApplication>(
    `/api/v1/admin/driver-applications/${applicationId}/start-review`,
  );
}

/** POST …/request-changes — → needs_changes; 409 = not under_review / lost race. */
export function requestChanges(
  client: ApiClient,
  applicationId: string,
  body: RequestChangesRequest,
): Promise<AdminDriverApplication> {
  return client.post<AdminDriverApplication>(
    `/api/v1/admin/driver-applications/${applicationId}/request-changes`,
    body,
  );
}

/**
 * POST …/approve — assigns service types, activates the vehicle + driver
 * role; 409 = not under_review, duplicate plate, expired document, lost race.
 */
export function approveApplication(
  client: ApiClient,
  applicationId: string,
  body: ApproveRequest,
): Promise<AdminDriverApplication> {
  return client.post<AdminDriverApplication>(
    `/api/v1/admin/driver-applications/${applicationId}/approve`,
    body,
  );
}

/** POST …/reject — mandatory reason; 409 = not under_review / lost race. */
export function rejectApplication(
  client: ApiClient,
  applicationId: string,
  body: ReasonRequest,
): Promise<AdminDriverApplication> {
  return client.post<AdminDriverApplication>(
    `/api/v1/admin/driver-applications/${applicationId}/reject`,
    body,
  );
}

/** GET /admin/assignable-service-types — enabled types of active regions; driver-review:view. */
export function listAssignableServiceTypes(client: ApiClient): Promise<ServiceTypeRef[]> {
  return client.get<ServiceTypeRef[]>('/api/v1/admin/assignable-service-types');
}

/* ---------- Vehicle switches (UC-A-11) ---------- */

/** GET /admin/vehicle-reviews — pending switches, oldest first; driver-review:view. */
export function listVehicleReviews(client: ApiClient): Promise<VehicleReviewSummary[]> {
  return client.get<VehicleReviewSummary[]>('/api/v1/admin/vehicle-reviews');
}

/** GET /admin/vehicle-reviews/{vehicleId} — new vehicle + its documents + the current one. */
export function getVehicleReview(client: ApiClient, vehicleId: string): Promise<VehicleReview> {
  return client.get<VehicleReview>(`/api/v1/admin/vehicle-reviews/${vehicleId}`);
}

/** POST …/approve — the new vehicle becomes the single active one; 409 as documented. */
export function approveVehicleReview(
  client: ApiClient,
  vehicleId: string,
  body: ApproveRequest,
): Promise<VehicleReview> {
  return client.post<VehicleReview>(`/api/v1/admin/vehicle-reviews/${vehicleId}/approve`, body);
}

/** POST …/reject — the driver keeps the current vehicle. */
export function rejectVehicleReview(
  client: ApiClient,
  vehicleId: string,
  body: ReasonRequest,
): Promise<VehicleReview> {
  return client.post<VehicleReview>(`/api/v1/admin/vehicle-reviews/${vehicleId}/reject`, body);
}

/* ---------- Document expiry + renewals (UC-A-12) ---------- */

/** GET /admin/document-expiries — upcoming within the horizon + expired; driver-review:view. */
export function getExpiryDashboard(
  client: ApiClient,
  horizonDays: number,
): Promise<ExpiryDashboard> {
  return client.get<ExpiryDashboard>(`/api/v1/admin/document-expiries?horizonDays=${horizonDays}`);
}

/** GET /admin/document-renewals — pending renewals, oldest first; driver-review:view. */
export function listRenewals(client: ApiClient): Promise<DocumentRenewal[]> {
  return client.get<DocumentRenewal[]>('/api/v1/admin/document-renewals');
}

/** GET /admin/document-renewals/{documentId} — the renewal beside the current document. */
export function getRenewal(client: ApiClient, documentId: string): Promise<DocumentRenewal> {
  return client.get<DocumentRenewal>(`/api/v1/admin/document-renewals/${documentId}`);
}

/** POST …/approve — replaces the current document; may lift an expiry suspension. */
export function approveRenewal(client: ApiClient, documentId: string): Promise<DocumentRenewal> {
  return client.post<DocumentRenewal>(`/api/v1/admin/document-renewals/${documentId}/approve`);
}

/** POST …/reject — the current document stays. */
export function rejectRenewal(
  client: ApiClient,
  documentId: string,
  body: ReasonRequest,
): Promise<DocumentRenewal> {
  return client.post<DocumentRenewal>(`/api/v1/admin/document-renewals/${documentId}/reject`, body);
}

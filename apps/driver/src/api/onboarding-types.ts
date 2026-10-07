/**
 * Types mirroring the M5 driver-onboarding contract
 * (backend/docs/api/onboarding-v1.yaml) — the driver-facing subset only.
 */

export type ApplicationStatus =
  "submitted" | "under_review" | "needs_changes" | "approved" | "rejected";

export type ReviewStatus =
  "pending" | "changes_requested" | "approved" | "rejected" | "superseded";

export type DocumentType =
  "government_id" | "drivers_license" | "vehicle_registration" | "insurance";

/** All four document types, in the order the application asks for them. */
export const DOCUMENT_TYPES: readonly DocumentType[] = [
  "government_id",
  "drivers_license",
  "vehicle_registration",
  "insurance",
];

/** The two documents bound to a vehicle (a vehicle switch re-submits them). */
export const VEHICLE_DOCUMENT_TYPES: readonly DocumentType[] = [
  "vehicle_registration",
  "insurance",
];

export type FileKind = "document" | "vehicle_photo";

export type FileContentType =
  "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export interface UploadedFile {
  fileId: string;
  kind: FileKind;
  contentType: FileContentType;
  sizeBytes: number;
}

/**
 * A private file with a freshly minted, EXPIRING url (NFR-S2). The url may be
 * API-relative — resolve it with `resolveFileUrl`, never cache it long-term.
 */
export interface FileRef {
  fileId: string;
  contentType: FileContentType;
  url: string;
  urlExpiresAt: string;
}

export interface DocumentInput {
  type: DocumentType;
  number: string;
  /** ISO calendar date (YYYY-MM-DD); must be after today (UC-D-01 E2). */
  expiresOn: string;
  fileId: string;
}

export interface DocumentRenewalRequest {
  number: string;
  expiresOn: string;
  fileId: string;
}

export interface VehicleInput {
  make: string;
  model: string;
  year: number;
  color: string;
  plate: string;
  seats: number;
  photoFileIds: string[];
}

export interface ApplicationSubmitRequest {
  documents: DocumentInput[];
  vehicle: VehicleInput;
}

export interface ApplicationResubmitRequest {
  confirmPersonalDetails?: boolean;
  documents?: DocumentInput[];
  vehicle?: VehicleInput;
}

export interface VehicleSwitchRequest {
  vehicle: VehicleInput;
  documents: DocumentInput[];
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
  reviewStatus: "pending" | "changes_requested" | "approved";
  reviewNote?: string | null;
}

export interface ApplicationEvent {
  fromStatus?: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  note?: string | null;
  at: string;
}

export interface DriverApplication {
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
}

export interface DocumentSlot {
  type: DocumentType;
  vehicleId?: string | null;
  current: DriverDocument;
  /** today > current.expiresOn */
  expired?: boolean;
  /** Pending renewal, or the latest rejected one with its reason. */
  renewal?: DriverDocument | null;
}

/** The M1 ErrorResponse shape; `fieldErrors` only on validation failures. */
export interface ApiErrorBody {
  status?: number;
  message?: string;
  fieldErrors?: Record<string, string> | null;
}

/** Contract limits (onboarding-v1.yaml components.schemas). */
export const DOCUMENT_NUMBER_MAX = 50;
export const VEHICLE_TEXT_MAX = 50;
export const VEHICLE_COLOR_MAX = 30;
export const VEHICLE_PLATE_MAX = 20;
export const VEHICLE_YEAR_MIN = 1980;
export const VEHICLE_SEATS_MIN = 1;
export const VEHICLE_SEATS_MAX = 8;
export const VEHICLE_PHOTOS_MIN = 1;
export const VEHICLE_PHOTOS_MAX = 4;
export const PROFILE_NAME_MAX = 100;
/** `STORAGE_DRIVER_FILE_MAX_BYTES` default (10 MiB); the server stays the authority. */
export const DRIVER_FILE_MAX_BYTES = 10 * 1024 * 1024;

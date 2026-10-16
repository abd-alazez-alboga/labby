import { ApiError, apiFetch } from "./http-client";

/**
 * Client slice of the trust contract for the rider app
 * (backend/docs/api/trust-v1.yaml, M11): rating the driver of a completed
 * ride (UC-S-17, RATE-01), the pending prompts, and reporting the driver of
 * a ride with photos + the reporter's own outcome list (UC-S-18, REP-01/02).
 * Types mirror the contract schemas 1:1; screens never call fetch
 * themselves. The rider is always `as=rider`.
 */

// --------------------------------------------------------------- schemas

/** `MyRating.state` (rides-v1 `Ride.myRating`) — the caller's OWN rating. */
export type MyRatingState = "pending" | "submitted" | "expired" | "not_applicable";

export interface MyRating {
  state: MyRatingState;
  /** completedAt + 7 days. */
  windowEndsAt?: string | null;
  /** The score the rider gave (`submitted`). */
  score?: number | null;
}

export interface RatingRequest {
  /** 1..5 */
  score: number;
  /** ≤ 1000 characters. */
  comment?: string | null;
}

export const RATING_COMMENT_MAX = 1000;

export interface PendingRating {
  rideId: string;
  completedAt: string;
  windowEndsAt: string;
  counterpartFirstName: string;
  counterpartPhotoUrl?: string | null;
  pickupLabel?: string | null;
  destinationLabel?: string | null;
}

/** rider → driver categories (a driver → rider one is 400 `invalid_category`). */
export const RIDER_REPORT_CATEGORIES = [
  "unsafe_driving",
  "inappropriate_behavior",
  "vehicle_condition",
  "other",
] as const;
export type RiderReportCategory = (typeof RIDER_REPORT_CATEGORIES)[number];

/** Every contract category (the list may show any of them). */
export type ReportCategory =
  | RiderReportCategory
  | "unsafe_behavior"
  | "vehicle_damage";

export type ReportStatus = "open" | "substantiated" | "unsubstantiated";

/** Text ≤ 2000 and up to 3 photos (ruling). */
export const REPORT_DESCRIPTION_MAX = 2000;
export const REPORT_MAX_PHOTOS = 3;

export interface UploadedReportFile {
  fileId: string;
  contentType: "image/jpeg" | "image/png";
  sizeBytes: number;
}

export interface ReportRequest {
  category: RiderReportCategory;
  description?: string | null;
  photoFileIds?: string[];
}

/** The reporter's view — outcome only, never the internal notes. */
export interface OwnReport {
  id: string;
  rideId: string;
  category: ReportCategory;
  status: ReportStatus;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface OwnReportPage {
  items: OwnReport[];
  page: number;
  size: number;
  totalElements: number;
}

/** Local image picked for a report photo (React Native file descriptor). */
export interface ReportPhotoFile {
  uri: string;
  name: string;
  type: string;
}

// ---------------------------------------------------------------- errors

/** The machine `code` of a trust error (409s), if the backend sent one. */
export function trustErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? (error.body?.code ?? null) : null;
}

// ------------------------------------------------------------- endpoints

function rideUrl(rideId: string, suffix: string): string {
  return `/api/v1/rides/${encodeURIComponent(rideId)}${suffix}`;
}

/**
 * `POST /rides/{id}/rating` — 204. 409 `ride_not_completed`,
 * `rating_window_closed` or `rating_already_submitted`.
 */
export function submitRating(rideId: string, request: RatingRequest): Promise<void> {
  return apiFetch<void>(rideUrl(rideId, "/rating"), {
    method: "POST",
    auth: true,
    body: JSON.stringify(request),
  });
}

/** `GET /ratings/pending?as=rider` — rides still to rate, newest first. */
export function listPendingRatings(): Promise<PendingRating[]> {
  return apiFetch<PendingRating[]>("/api/v1/ratings/pending?as=rider", {
    auth: true,
  });
}

/** `POST /report-files` — one JPEG/PNG photo, multipart. 400 / 413 / 429. */
export function uploadReportFile(file: ReportPhotoFile): Promise<UploadedReportFile> {
  const form = new FormData();
  // React Native's FormData accepts a {uri, name, type} file descriptor.
  form.append("file", file as unknown as Blob);
  return apiFetch<UploadedReportFile>("/api/v1/report-files", {
    method: "POST",
    auth: true,
    body: form,
  });
}

/**
 * `POST /rides/{id}/reports` — 201. 409 `report_already_submitted` /
 * `no_counterpart`.
 */
export function submitReport(rideId: string, request: ReportRequest): Promise<OwnReport> {
  return apiFetch<OwnReport>(rideUrl(rideId, "/reports"), {
    method: "POST",
    auth: true,
    body: JSON.stringify(request),
  });
}

export const REPORTS_PAGE_SIZE = 20;

/** `GET /reports/mine?as=rider` — newest first, outcome only. */
export function listMyReports(page = 0): Promise<OwnReportPage> {
  return apiFetch<OwnReportPage>(
    `/api/v1/reports/mine?as=rider&page=${page}&size=${REPORTS_PAGE_SIZE}`,
    { auth: true },
  );
}

// --------------------------------------------------------------- helpers

/** Whole days left until `windowEndsAt` (at least 1 while it is open). */
export function ratingDaysLeft(windowEndsAt: string | null | undefined, now = Date.now()): number | null {
  if (!windowEndsAt) return null;
  const end = new Date(windowEndsAt).getTime();
  if (Number.isNaN(end) || end <= now) return null;
  return Math.max(1, Math.ceil((end - now) / 86_400_000));
}

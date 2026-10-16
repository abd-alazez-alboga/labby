import { authFetch } from "./client";
import type { LocalFile } from "./onboarding";
import type {
  DriverPerformance,
  OwnReport,
  OwnReportPage,
  PendingRating,
  RatingRequest,
  ReportRequest,
  UploadedReportFile,
} from "./trust-types";

/**
 * Client slice of trust-v1.yaml for the driver app (UC-S-17/18, UC-D-20).
 * The caller's side is always `driver` here. A 204 parses to null.
 */

/** `POST /rides/{id}/rating` — 204; 409 `ride_not_completed` | `rating_window_closed` | `rating_already_submitted`. */
export async function submitRating(
  rideId: string,
  body: RatingRequest,
): Promise<void> {
  await authFetch<null>(`/api/v1/rides/${rideId}/rating`, {
    method: "POST",
    body,
  });
}

/** `GET /ratings/pending?as=driver` — rides still to rate, newest first. */
export async function getPendingRatings(): Promise<PendingRating[]> {
  return (
    (await authFetch<PendingRating[] | null>(
      "/api/v1/ratings/pending?as=driver",
    )) ?? []
  );
}

/** `POST /report-files` (multipart `file`) — 201 | 400 type | 413 size | 429 daily cap. */
export function uploadReportFile(file: LocalFile): Promise<UploadedReportFile> {
  const form = new FormData();
  // React Native's fetch uploads {uri,name,type} descriptors as file parts.
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  return authFetch<UploadedReportFile>("/api/v1/report-files", {
    method: "POST",
    body: form,
  });
}

/** `POST /rides/{id}/reports` — 201; 409 `no_counterpart` | `report_already_submitted`. */
export function submitReport(
  rideId: string,
  body: ReportRequest,
): Promise<OwnReport> {
  return authFetch<OwnReport>(`/api/v1/rides/${rideId}/reports`, {
    method: "POST",
    body,
  });
}

/** `GET /reports/mine?as=driver` — newest first, outcome only. */
export function getMyReports(page = 0, size = 20): Promise<OwnReportPage> {
  return authFetch<OwnReportPage>(
    `/api/v1/reports/mine?as=driver&page=${page}&size=${size}`,
  );
}

/** `GET /driver/performance` — 403 when not an approved driver. */
export function getDriverPerformance(): Promise<DriverPerformance> {
  return authFetch<DriverPerformance>("/api/v1/driver/performance");
}

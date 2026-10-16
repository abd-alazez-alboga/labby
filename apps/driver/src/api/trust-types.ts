/**
 * Types mirroring the M11 trust contract (backend/docs/api/trust-v1.yaml) —
 * the DRIVER slice: rating the rider (UC-S-17), reporting the rider
 * (UC-S-18) and the performance dashboard (UC-D-20). Import-free.
 */

export type PartyRole = "rider" | "driver";

/** `POST /rides/{id}/rating` body — score 1..5, optional comment ≤ 1000. */
export interface RatingRequest {
  score: number;
  comment?: string | null;
}

export const RATING_COMMENT_MAX = 1000;

/** A completed ride the caller can still rate (newest first). */
export interface PendingRating {
  rideId: string;
  completedAt: string;
  /** completedAt + 7 days. */
  windowEndsAt: string;
  counterpartFirstName: string;
  counterpartPhotoUrl?: string | null;
  pickupLabel?: string | null;
  destinationLabel?: string | null;
}

/** The caller's own per-role average (exposed view: daily snapshot, ≥ 5 ratings). */
export interface OwnRatingAggregate {
  role: PartyRole;
  /** Snapshot average (2 decimals); null below 5 ratings. */
  average?: number | null;
  /** As of the snapshot (0 when there is none yet). */
  ratingCount: number;
  snapshotAt?: string | null;
}

export type ReportCategory =
  | "unsafe_driving"
  | "unsafe_behavior"
  | "inappropriate_behavior"
  | "vehicle_condition"
  | "vehicle_damage"
  | "other";

/** driver → rider categories, in the order of the approved artboard. */
export const DRIVER_REPORT_CATEGORIES: readonly ReportCategory[] = [
  "unsafe_behavior",
  "inappropriate_behavior",
  "vehicle_damage",
  "other",
];

/** Contract limits (owner rulings): text ≤ 2000, up to 3 photos. */
export const REPORT_TEXT_MAX = 2000;
export const REPORT_PHOTOS_MAX = 3;

export type ReportStatus = "open" | "substantiated" | "unsubstantiated";

export interface UploadedReportFile {
  fileId: string;
  contentType: "image/jpeg" | "image/png";
  sizeBytes: number;
}

export interface ReportRequest {
  category: ReportCategory;
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

/** 0..100 with 1 decimal; `percent` null when the denominator is 0. */
export interface Percentage {
  percent?: number | null;
  numerator: number;
  denominator: number;
}

export interface MoneyAmount {
  currency: string;
  amount: number;
}

export type WindowDays = 7 | 30;

export interface MetricWindow {
  days: WindowDays;
  acceptance: Percentage;
  cancellation: Percentage;
  onTime: Percentage;
  /** Completed rides in the window. */
  trips: number;
  /** Driver fare earnings per currency in the window. */
  earnings: MoneyAmount[];
}

/** An ACTIVE DRV-07 warning with the rule that raised it. */
export interface MetricWarning {
  metric: "acceptance" | "cancellation";
  valuePercent: number;
  thresholdPercent: number;
  comparison: "below" | "above";
  windowDays: number;
  sampleSize: number;
  raisedAt: string;
}

/** The region's USR-05 rule for the driver role (UC-D-20 A1). */
export interface RatingRule {
  minAvgRating: number;
  minRatedRides: number;
  warnAvgRating: number;
}

export interface DriverPerformance {
  /** Exactly two: 7 and 30 days. */
  windows: MetricWindow[];
  /** LIFETIME snapshot average — not per window. */
  rating: OwnRatingAggregate;
  warnings: MetricWarning[];
  /** The rule of the driver's region (latest ride); null before any ride. */
  ratingRule?: RatingRule | null;
  /** Exposed average below `ratingRule.warnAvgRating` (UC-D-20 A1). */
  ratingWarning: boolean;
}

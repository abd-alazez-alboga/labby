import type { ApiClient } from './client';

/**
 * Contract types and calls for the M11 admin trust endpoints (reports queue,
 * flagged accounts, the user trust profile, suspend/reactivate).
 * Source of truth: backend/docs/api/trust-v1.yaml. Gating codes, shared
 * verbatim with the backend: reports queue + detail `reports:view`, resolving
 * `reports:handle`; flags queue + trust profile `users:view`; closing a flag
 * and every suspend/reactivate `users:suspend`.
 */

export type PartyRole = 'rider' | 'driver';

export type ReportCategory =
  | 'unsafe_driving'
  | 'unsafe_behavior'
  | 'inappropriate_behavior'
  | 'vehicle_condition'
  | 'vehicle_damage'
  | 'other';

export type ReportStatus = 'open' | 'substantiated' | 'unsubstantiated';

export const REPORT_STATUSES: readonly ReportStatus[] = [
  'open',
  'substantiated',
  'unsubstantiated',
];

export interface PartySummary {
  userId: string;
  name: string;
  role: PartyRole;
}

/** A party's prior trust history (UC-A-17 step 2), the shown report excluded. */
export interface ReportHistory {
  reportsAgainst: number;
  substantiatedAgainst: number;
  reportsFiled: number;
}

export interface AdminReportSummary {
  id: string;
  rideId: string;
  category: ReportCategory;
  status: ReportStatus;
  reporter: PartySummary;
  reported: PartySummary;
  createdAt: string;
  resolvedAt?: string | null;
  photoCount: number;
}

export interface AdminReport extends AdminReportSummary {
  description?: string | null;
  /** Signed private file URLs, in upload order. */
  photoUrls: string[];
  resolutionNote?: string | null;
  resolvedBy?: { userId: string; name: string } | null;
  reporterHistory: ReportHistory;
  reportedHistory: ReportHistory;
}

export interface AdminReportPage {
  items: AdminReportSummary[];
  page: number;
  size: number;
  totalElements: number;
}

export type ReportOutcome = 'substantiated' | 'unsubstantiated';

export interface ReportQuery {
  /** Server default: `open`. */
  status?: ReportStatus;
  reportedUserId?: string;
  /** Reports this user FILED, as rider or driver (V1 audit W4); combines with reportedUserId. */
  reporterUserId?: string;
  page?: number;
  size?: number;
}

export type FlagKind = 'low_rating' | 'metric_warning' | 'report_threshold';
export const FLAG_KINDS: readonly FlagKind[] = ['low_rating', 'metric_warning', 'report_threshold'];

export type FlagStatus = 'open' | 'actioned' | 'dismissed';

export interface LowRatingDetails {
  average: number;
  ratingCount: number;
  warnAvgRating: number;
  minRatedRides: number;
  regionId?: string;
}

export interface MetricWarningDetails {
  metric: 'acceptance' | 'cancellation';
  valuePercent: number;
  thresholdPercent: number;
  windowDays: number;
  sampleSize: number;
}

export interface ReportThresholdDetails {
  substantiatedCount: number;
  windowDays: number;
  threshold: number;
  reportIds: string[];
}

interface FlagBase {
  id: string;
  user: PartySummary;
  status: FlagStatus;
  raisedAt: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
}

/** The triggering evaluation is shaped by `kind` (contract `details` oneOf). */
export type AccountFlag =
  | (FlagBase & { kind: 'low_rating'; details: LowRatingDetails })
  | (FlagBase & { kind: 'metric_warning'; details: MetricWarningDetails })
  | (FlagBase & { kind: 'report_threshold'; details: ReportThresholdDetails });

export interface AccountFlagPage {
  items: AccountFlag[];
  page: number;
  size: number;
  totalElements: number;
}

export interface FlagQuery {
  /** Server default: `open`. */
  status?: FlagStatus;
  kind?: FlagKind;
  userId?: string;
  page?: number;
  size?: number;
}

export type FlagResolution = 'actioned' | 'dismissed';

/** An ACTIVE DRV-07 warning with the rule that raised it. */
export interface MetricWarning {
  metric: 'acceptance' | 'cancellation';
  valuePercent: number;
  thresholdPercent: number;
  comparison: 'below' | 'above';
  windowDays: number;
  sampleSize: number;
  raisedAt: string;
}

export type SuspensionReason = 'document_expired' | 'low_rating' | 'manual';

export interface RoleTrust {
  role: PartyRole;
  state: 'active' | 'suspended';
  suspensionReason?: SuspensionReason | null;
  suspensionNote?: string | null;
  suspendedAt?: string | null;
  /** Live lifetime average (admins only); null without ratings. */
  liveAverage?: number | null;
  liveRatingCount: number;
  openFlags: AccountFlag[];
  /** Driver role only (empty for rider). */
  activeWarnings: MetricWarning[];
  reportHistory?: ReportHistory | null;
}

export interface AdminUserTrust {
  userId: string;
  name: string;
  accountState: 'active' | 'suspended' | 'deleted';
  accountSuspensionNote?: string | null;
  accountSuspendedAt?: string | null;
  roles: RoleTrust[];
}

/* ---------- Reports (UC-A-17) ---------- */

/** GET /admin/reports — oldest first; reports:view. */
export function listAdminReports(
  client: ApiClient,
  query: ReportQuery = {},
): Promise<AdminReportPage> {
  const params = new URLSearchParams();
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.reportedUserId) {
    params.set('reportedUserId', query.reportedUserId);
  }
  if (query.reporterUserId) {
    params.set('reporterUserId', query.reporterUserId);
  }
  params.set('page', String(query.page ?? 0));
  params.set('size', String(query.size ?? 20));
  return client.get<AdminReportPage>(`/api/v1/admin/reports?${params}`);
}

/** GET /admin/reports/{id} — evidence references + both parties' history; reports:view. */
export function getAdminReport(client: ApiClient, reportId: string): Promise<AdminReport> {
  return client.get<AdminReport>(`/api/v1/admin/reports/${reportId}`);
}

/** POST /admin/reports/{id}/resolve — exactly once (409 `already_resolved`); reports:handle. */
export function resolveAdminReport(
  client: ApiClient,
  reportId: string,
  outcome: ReportOutcome,
  note: string,
): Promise<AdminReport> {
  return client.post<AdminReport>(`/api/v1/admin/reports/${reportId}/resolve`, { outcome, note });
}

/* ---------- Flags (UC-A-16) ---------- */

/** GET /admin/flags — oldest first; users:view. */
export function listAccountFlags(
  client: ApiClient,
  query: FlagQuery = {},
): Promise<AccountFlagPage> {
  const params = new URLSearchParams();
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.kind) {
    params.set('kind', query.kind);
  }
  if (query.userId) {
    params.set('userId', query.userId);
  }
  params.set('page', String(query.page ?? 0));
  params.set('size', String(query.size ?? 20));
  return client.get<AccountFlagPage>(`/api/v1/admin/flags?${params}`);
}

/** POST /admin/flags/{id}/resolve — closes the flag only (409 `already_resolved`); users:suspend. */
export function resolveAccountFlag(
  client: ApiClient,
  flagId: string,
  resolution: FlagResolution,
  note: string,
): Promise<AccountFlag> {
  return client.post<AccountFlag>(`/api/v1/admin/flags/${flagId}/resolve`, { resolution, note });
}

/* ---------- User trust profile + suspension (UC-A-13/14) ---------- */

/** GET /admin/users/{id}/trust — states, live ratings, flags, warnings; users:view. */
export function getUserTrust(client: ApiClient, userId: string): Promise<AdminUserTrust> {
  return client.get<AdminUserTrust>(`/api/v1/admin/users/${userId}/trust`);
}

export type SuspensionAction =
  | { kind: 'suspendRole'; role: PartyRole }
  | { kind: 'reactivateRole'; role: PartyRole }
  | { kind: 'suspendAccount' }
  | { kind: 'reactivateAccount' };

/**
 * POST …/roles/{role}/suspend|reactivate or …/suspend|reactivate with the
 * mandatory note (shown to the user); users:suspend. Returns the updated
 * trust profile. 409 codes: already_suspended, not_suspended,
 * document_expired, admin_account, account_deleted.
 */
export function applySuspensionAction(
  client: ApiClient,
  userId: string,
  action: SuspensionAction,
  note: string,
): Promise<AdminUserTrust> {
  const base = `/api/v1/admin/users/${userId}`;
  const path =
    action.kind === 'suspendRole'
      ? `${base}/roles/${action.role}/suspend`
      : action.kind === 'reactivateRole'
        ? `${base}/roles/${action.role}/reactivate`
        : action.kind === 'suspendAccount'
          ? `${base}/suspend`
          : `${base}/reactivate`;
  return client.post<AdminUserTrust>(path, { note });
}

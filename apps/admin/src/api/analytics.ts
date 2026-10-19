import type { ApiClient, DownloadedFile } from './client';

/**
 * The M15 analytics contract (backend/docs/api/analytics-v1.yaml): the
 * dashboard (ADM-02, `analytics:view`), the users / drivers / transactions
 * lists (owner ruling Q1) and the CSV export of the five key lists (ADM-06,
 * `analytics:export` + the list's own view permission).
 */

/* ---------- Dashboard ---------- */

export interface RegionRides {
  regionId: string;
  regionName: string;
  total: number;
  completed: number;
  cancelled: number;
}

export interface ServiceTypeRides {
  serviceTypeId: string;
  regionId: string;
  nameEn: string;
  nameAr: string;
  total: number;
  completed: number;
}

export interface DailyRides {
  /** The ride's local date in its region's time zone (YYYY-MM-DD). */
  date: string;
  total: number;
  completed: number;
  cancelled: number;
}

export interface RideMetrics {
  total: number;
  completed: number;
  cancelledByRider: number;
  cancelledByDriver: number;
  noDriverFound: number;
  /** 0..1; null when no ride has finished. */
  completionRate: number | null;
  byRegion: RegionRides[];
  byServiceType: ServiceTypeRides[];
  /** Days with rides only; the client fills empty days. */
  daily: DailyRides[];
}

export interface RevenueRow {
  currency: string;
  grossFares: number;
  commission: number;
}

export interface RegionRevenue extends RevenueRow {
  regionId: string;
  regionName: string;
}

export interface UserMetrics {
  /** Ruling Q6: platform-wide whatever the region filter says. */
  signups: { scope: 'platform'; riders: number; drivers: number };
  activeRiders: number;
  activeDrivers: number;
  /** Point in time (ruling Q3). */
  driversOnlineNow: number;
}

export interface OpsMetrics {
  avgPickupSeconds: number | null;
  /** 0..1; null when no offer was answered. */
  acceptanceRate: number | null;
  offersAccepted: number;
  offersAnswered: number;
  /** Point in time (ruling Q3). */
  activeSurgeZones: number;
}

export interface AnalyticsDashboard {
  from: string;
  to: string;
  regionId: string | null;
  rides: RideMetrics;
  revenue: { totals: RevenueRow[]; byRegion: RegionRevenue[] };
  users: UserMetrics;
  ops: OpsMetrics;
}

/** GET /admin/analytics — `[from, to)`, at most 366 days; analytics:view. */
export function getDashboard(
  client: ApiClient,
  query: { from: string; to: string; regionId?: string },
): Promise<AnalyticsDashboard> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.regionId) {
    params.set('regionId', query.regionId);
  }
  return client.get<AnalyticsDashboard>(`/api/v1/admin/analytics?${params}`);
}

/* ---------- Lists ---------- */

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalItems: number;
}

export type UserRole = 'rider' | 'driver' | 'admin';
export type AccountState = 'active' | 'suspended' | 'deleted';
export type ApplicationStatus =
  'submitted' | 'under_review' | 'needs_changes' | 'approved' | 'rejected' | 'withdrawn';
export type TransactionSource = 'wallet' | 'driver_ledger';

export interface AdminUser {
  userId: string;
  name: string;
  /** Contact access (UC-A-20): null without support:handle. */
  phone: string | null;
  state: AccountState;
  roles: { role: UserRole; state: 'active' | 'suspended' }[];
  createdAt: string;
}

export interface AdminDriver {
  userId: string;
  name: string;
  phone: string | null;
  applicationStatus: ApplicationStatus;
  online: boolean;
  regionId: string | null;
  regionName: string | null;
  vehiclePlate: string | null;
  createdAt: string;
}

export interface AdminTransaction {
  transactionId: string;
  source: TransactionSource;
  userId: string;
  userName: string;
  /** The wallet transaction type or the driver ledger type. */
  type: string;
  amount: number;
  currency: string;
  rideId: string | null;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
}

export interface UserFilter {
  role?: UserRole;
  /** createdAt ≥ (ISO date-time). */
  from?: string;
  /** createdAt < (ISO date-time). */
  to?: string;
}

export interface DriverFilter {
  regionId?: string;
  status?: ApplicationStatus;
  online?: boolean;
}

export interface TransactionFilter {
  source?: TransactionSource;
  type?: string;
  currency?: string;
  userId?: string;
  from?: string;
  to?: string;
}

/** A filter's query parameters, skipping empty values — shared by a list and its export. */
export function filterParams(filter: object): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
    } else if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  return params;
}

function pageParams(filter: object, page: number, size: number): URLSearchParams {
  const params = filterParams(filter);
  params.set('page', String(page));
  params.set('size', String(size));
  return params;
}

/** GET /admin/users — newest first; users:view. */
export function listAdminUsers(
  client: ApiClient,
  filter: UserFilter,
  page: number,
  size: number,
): Promise<Page<AdminUser>> {
  return client.get(`/api/v1/admin/users?${pageParams(filter, page, size)}`);
}

/** GET /admin/drivers — newest account first; users:view. */
export function listAdminDrivers(
  client: ApiClient,
  filter: DriverFilter,
  page: number,
  size: number,
): Promise<Page<AdminDriver>> {
  return client.get(`/api/v1/admin/drivers?${pageParams(filter, page, size)}`);
}

/** GET /admin/transactions — newest first; wallets:view AND settlements:view. */
export function listAdminTransactions(
  client: ApiClient,
  filter: TransactionFilter,
  page: number,
  size: number,
): Promise<Page<AdminTransaction>> {
  return client.get(`/api/v1/admin/transactions?${pageParams(filter, page, size)}`);
}

/* ---------- CSV export ---------- */

export type ExportList = 'rides' | 'users' | 'drivers' | 'transactions' | 'tickets';

/** The most rows one export holds (owner ruling Q4); 422 `export_too_large` above. */
export const EXPORT_MAX_ROWS = 50_000;

/**
 * GET /admin/exports/{list} with the list's own filter (no page / size):
 * the file holds exactly the rows the list shows, audited `export.<list>`.
 */
export function exportCsv(
  client: ApiClient,
  list: ExportList,
  filter: object,
): Promise<DownloadedFile> {
  const params = filterParams(filter).toString();
  return client.download(`/api/v1/admin/exports/${list}${params ? `?${params}` : ''}`);
}

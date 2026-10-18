import type { ApiClient } from './client';

/**
 * Contract types and calls for the M8 admin money endpoints (user wallet
 * inspection, credit grants/refunds, driver ledgers, settlements).
 * Source of truth: backend/docs/api/money-v1.yaml. Wallet reads are gated by
 * `wallets:view`, credits by `wallets:manage`, ledger reads by
 * `settlements:view`, settlement recording by `settlements:record` — the
 * same codes the UI gates on (RBAC-03; the server enforces regardless).
 *
 * Amounts are exact decimals tagged with their ISO 4217 currency; display
 * formatting is the client's job (NFR-I2 — see pages/money/money-format.ts).
 */

export interface WalletBalance {
  currency: string;
  balance: number;
}

export type RiderDueStatus = 'pending' | 'collected';

export interface RiderDue {
  id: string;
  currency: string;
  amount: number;
  type: 'cancellation_fee';
  /** The cancelled ride the fee came from. */
  sourceRideId: string;
  status: RiderDueStatus;
  collectedRideId?: string | null;
  createdAt: string;
  collectedAt?: string | null;
}

export interface WalletView {
  balances: WalletBalance[];
  /** Pending dues only. */
  dues: RiderDue[];
}

export type WalletTransactionType =
  | 'fare_payment'
  | 'tip'
  | 'cancellation_fee'
  | 'refund'
  | 'admin_grant'
  | 'referral'
  | 'promo'
  | 'loyalty_redemption';

export interface WalletTransaction {
  id: string;
  currency: string;
  /** Signed: credits positive, debits negative. */
  amount: number;
  type: WalletTransactionType;
  rideId?: string | null;
  /** Grants/refunds — shown in history. */
  reason?: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface WalletTransactionPage {
  items: WalletTransaction[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export type WalletCreditType = 'grant' | 'refund';

export interface WalletCreditRequest {
  type: WalletCreditType;
  amount: number;
  currency: string;
  reason: string;
  /** Mandatory for `refund`, optional for `grant` (PAY-03). */
  rideId?: string | null;
}

/** COM-03 — `warning` near the floor, `blocked` at/below (no new offers). */
export type FloorStatus = 'ok' | 'warning' | 'blocked';

export interface DriverBalanceEntry {
  currency: string;
  /** Signed — negative = debt. */
  balance: number;
  /** The operating region's floor (default -50). */
  floor: number;
  status: FloorStatus;
}

export type DriverLedgerType =
  | 'ride_earning'
  | 'commission_due'
  | 'tip'
  | 'cancellation_fee'
  | 'settlement_pay_in'
  | 'settlement_pay_out'
  | 'bonus'
  | 'due_collection'
  /** M13 ruling 1: the platform-funded promo discount credited to the ride's driver. */
  | 'promo_compensation';

export interface DriverLedgerEntry {
  id: string;
  currency: string;
  /** Signed. */
  amount: number;
  type: DriverLedgerType;
  rideId?: string | null;
  settlementId?: string | null;
  riderDueId?: string | null;
  fareAmount?: number | null;
  commissionRate?: number | null;
  commissionAmount?: number | null;
  balanceAfter: number;
  createdAt: string;
}

export interface DriverLedgerView {
  balances: DriverBalanceEntry[];
  entries: DriverLedgerEntry[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export type SettlementDirection = 'pay_in' | 'pay_out';

export interface SettlementRequest {
  amount: number;
  direction: SettlementDirection;
  currency: string;
  note?: string | null;
}

export interface SettlementResponse {
  id: string;
  driverUserId: string;
  currency: string;
  amount: number;
  direction: SettlementDirection;
  note?: string | null;
  createdAt: string;
  /** New balance in that currency. */
  balance: number;
  floorStatus: FloorStatus;
}

export interface PageQuery {
  currency?: string;
  page: number;
  size: number;
}

function pageParams(query: PageQuery): string {
  const params = new URLSearchParams();
  if (query.currency) {
    params.set('currency', query.currency);
  }
  params.set('page', String(query.page));
  params.set('size', String(query.size));
  return params.toString();
}

/* ---------- User wallets (UC-A-15, extends UC-A-13) ---------- */

/** GET /admin/users/{id}/wallet — balances + pending dues; wallets:view. */
export function getUserWallet(client: ApiClient, userId: string): Promise<WalletView> {
  return client.get<WalletView>(`/api/v1/admin/users/${userId}/wallet`);
}

/** GET /admin/users/{id}/wallet/transactions — typed, newest first; wallets:view. */
export function getUserWalletTransactions(
  client: ApiClient,
  userId: string,
  query: PageQuery,
): Promise<WalletTransactionPage> {
  return client.get<WalletTransactionPage>(
    `/api/v1/admin/users/${userId}/wallet/transactions?${pageParams(query)}`,
  );
}

/**
 * POST /admin/users/{id}/wallet/credits — grant or refund (PAY-03); the user
 * is notified and the action is audit-logged server-side; wallets:manage.
 * 400 = invalid amount/currency, or a refund rideId that is not this user's.
 */
export function postWalletCredit(
  client: ApiClient,
  userId: string,
  body: WalletCreditRequest,
): Promise<WalletTransaction> {
  return client.post<WalletTransaction>(`/api/v1/admin/users/${userId}/wallet/credits`, body);
}

/* ---------- Driver ledgers & settlements (UC-A-27) ---------- */

/** GET /admin/drivers/{id}/ledger — balances + typed entries, newest first; settlements:view. */
export function getDriverLedger(
  client: ApiClient,
  driverUserId: string,
  query: PageQuery,
): Promise<DriverLedgerView> {
  return client.get<DriverLedgerView>(
    `/api/v1/admin/drivers/${driverUserId}/ledger?${pageParams(query)}`,
  );
}

/**
 * POST /admin/drivers/{id}/settlements — records off-app money movement
 * (COM-04); immutable, corrected only by a counter-settlement; audit-logged
 * server-side. The response carries the new balance + floor status —
 * crossing back above the floor resumes offers and notifies the driver.
 * Requires settlements:record.
 */
export function postSettlement(
  client: ApiClient,
  driverUserId: string,
  body: SettlementRequest,
): Promise<SettlementResponse> {
  return client.post<SettlementResponse>(`/api/v1/admin/drivers/${driverUserId}/settlements`, body);
}

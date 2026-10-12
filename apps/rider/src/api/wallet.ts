import { ApiError, apiFetch } from "./http-client";

/**
 * Client slice of the money contract for the rider app
 * (backend/docs/api/money-v1.yaml, M8): wallet view (per-currency balances +
 * pending dues), typed wallet history and the tip action. Types mirror the
 * contract schemas 1:1; screens never call fetch themselves.
 */

// --------------------------------------------------------------- schemas

export interface WalletBalance {
  /** ISO 4217. */
  currency: string;
  /** Never negative (PAY-01). */
  balance: number;
}

export type RiderDueStatus = "pending" | "collected";

/**
 * A carried charge (cancellation fee the wallet could not cover, or any
 * cash-method fee) collected on the rider's next completed ride.
 */
export interface RiderDue {
  id: string;
  currency: string;
  amount: number;
  type: "cancellation_fee";
  /** The cancelled ride. */
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

export const WALLET_TRANSACTION_TYPES = [
  "fare_payment",
  "tip",
  "cancellation_fee",
  "refund",
  "admin_grant",
  "referral",
  "promo",
  "loyalty_redemption",
] as const;
export type WalletTransactionType = (typeof WALLET_TRANSACTION_TYPES)[number];

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

export interface TipResponse {
  rideId: string;
  amount: number;
  currency: string;
  /** Remaining balance in that currency. */
  walletBalance: number;
  createdAt: string;
}

// ------------------------------------------------------------- tip window

/** PAY-04: tips are allowed from `in_progress` until 24 h after completion. */
export const TIP_WINDOW_HOURS = 24;

/** When the tip window closes, or null without a completion time. */
export function tipDeadline(
  completedAt: string | null | undefined,
): number | null {
  if (!completedAt) return null;
  const completed = Date.parse(completedAt);
  if (Number.isNaN(completed)) return null;
  return completed + TIP_WINDOW_HOURS * 60 * 60 * 1000;
}

/** Whether a completed ride is still inside its tip window. */
export function withinTipWindow(
  completedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const deadline = tipDeadline(completedAt);
  return deadline !== null && now < deadline;
}

// ----------------------------------------------------------------- errors

export type TipErrorKey =
  | "windowExpired"
  | "alreadyTipped"
  | "insufficientBalance"
  | "notTippable"
  | "generic";

/**
 * Classifies a failed tip. The money contract answers 409 with DISTINCT
 * plain messages (no machine codes), so the client keys off a `code` when
 * one is present and otherwise off the message wording; anything
 * unrecognized falls back to the generic copy.
 */
export function tipErrorKey(error: unknown): TipErrorKey {
  if (!(error instanceof ApiError) || error.status !== 409) return "generic";
  const text = `${error.body?.code ?? ""} ${error.body?.message ?? ""}`;
  if (/window|expired?/i.test(text)) return "windowExpired";
  if (/already/i.test(text)) return "alreadyTipped";
  if (/balance|insufficient/i.test(text)) return "insufficientBalance";
  return "notTippable";
}

// ------------------------------------------------------------- endpoints

const WALLET = "/api/v1/wallet";

/** `GET /wallet` — balances (possibly empty) and pending dues (UC-R-17). */
export function getWallet(): Promise<WalletView> {
  return apiFetch<WalletView>(WALLET, { auth: true });
}

export const WALLET_HISTORY_PAGE_SIZE = 20;

/** `GET /wallet/transactions` — typed history, newest first (UC-R-17). */
export function listWalletTransactions(
  page = 0,
  currency?: string,
): Promise<WalletTransactionPage> {
  const filter = currency ? `&currency=${encodeURIComponent(currency)}` : "";
  return apiFetch<WalletTransactionPage>(
    `${WALLET}/transactions?page=${page}&size=${WALLET_HISTORY_PAGE_SIZE}${filter}`,
    { auth: true },
  );
}

/** `POST /rides/{rideId}/tip` — wallet-only, one per ride (PAY-04). */
export function tipRide(rideId: string, amount: number): Promise<TipResponse> {
  return apiFetch<TipResponse>(
    `/api/v1/rides/${encodeURIComponent(rideId)}/tip`,
    { method: "POST", auth: true, body: JSON.stringify({ amount }) },
  );
}

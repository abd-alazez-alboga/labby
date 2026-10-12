/**
 * Contract-shaped fixtures for money-v1.yaml (rider view). Figures follow
 * the Damascus-realistic SYP mock config of the approved M8 artboards
 * (cancellation fee 10,000; wait 500/min; pickup 500/km).
 */
import type { CarriedDue } from "../api/rides";
import type {
  RiderDue,
  TipResponse,
  WalletTransaction,
  WalletTransactionPage,
  WalletView,
} from "../api/wallet";
import { RIDE_ID } from "./ride-fixtures";

export const DUE_ID = "77777777-7777-4777-8777-777777777777";

export function walletBalance(balance = 15000, currency = "SYP") {
  return { currency, balance };
}

export function riderDue(overrides: Partial<RiderDue> = {}): RiderDue {
  return {
    id: DUE_ID,
    currency: "SYP",
    amount: 10000,
    type: "cancellation_fee",
    sourceRideId: RIDE_ID,
    status: "pending",
    collectedRideId: null,
    createdAt: "2026-10-05T09:04:00Z",
    collectedAt: null,
    ...overrides,
  };
}

/** A due carried into a ride (rides-v1 `CarriedDue`). */
export function carriedDue(overrides: Partial<CarriedDue> = {}): CarriedDue {
  return {
    dueId: DUE_ID,
    sourceRideId: "88888888-8888-4888-8888-888888888888",
    amount: 10000,
    currency: "SYP",
    method: "cash",
    status: "collected",
    ...overrides,
  };
}

export function walletView(overrides: Partial<WalletView> = {}): WalletView {
  return {
    balances: [walletBalance()],
    dues: [],
    ...overrides,
  };
}

let txCounter = 0;

export function walletTransaction(
  overrides: Partial<WalletTransaction> = {},
): WalletTransaction {
  txCounter += 1;
  return {
    id: `tx-${txCounter}`,
    currency: "SYP",
    amount: 20000,
    type: "refund",
    rideId: null,
    reason: null,
    balanceAfter: 15000,
    createdAt: "2026-10-09T10:00:00Z",
    ...overrides,
  };
}

export function transactionsPage(
  items: WalletTransaction[],
  overrides: Partial<WalletTransactionPage> = {},
): WalletTransactionPage {
  return {
    items,
    page: 0,
    size: 20,
    totalItems: items.length,
    totalPages: 1,
    ...overrides,
  };
}

export function tipResponse(overrides: Partial<TipResponse> = {}): TipResponse {
  return {
    rideId: RIDE_ID,
    amount: 5000,
    currency: "SYP",
    walletBalance: 10000,
    createdAt: "2026-10-11T10:00:00Z",
    ...overrides,
  };
}

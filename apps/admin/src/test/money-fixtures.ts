import type { UserProfile } from '../api/auth';
import type {
  DriverLedgerEntry,
  DriverLedgerView,
  WalletTransaction,
  WalletTransactionPage,
  WalletView,
} from '../api/money';
import type { AdminRideSummary, AdminRideSummaryPage } from '../api/rides';
import { adminUser, jsonResponse, stubFetchRoutes, type FetchRouteHandler } from './test-utils';

/**
 * Shared M8 admin-money fixtures, shaped exactly like the contract's schemas
 * (money-v1.yaml + the /admin/rides slice of rides-v1.yaml). Amounts use the
 * Damascus-realistic SYP figures of the approved artboards (floor −500,000).
 */

export const WALLET_VIEWER = adminUser(['wallets:view', 'rides:view']);
export const WALLET_MANAGER = adminUser(['wallets:view', 'wallets:manage', 'rides:view']);
export const LEDGER_VIEWER = adminUser(['settlements:view', 'rides:view']);
export const SETTLER = adminUser(['settlements:view', 'settlements:record', 'rides:view']);

export const USER_ID = '00000000-0000-4000-8000-00000000aa01';
export const DRIVER_ID = '00000000-0000-4000-8000-00000000bb02';
export const RIDE_1 = '00000000-0000-4000-8000-00000000cc03';
export const RIDE_2 = '00000000-0000-4000-8000-00000000cc04';

export function walletView(overrides: Partial<WalletView> = {}): WalletView {
  return {
    balances: [{ currency: 'SYP', balance: 15000 }],
    dues: [
      {
        id: 'due-1',
        currency: 'SYP',
        amount: 10000,
        type: 'cancellation_fee',
        sourceRideId: RIDE_2,
        status: 'pending',
        collectedRideId: null,
        createdAt: '2026-10-05T09:12:00Z',
        collectedAt: null,
      },
    ],
    ...overrides,
  };
}

export function transaction(overrides: Partial<WalletTransaction> = {}): WalletTransaction {
  return {
    id: 'tx-1',
    currency: 'SYP',
    amount: 20000,
    type: 'refund',
    rideId: RIDE_1,
    reason: 'overcharged wait',
    balanceAfter: 17000,
    createdAt: '2026-10-09T10:00:00Z',
    ...overrides,
  };
}

export function transactions(): WalletTransaction[] {
  return [
    transaction(),
    transaction({
      id: 'tx-2',
      amount: -2000,
      type: 'tip',
      reason: null,
      balanceAfter: 15000,
      createdAt: '2026-10-08T12:40:00Z',
    }),
    transaction({
      id: 'tx-3',
      amount: -27250,
      type: 'fare_payment',
      reason: null,
      balanceAfter: 17000,
      createdAt: '2026-10-08T12:29:00Z',
    }),
  ];
}

export function transactionPage(
  overrides: Partial<WalletTransactionPage> = {},
): WalletTransactionPage {
  const items = overrides.items ?? transactions();
  return {
    items,
    page: 0,
    size: 20,
    totalItems: items.length,
    totalPages: 1,
    ...overrides,
  };
}

export function adminRide(overrides: Partial<AdminRideSummary> = {}): AdminRideSummary {
  return {
    id: RIDE_1,
    state: 'completed',
    requestedAt: '2026-10-08T12:29:00Z',
    pickup: { lat: 33.5, lng: 36.3, label: 'Mazzeh' },
    destination: { lat: 33.52, lng: 36.31, label: 'Umayyad Square' },
    serviceTypeNameEn: 'Economy',
    serviceTypeNameAr: 'اقتصادي',
    total: 27250,
    cancellationFee: null,
    currency: 'SYP',
    kind: 'on_demand',
    regionId: 'region-1',
    regionName: 'Damascus',
    riderUserId: USER_ID,
    riderName: 'Rana Khoury',
    driverUserId: DRIVER_ID,
    driverName: 'Khaled Darwish',
    ...overrides,
  };
}

export function ridePage(items: AdminRideSummary[]): AdminRideSummaryPage {
  return { items, page: 0, size: 50, totalItems: items.length };
}

export function ledgerEntry(overrides: Partial<DriverLedgerEntry> = {}): DriverLedgerEntry {
  return {
    id: 'led-1',
    currency: 'SYP',
    amount: -7000,
    type: 'commission_due',
    rideId: RIDE_1,
    settlementId: null,
    riderDueId: null,
    fareAmount: 28000,
    commissionRate: 25,
    commissionAmount: 7000,
    balanceAfter: -430000,
    createdAt: '2026-10-11T12:24:00Z',
    ...overrides,
  };
}

export function ledgerView(overrides: Partial<DriverLedgerView> = {}): DriverLedgerView {
  return {
    balances: [{ currency: 'SYP', balance: -430000, floor: -500000, status: 'warning' }],
    entries: [
      ledgerEntry(),
      ledgerEntry({
        id: 'led-2',
        amount: 5000,
        type: 'tip',
        fareAmount: null,
        commissionRate: null,
        commissionAmount: null,
        balanceAfter: -423000,
        createdAt: '2026-10-11T12:30:00Z',
      }),
      ledgerEntry({
        id: 'led-3',
        amount: 150000,
        type: 'settlement_pay_in',
        rideId: null,
        settlementId: 'set-1',
        fareAmount: null,
        commissionRate: null,
        commissionAmount: null,
        balanceAfter: -438000,
        createdAt: '2026-10-03T09:00:00Z',
      }),
    ],
    page: 0,
    size: 20,
    totalItems: 3,
    totalPages: 1,
    ...overrides,
  };
}

/** A ledger at/below the floor — offers paused until a settlement (COM-03). */
export function blockedLedgerView(): DriverLedgerView {
  return ledgerView({
    balances: [{ currency: 'SYP', balance: -510000, floor: -500000, status: 'blocked' }],
  });
}

/**
 * Stubs the money + ride-search endpoints the M8 admin screens call.
 * `extra` wins over the defaults, so tests override single routes.
 */
export function stubMoneyRoutes(user: UserProfile, extra?: FetchRouteHandler) {
  return stubFetchRoutes((method, path, init, url) => {
    const handled = extra?.(method, path, init, url);
    if (handled) {
      return handled;
    }
    if (method !== 'GET') {
      return null;
    }
    switch (path) {
      case '/api/v1/users/me':
        return jsonResponse(200, user);
      case `/api/v1/admin/users/${USER_ID}/wallet`:
        return jsonResponse(200, walletView());
      case `/api/v1/admin/users/${USER_ID}/wallet/transactions`:
        return jsonResponse(200, transactionPage());
      case '/api/v1/admin/rides':
        return jsonResponse(200, ridePage([adminRide()]));
      case `/api/v1/admin/drivers/${DRIVER_ID}/ledger`:
        return jsonResponse(200, ledgerView());
      default:
        return null;
    }
  });
}

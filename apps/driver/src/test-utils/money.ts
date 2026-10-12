import type {
  CommissionStatus,
  DriverBalanceEntry,
  DriverBalanceView,
  EarningsPeriod,
  EarningsSummary,
  TripEarning,
  TripEarningPage,
} from "../api/money-types";
import { RIDE_ID } from "./rides";

/**
 * Contract-shaped fixtures for money-v1.yaml (driver slice). Figures follow
 * the owner-approved M8 artboards (Damascus-realistic SYP: floor −500,000,
 * 25% tier, fare 28,000 cash ride with a 5,000 tip).
 */

export const EARNINGS = "GET /api/v1/driver/earnings?page=0&size=20";
export const BALANCE = "GET /api/v1/driver/balance";

export function summaryRoute(period: EarningsPeriod, anchor: string): string {
  return `GET /api/v1/driver/earnings/summary?period=${period}&anchor=${anchor}`;
}

/** The artboard's cash trip: fare 28,000, 25% → −7,000, tip +5,000, net −2,000. */
export function tripEarningFixture(
  overrides: Partial<TripEarning> = {},
): TripEarning {
  return {
    rideId: RIDE_ID,
    completedAt: "2026-10-11T12:24:00Z",
    currency: "SYP",
    fareTotal: 28000,
    paymentMethod: "cash",
    commissionRate: 25,
    commissionAmount: 7000,
    tip: 5000,
    cancellationFee: null,
    net: -2000,
    ...overrides,
  };
}

/** The artboard's wallet trip: fare 31,500, 25% → −7,875, net +23,625. */
export function walletEarningFixture(
  overrides: Partial<TripEarning> = {},
): TripEarning {
  return tripEarningFixture({
    rideId: "5b1d3f0e-1111-4c4c-9a9a-000000000002",
    completedAt: "2026-10-11T11:02:00Z",
    paymentMethod: "wallet",
    fareTotal: 31500,
    commissionAmount: 7875,
    tip: null,
    net: 23625,
    ...overrides,
  });
}

/**
 * A MIXED wallet ride (wallet ran short): fare 28,000, wallet 10,000,
 * commission 7,000 → the server's netted fare entry is walletApplied −
 * commission = +3,000 (money-v1 D). Override `net` for the negative case.
 */
export function mixedWalletEarningFixture(
  overrides: Partial<TripEarning> = {},
): TripEarning {
  return tripEarningFixture({
    rideId: "5b1d3f0e-1111-4c4c-9a9a-000000000003",
    completedAt: "2026-10-11T10:15:00Z",
    paymentMethod: "wallet",
    fareTotal: 28000,
    commissionAmount: 7000,
    tip: null,
    net: 3000,
    ...overrides,
  });
}

/**
 * A FEE-ONLY row (contract shape): a cancelled ride whose 10,000 fee was
 * credited to this driver — no fare, no commission, net = the fee.
 */
export function feeOnlyEarningFixture(
  overrides: Partial<TripEarning> = {},
): TripEarning {
  return tripEarningFixture({
    rideId: "5b1d3f0e-1111-4c4c-9a9a-000000000004",
    completedAt: "2026-10-11T09:40:00Z",
    fareTotal: 0,
    commissionRate: 0,
    commissionAmount: 0,
    tip: null,
    cancellationFee: 10000,
    net: 10000,
    ...overrides,
  });
}

export function earningPage(
  items: TripEarning[],
  overrides: Partial<TripEarningPage> = {},
): TripEarningPage {
  return {
    items,
    page: 0,
    size: 20,
    totalItems: items.length,
    totalPages: items.length > 0 ? 1 : 0,
    ...overrides,
  };
}

/** The artboard's week: 38 trips, fares 1,064,000, tips 48,000, commission 266,000. */
export function summaryFixture(
  overrides: Partial<EarningsSummary> = {},
): EarningsSummary {
  return {
    period: "weekly",
    from: "2026-10-06",
    to: "2026-10-12",
    currency: "SYP",
    trips: 38,
    fares: 1064000,
    commission: 266000,
    tips: 48000,
    net: 846000,
    ...overrides,
  };
}

/**
 * COM-02: 25% this week, 38 trips so far; MORE than 100 trips (i.e. 101)
 * → 20% next week (backend tier condition is strictly greater-than).
 */
export function commissionFixture(
  overrides: Partial<CommissionStatus> = {},
): CommissionStatus {
  return {
    percent: 25,
    weekStart: "2026-10-06",
    weeklyTrips: 52,
    currentWeekTrips: 38,
    nextTier: { percent: 20, weeklyTripsAbove: 100 },
    ...overrides,
  };
}

/** The artboard's warning state: −430,000 against a −500,000 floor. */
export function balanceEntryFixture(
  overrides: Partial<DriverBalanceEntry> = {},
): DriverBalanceEntry {
  return {
    currency: "SYP",
    balance: -430000,
    floor: -500000,
    status: "warning",
    ...overrides,
  };
}

export function balanceViewFixture(
  overrides: Partial<DriverBalanceView> = {},
): DriverBalanceView {
  return {
    balances: [balanceEntryFixture()],
    commission: commissionFixture(),
    ...overrides,
  };
}

/** A healthy balance far from the floor. */
export function okBalanceView(): DriverBalanceView {
  return balanceViewFixture({
    balances: [balanceEntryFixture({ balance: -50000, status: "ok" })],
  });
}

/** The artboard's blocked state: −520,000 past the −500,000 floor. */
export function blockedBalanceView(): DriverBalanceView {
  return balanceViewFixture({
    balances: [balanceEntryFixture({ balance: -520000, status: "blocked" })],
  });
}

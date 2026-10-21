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
    memberId: null,
    rideState: "completed",
    kind: "on_demand",
    riderFirstName: "Rana",
    pickupLabel: "Abu Rummaneh",
    destinationLabel: "Umayyad Square",
    serviceTypeNameEn: "Economy",
    serviceTypeNameAr: "اقتصادي",
    acceptedAt: "2026-10-11T12:05:00Z",
    startedAt: "2026-10-11T12:10:00Z",
    cancelledAt: null,
    cancellationReason: null,
    cancellationFeeCharged: null,
    myReport: null,
    canReport: true,
    // The route map is on the detail only (tripDetailFixture).
    pickup: null,
    destination: null,
    route: null,
    ...overrides,
  };
}

/**
 * The artboard's cash trip as `GET /driver/earnings/rides/{rideId}` returns
 * it: the route map's pins and the in_ride trace ([lng, lat]).
 */
export function tripDetailFixture(
  overrides: Partial<TripEarning> = {},
): TripEarning {
  return tripEarningFixture({
    pickup: { lat: 33.5164, lng: 36.2873, label: "Abu Rummaneh" },
    destination: { lat: 33.5131, lng: 36.2765, label: "Umayyad Square" },
    route: {
      type: "LineString",
      coordinates: [
        [36.2873, 33.5164],
        [36.282, 33.5149],
        [36.2765, 33.5131],
      ],
    },
    ...overrides,
  });
}

/** The artboard's wallet trip: fare 31,500, 25% → −7,875, net +23,625. */
export function walletEarningFixture(
  overrides: Partial<TripEarning> = {},
): TripEarning {
  return tripEarningFixture({
    rideId: "5b1d3f0e-1111-4c4c-9a9a-000000000002",
    completedAt: "2026-10-11T11:02:00Z",
    riderFirstName: "Omar",
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
 * A FEE-ONLY row (contract shape): a ride the rider cancelled after the
 * driver accepted, whose 10,000 fee was credited to this driver — no fare,
 * no commission, net = the fee (board V1FDriverEarningsTrips, "Nour").
 */
export function feeOnlyEarningFixture(
  overrides: Partial<TripEarning> = {},
): TripEarning {
  return tripEarningFixture({
    rideId: "5b1d3f0e-1111-4c4c-9a9a-000000000004",
    completedAt: "2026-10-11T09:40:00Z",
    riderFirstName: "Nour",
    pickupLabel: "Baramkeh",
    destinationLabel: "Mazzeh",
    fareTotal: 0,
    commissionRate: 0,
    commissionAmount: 0,
    tip: null,
    cancellationFee: 10000,
    cancellationFeeCharged: 10000,
    net: 10000,
    rideState: "cancelled_by_rider",
    acceptedAt: "2026-10-11T09:30:00Z",
    startedAt: null,
    cancelledAt: "2026-10-11T09:36:00Z",
    cancellationReason: "changed_mind",
    ...overrides,
  });
}

/**
 * W43: a ride the rider cancelled after the driver accepted, inside the
 * free window — no money for the driver (board "Hadi", Fri 10 Oct).
 */
export function cancelledNoFeeFixture(
  overrides: Partial<TripEarning> = {},
): TripEarning {
  return tripEarningFixture({
    rideId: "5b1d3f0e-1111-4c4c-9a9a-000000000005",
    completedAt: "2026-10-10T18:46:00Z",
    riderFirstName: "Hadi",
    pickupLabel: "Kafr Sousa",
    destinationLabel: "Mezzeh Villas",
    fareTotal: 0,
    commissionRate: 0,
    commissionAmount: 0,
    tip: null,
    cancellationFee: null,
    net: 0,
    rideState: "cancelled_by_rider",
    acceptedAt: "2026-10-10T18:40:00Z",
    startedAt: null,
    cancelledAt: "2026-10-10T18:46:00Z",
    cancellationReason: "changed_mind",
    ...overrides,
  });
}

export function tripDetailRoute(rideId: string, memberId?: string): string {
  return `GET /api/v1/driver/earnings/rides/${rideId}${
    memberId ? `?memberId=${memberId}` : ""
  }`;
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

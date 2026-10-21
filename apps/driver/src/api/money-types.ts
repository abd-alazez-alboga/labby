/**
 * Types mirroring the M8 money contract (backend/docs/api/money-v1.yaml) —
 * the DRIVER slice: per-trip earnings, period summaries, balance + floor
 * status and the weekly commission tier. Type-only imports, so every layer
 * can depend on them without cycles.
 */

import type { ReportCategory, ReportStatus } from "./trust-types";

/** The ride's final state on a trip row (money-v1 `TripEarning.rideState`). */
export type TripRideState =
  "completed" | "cancelled_by_rider" | "cancelled_by_driver";

/**
 * V1 conformance W43 — the driver's own report on a trip row's rider
 * (REP-01: one per ride per rider; money-v1 `TripEarning.myReport`).
 */
export interface TripReport {
  id: string;
  category: ReportCategory;
  status: ReportStatus;
  createdAt: string;
}

/**
 * COM-01 itemization for one ride (`TripEarning`): a completed ride, a
 * cancelled ride whose fee was credited to this driver, or (W43) a ride the
 * driver accepted that was later cancelled without money for them.
 */
export interface TripEarning {
  rideId: string;
  completedAt: string;
  currency: string;
  fareTotal: number;
  paymentMethod: "cash" | "wallet";
  /** Percent applied (weekly tier). */
  commissionRate: number;
  commissionAmount: number;
  tip?: number | null;
  /**
   * Set only on a FEE-ONLY row: a cancelled ride whose fee was credited to
   * this driver (fareTotal, commissionRate and commissionAmount are 0 and
   * net = cancellationFee). Null on fare rows.
   */
  cancellationFee?: number | null;
  /**
   * M13 ruling 1: the platform-funded promo discount credited for this ride
   * (`promo_compensation`), already inside `net`. Null / absent when the
   * ride had no promo.
   */
  promoCompensation?: number | null;
  /**
   * Signed effect on the balance — the server's number, NEVER recomputed:
   * wallet ride walletApplied − commission (+ tip + promo compensation;
   * negative when a mixed ride's wallet part is below the commission); cash
   * ride −commission (+ tip + promo compensation) — the driver kept the cash
   * fare.
   */
  net: number;
  /** The shared-ride member the row is about (null on a one-rider ride). */
  memberId?: string | null;
  rideState: TripRideState;
  kind: "on_demand" | "scheduled" | "shared";
  /** The rider's first name (the member's on a shared ride). */
  riderFirstName?: string | null;
  pickupLabel?: string | null;
  destinationLabel?: string | null;
  serviceTypeNameEn?: string | null;
  serviceTypeNameAr?: string | null;
  acceptedAt?: string | null;
  /** Trip start (completed rides). */
  startedAt?: string | null;
  cancelledAt?: string | null;
  /** The ride's (or the member's) cancellation reason (rides-v1 values). */
  cancellationReason?: string | null;
  /**
   * The fee the rider (member) was charged for the cancellation; null = no
   * fee. What reached the driver is `cancellationFee`.
   */
  cancellationFeeCharged?: number | null;
  /** The driver's own report on this row's rider, if any. */
  myReport?: TripReport | null;
  /** True while the driver has not reported this row's rider. */
  canReport: boolean;
}

/** W43: a row of a ride cancelled after the driver accepted it. */
export function isCancelledTrip(earning: TripEarning): boolean {
  return (
    earning.rideState === "cancelled_by_rider" ||
    earning.rideState === "cancelled_by_driver"
  );
}

/** A cancellation-fee credit row (no fare, no commission) — money-v1 D. */
export function isFeeOnlyEarning(earning: TripEarning): boolean {
  return (
    earning.fareTotal === 0 &&
    earning.commissionAmount === 0 &&
    typeof earning.cancellationFee === "number" &&
    earning.cancellationFee !== 0
  );
}

/** The fare part of a row's net — the server's net minus the tip. */
export function fareNet(earning: TripEarning): number {
  return earning.net - (earning.tip ?? 0);
}

export interface TripEarningPage {
  items: TripEarning[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export type EarningsPeriod = "weekly" | "monthly";

/** UC-D-15 weekly / monthly summary. `to` is inclusive. */
export interface EarningsSummary {
  period: EarningsPeriod;
  from: string;
  to: string;
  currency: string;
  trips: number;
  fares: number;
  commission: number;
  tips: number;
  net: number;
}

/** COM-02 — the next tier this week's trips can earn (or null: best rate). */
export interface NextTier {
  percent: number;
  /** Trips needed this week to earn it next week. */
  weeklyTripsAbove: number;
}

/** COM-02 — the driver's current weekly rate and next-tier progress. */
export interface CommissionStatus {
  /** Rate applied this week. */
  percent: number;
  /** Monday, region time zone. */
  weekStart: string;
  /** Previous week's completed trips (set this rate). */
  weeklyTrips: number;
  /** Completed trips so far THIS week. */
  currentWeekTrips?: number;
  nextTier?: NextTier | null;
}

/**
 * COM-03 — `warning` within MONEY_FLOOR_WARNING_MARGIN above the floor,
 * `blocked` at/below (no new offers until settlement).
 */
export type FloorStatus = "ok" | "warning" | "blocked";

export interface DriverBalanceEntry {
  currency: string;
  /** Signed — negative = debt. */
  balance: number;
  /** The operating region's floor (default -50). */
  floor: number;
  status: FloorStatus;
}

/** `GET /driver/balance` (COM-02/03, UC-D-16). */
export interface DriverBalanceView {
  balances: DriverBalanceEntry[];
  commission?: CommissionStatus | null;
}

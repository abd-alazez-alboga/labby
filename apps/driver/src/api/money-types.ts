/**
 * Types mirroring the M8 money contract (backend/docs/api/money-v1.yaml) —
 * the DRIVER slice: per-trip earnings, period summaries, balance + floor
 * status and the weekly commission tier. Import-free so every layer can
 * depend on them without cycles.
 */

/** COM-01 itemization for one completed ride (`TripEarning`). */
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
   * Signed effect on the balance — the server's number, NEVER recomputed:
   * wallet ride walletApplied − commission (+ tip; negative when a mixed
   * ride's wallet part is below the commission); cash ride −commission
   * (+ tip) — the driver kept the cash fare.
   */
  net: number;
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

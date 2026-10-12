/**
 * The little money arithmetic the rider app still does on the client, in
 * INTEGER MINOR UNITS (2 dp) so 2-dp amounts never drift into float noise:
 * - the "How you paid" split rows (PAY-02) shared by the ride-complete
 *   screen and the receipt — carried dues are rendered from the server's
 *   itemized `carriedDues`, never derived by subtraction;
 * - the wait-charge courtesy preview (PRC-03), prorated per second exactly
 *   like the backend's RideExtrasCalculator.
 * Authoritative amounts always come from the server.
 */
import type { CarriedDue, PaymentMethod } from "../api/rides";

/** 12.34 → 1234 (amounts carry at most 2 decimals). */
export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

/** 1234 → 12.34. */
export function fromMinor(minor: number): number {
  return minor / 100;
}

/** HALF_UP integer division for non-negative operands. */
function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * Wait charge accrued `elapsedMs` after the grace ended, at `ratePerMinute`:
 * whole elapsed seconds → minutes (6 dp, HALF_UP) × rate → 2 dp HALF_UP —
 * the backend's `RideExtrasCalculator.waitFare` formula.
 */
export function waitChargePreview(elapsedMs: number, ratePerMinute: number): number {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds <= 0 || ratePerMinute <= 0) return 0;
  const microMinutes = divideHalfUp(seconds * 1_000_000, 60);
  return fromMinor(divideHalfUp(microMinutes * toMinor(ratePerMinute), 1_000_000));
}

export type PaymentRowKind = "wallet" | "cash" | "due" | "handed";

export interface PaymentRow {
  key: string;
  kind: PaymentRowKind;
  amount: number;
  /** Set on `due` rows: how that carried due was paid. */
  method?: PaymentMethod;
}

/**
 * The "How you paid" rows (approved artboards RiderComplete /
 * RiderReceiptSplit), identical on the ride-complete screen and the receipt:
 * - wallet: the wallet part of the fare (`walletApplied`);
 * - cash: the fare's cash remainder (`cashDue` minus the CASH carried dues),
 *   shown only next to a split;
 * - due: one row per carried due, labelled by its method;
 * - handed: everything handed to the driver in cash (`cashDue`).
 * Empty when there is no split (no wallet part and no carried due).
 */
export function paymentRows({
  walletApplied,
  cashDue,
  carriedDues,
}: {
  walletApplied?: number | null;
  cashDue?: number | null;
  carriedDues?: CarriedDue[] | null;
}): PaymentRow[] {
  const dues = carriedDues ?? [];
  const walletMinor = toMinor(walletApplied ?? 0);
  const cashDueMinor = toMinor(cashDue ?? 0);
  if (walletMinor <= 0 && dues.length === 0) return [];
  const cashDuesMinor = dues
    .filter((due) => due.method === "cash")
    .reduce((sum, due) => sum + toMinor(due.amount), 0);
  const fareCashMinor = Math.max(0, cashDueMinor - cashDuesMinor);
  const rows: PaymentRow[] = [];
  if (walletMinor > 0) {
    rows.push({ key: "wallet", kind: "wallet", amount: fromMinor(walletMinor) });
  }
  if (fareCashMinor > 0) {
    rows.push({ key: "cash", kind: "cash", amount: fromMinor(fareCashMinor) });
  }
  dues
    .filter((due) => toMinor(due.amount) > 0)
    .forEach((due) => {
      rows.push({
        key: `due-${due.dueId}`,
        kind: "due",
        amount: due.amount,
        method: due.method,
      });
    });
  if (cashDueMinor > 0) {
    rows.push({ key: "handed", kind: "handed", amount: fromMinor(cashDueMinor) });
  }
  return rows;
}

/**
 * Client money arithmetic in integer minor units: the shared "How you paid"
 * rows (itemized carried dues, no float derivation) and the per-second
 * wait-charge preview matching RideExtrasCalculator.
 */
import type { CarriedDue } from "../../api/rides";
import { paymentRows, waitChargePreview } from "../money-math";

function due(overrides: Partial<CarriedDue> = {}): CarriedDue {
  return {
    dueId: "d1",
    sourceRideId: "r0",
    amount: 2,
    currency: "USD",
    method: "cash",
    status: "earmarked",
    ...overrides,
  };
}

describe("paymentRows", () => {
  it("is empty without a wallet part or a carried due", () => {
    expect(paymentRows({ walletApplied: null, cashDue: 27250, carriedDues: [] })).toEqual([]);
    expect(paymentRows({ walletApplied: 0, cashDue: null })).toEqual([]);
  });

  it("never renders a phantom carried-fee line on 2-dp mixed amounts", () => {
    // 10.1 - 0.3 style float noise: the old derivation produced a 0.00 due.
    const rows = paymentRows({
      walletApplied: 0.3,
      cashDue: 9.8,
      carriedDues: [],
    });
    expect(rows.map((row) => [row.kind, row.amount])).toEqual([
      ["wallet", 0.3],
      ["cash", 9.8],
      ["handed", 9.8],
    ]);
  });

  it("subtracts only CASH carried dues from cashDue for the fare's cash rest", () => {
    const rows = paymentRows({
      walletApplied: 4.1,
      cashDue: 8.3, // 6.2 fare cash + 2.10 cash due
      carriedDues: [
        due({ dueId: "cash", amount: 2.1, method: "cash" }),
        due({ dueId: "wallet", amount: 1.55, method: "wallet", status: "collected" }),
      ],
    });
    expect(rows).toEqual([
      { key: "wallet", kind: "wallet", amount: 4.1 },
      { key: "cash", kind: "cash", amount: 6.2 },
      { key: "due-cash", kind: "due", amount: 2.1, method: "cash" },
      { key: "due-wallet", kind: "due", amount: 1.55, method: "wallet" },
      { key: "handed", kind: "handed", amount: 8.3 },
    ]);
  });

  it("shows a wallet-paid due on a fully wallet-paid ride without cash rows", () => {
    const rows = paymentRows({
      walletApplied: 21800,
      cashDue: null,
      carriedDues: [due({ amount: 10000, currency: "SYP", method: "wallet", status: "collected" })],
    });
    expect(rows.map((row) => row.kind)).toEqual(["wallet", "due"]);
  });
});

describe("waitChargePreview", () => {
  it("prorates per second at the per-minute rate (HALF_UP to 2 dp)", () => {
    expect(waitChargePreview(210_000, 500)).toBe(1750);
    expect(waitChargePreview(90_000, 0.25)).toBe(0.38); // 1.5 min × 0.25 = 0.375
    expect(waitChargePreview(61_999, 0.25)).toBe(0.25); // whole seconds only
    expect(waitChargePreview(20_000, 0.25)).toBe(0.08); // 0.333333 × 0.25 = 0.0833
  });

  it("is 0 before the grace ends or without a rate", () => {
    expect(waitChargePreview(-5_000, 500)).toBe(0);
    expect(waitChargePreview(999, 500)).toBe(0);
    expect(waitChargePreview(60_000, 0)).toBe(0);
  });
});

/**
 * M8-T4 — the pure money pieces: currency formatting (NFR-I2; owner
 * rulings 2026-10-11 — Western digits in Arabic, "ل.س" for SYP, signed
 * amounts in LTR isolates), the period-anchor stepping and labels, and the
 * floor status derivation.
 */
import {
  formatAmountValue,
  formatMoney,
  formatSignedMoney,
  isolateDigits,
  LTR_ISOLATE_END,
  LTR_ISOLATE_START,
  MINUS,
  pluralCategory,
} from "../money/format";
import {
  floorAlertEntry,
  operatingEntry,
} from "../money/DriverMoneyProvider";
import {
  localRange,
  monthStartIso,
  periodLabel,
  samePeriod,
  stepAnchor,
  weekStartIso,
} from "../money/periods";
import { floorFraction, floorHeadroom } from "../components/money/floor";
import { tripsForNextTier } from "../components/money/earnings-screen";
import { fareNet, isFeeOnlyEarning } from "../api/money-types";
import {
  balanceEntryFixture,
  balanceViewFixture,
  blockedBalanceView,
  feeOnlyEarningFixture,
  mixedWalletEarningFixture,
  tripEarningFixture,
} from "../test-utils/money";

describe("money formatting (NFR-I2)", () => {
  it("formats English amounts as 'SYP 28,000' with the artboard's signs", () => {
    expect(formatMoney(28000, "SYP", "en")).toBe("SYP 28,000");
    expect(formatMoney(-430000, "SYP", "en")).toBe("SYP 430,000");
    expect(formatSignedMoney(-7000, "SYP", "en")).toBe(`${MINUS}SYP 7,000`);
    expect(formatSignedMoney(5000, "SYP", "en", { alwaysSign: true })).toBe(
      "+SYP 5,000",
    );
    expect(formatSignedMoney(23625, "SYP", "en")).toBe("SYP 23,625");
    expect(formatSignedMoney(0, "SYP", "en", { alwaysSign: true })).toBe(
      "SYP 0",
    );
  });

  it("keeps decimals exact to 2 places and drops trailing zeros", () => {
    expect(formatAmountValue(7875.5)).toBe("7,875.5");
    expect(formatAmountValue(7875.25)).toBe("7,875.25");
    expect(formatAmountValue(7875)).toBe("7,875");
  });

  it("Arabic: WESTERN digits, 'ل.س' for SYP, the amount inside an LTR isolate", () => {
    expect(formatMoney(15000, "SYP", "ar")).toBe(
      `${LTR_ISOLATE_START}15,000${LTR_ISOLATE_END} ل.س`,
    );
    expect(formatSignedMoney(-27250, "SYP", "ar")).toBe(
      `${LTR_ISOLATE_START}${MINUS}27,250${LTR_ISOLATE_END} ل.س`,
    );
    expect(formatSignedMoney(20000, "SYP", "ar", { alwaysSign: true })).toBe(
      `${LTR_ISOLATE_START}+20,000${LTR_ISOLATE_END} ل.س`,
    );
    // No Arabic-Indic digits anywhere (owner ruling 2026-10-11).
    expect(formatMoney(123456789, "SYP", "ar")).not.toMatch(/[٠-٩]/u);
  });

  it("keeps other ISO codes as-is and isolates bare digit runs only in Arabic", () => {
    expect(formatMoney(12, "USD", "ar")).toBe(
      `${LTR_ISOLATE_START}12${LTR_ISOLATE_END} USD`,
    );
    expect(isolateDigits("25%", "ar")).toBe(
      `${LTR_ISOLATE_START}25%${LTR_ISOLATE_END}`,
    );
    expect(isolateDigits("25%", "en")).toBe("25%");
  });
});

describe("earnings periods (UC-D-15)", () => {
  it("anchors weeks on Monday and steps by 7 days", () => {
    expect(weekStartIso("2026-10-11")).toBe("2026-10-05"); // a Sunday
    expect(weekStartIso("2026-10-05")).toBe("2026-10-05");
    expect(stepAnchor("weekly", "2026-10-11", -1)).toBe("2026-09-28");
    expect(stepAnchor("weekly", "2026-10-11", 1)).toBe("2026-10-12");
    expect(localRange("weekly", "2026-10-11")).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });

  it("anchors months on the 1st and steps across year ends", () => {
    expect(monthStartIso("2026-10-11")).toBe("2026-10-01");
    expect(stepAnchor("monthly", "2026-01-15", -1)).toBe("2025-12-01");
    expect(stepAnchor("monthly", "2026-12-15", 1)).toBe("2027-01-01");
    expect(localRange("monthly", "2026-02-10")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("samePeriod guards the next-step against the future", () => {
    expect(samePeriod("weekly", "2026-10-05", "2026-10-11")).toBe(true);
    expect(samePeriod("weekly", "2026-10-04", "2026-10-11")).toBe(false);
    expect(samePeriod("monthly", "2026-10-01", "2026-10-31")).toBe(true);
    expect(samePeriod("monthly", "2026-09-30", "2026-10-01")).toBe(false);
  });

  it("labels the week like the artboard and the month by name — Western digits in Arabic", () => {
    expect(periodLabel("weekly", "2026-10-06", "2026-10-12", "en")).toBe(
      "Tue 6 – Mon 12 Oct",
    );
    expect(periodLabel("monthly", "2026-10-01", "2026-10-31", "en")).toBe(
      "October 2026",
    );
    const arabic = periodLabel("weekly", "2026-10-06", "2026-10-12", "ar");
    expect(arabic).toContain("6");
    expect(arabic).toContain("12");
    expect(arabic).not.toMatch(/[٠-٩]/u);
  });
});

describe("floor status (COM-03)", () => {
  it("gates on the OPERATING currency only, never the worst across currencies (W16)", () => {
    const mixed = balanceViewFixture({
      balances: [
        balanceEntryFixture({ currency: "USD", balance: -80, floor: -50, status: "blocked" }),
        balanceEntryFixture({ balance: -50000, status: "ok" }),
      ],
    });
    // Operating region in SYP: the blocked USD balance does not gate.
    expect(operatingEntry(mixed, "SYP")?.currency).toBe("SYP");
    expect(floorAlertEntry(mixed, "SYP", false)).toBeNull();
    // Operating region in USD: it does.
    expect(floorAlertEntry(mixed, "USD", false)?.currency).toBe("USD");
    // Region unknown: a single entry is the operating one; several are not guessed…
    expect(operatingEntry(blockedBalanceView(), null)?.status).toBe("blocked");
    expect(operatingEntry(mixed, null)).toBeNull();
    expect(floorAlertEntry(mixed, null, false)).toBeNull();
    // …unless the server says offers are blocked for the floor.
    expect(floorAlertEntry(mixed, null, true)?.currency).toBe("USD");
    expect(floorAlertEntry(balanceViewFixture({ balances: [] }), "SYP", true)).toBeNull();
    expect(floorAlertEntry(null, null, false)).toBeNull();
  });

  it("subtracts the floor headroom in integer minor units", () => {
    // 0.3 − 0.1 in floats is 0.19999999999999998.
    expect(
      floorHeadroom(balanceEntryFixture({ currency: "USD", balance: 0.3, floor: 0.1 })),
    ).toBe(0.2);
    expect(floorHeadroom(balanceEntryFixture())).toBe(70000);
  });

  it("maps the debt progress toward the floor onto 0..1", () => {
    expect(
      floorFraction(balanceEntryFixture({ balance: -430000, floor: -500000 })),
    ).toBeCloseTo(0.86);
    expect(
      floorFraction(balanceEntryFixture({ balance: -520000, floor: -500000 })),
    ).toBe(1);
    expect(
      floorFraction(balanceEntryFixture({ balance: 10000, floor: -500000 })),
    ).toBe(0);
  });
});

describe("count plurals (EN one/other, AR CLDR)", () => {
  it("picks the CLDR category for whole counts", () => {
    expect([0, 1, 2, 38].map((n) => pluralCategory(n, "en"))).toEqual([
      "other",
      "one",
      "other",
      "other",
    ]);
    expect(
      [0, 1, 2, 3, 10, 11, 99, 100, 101, 103, 111].map((n) =>
        pluralCategory(n, "ar"),
      ),
    ).toEqual([
      "zero",
      "one",
      "two",
      "few",
      "few",
      "many",
      "many",
      "other",
      "other",
      "few",
      "many",
    ]);
  });
});

describe("trip earning rows (money-v1 D)", () => {
  it("tells fee-only rows from fare rows and never recomputes the fare part", () => {
    expect(isFeeOnlyEarning(feeOnlyEarningFixture())).toBe(true);
    expect(isFeeOnlyEarning(tripEarningFixture())).toBe(false);
    // Cash ride: net −2,000 incl. the +5,000 tip → fare part −7,000.
    expect(fareNet(tripEarningFixture())).toBe(-7000);
    // Mixed wallet ride: the server's net, as is.
    expect(fareNet(mixedWalletEarningFixture())).toBe(3000);
  });

  it("needs weeklyTripsAbove + 1 trips for the next tier (strict >)", () => {
    expect(tripsForNextTier({ percent: 20, weeklyTripsAbove: 100 })).toBe(101);
  });
});

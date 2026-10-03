# M8 — Money

> Status lives in `README.md`. Prereq: M7 `review_passed`.

## User stories
- As a rider, I hold per-currency wallet credit, pay fares with it (cash remainder when short), and tip from it. (UC-R-07/08/17, PAY-01/02/04)
- As a driver, I see per-trip earnings, my tiered commission, my running balance — and I get blocked below the floor until settlement. (UC-D-15/16, COM-01…04)
- As an admin, I grant credits/refunds and record settlements. (UC-A-15/27)
- As a rider/driver, wait-time and pickup-distance extras and cancellation fees are charged per region config. (PRC-03)

## Scope
SRS: PAY-01…04, COM-01…04, PRC-03 execution (wait charges incl. grace clock from M7's Arrived, pickup-distance fee with toggles, cancellation-fee collection incl. M7-recorded fees), minimum fare already live. Commission weekly recalc job.

**Out:** promos/referrals/loyalty credit **sources** (M13 — the wallet accepts typed credits now); incentives engine (M15).

## Tickets

### M8-T1 — Money contract & migrations
Migrations: `wallet_balances` (user × currency, non-negative constraint), `wallet_transactions` (typed, signed, linked), `driver_ledger` (typed entries), `settlements`, commission-rate tracking per driver-week. Contracts: wallet views, tip, refund/grant (admin), settlement record, earnings views (per-trip, weekly/monthly), balance + floor status.
**AC:** append-only enforced (no update/delete paths on ledgers); balance = derivable sum, verified by test; migrations clean.

### M8-T2 — Money backend
Wallet service (per-currency, never negative); payment application at completion: cash / wallet / wallet-then-cash remainder, shown split; extras into the fare engine: wait charges (grace from Arrived, per-minute, rider notified when accrual starts), pickup-distance fee (threshold + per-km, toggle-gated, disclosed pre-booking), cancellation-fee collection (incl. ones recorded in M7); tips (wallet-only source, ≤24 h, 100% to driver, commission-free); driver ledger postings per COM-01 (wallet ride credit-minus-commission; cash ride commission debit); tiered commission with weekly recalc from previous week's completed trips; floor blocking (offers stop below −50, warning before, auto-unblock after settlement); settlement recording (admin, permission-gated, audited); refunds/grants (linked + reasoned).
**AC:** integration tests: every PAY/COM row incl. mixed payment math, tip window expiry, tier boundaries (99/100/101, 199/200/201 trips), floor block→settle→unblock, cash-ride debt accumulation; ledger invariants (sum of entries = balance) property-tested; money stored as exact decimal, currency-tagged.

### M8-T3 — Rider app: wallet, tips, fees
Wallet screen (per-currency balances, typed history); payment method choice with wallet-shortfall preview; tip flow (suggested + custom, window-aware); wait-charge accrual notice during pickup wait; pickup-distance fee disclosure in booking; cancellation-fee display.
**AC:** UC-R-07/08/17 flows + exceptions against mocks; amounts always currency-formatted per region (NFR-I2); tests green.

### M8-T4 — Driver app: earnings & balance
Per-trip earnings breakdown on completion (fare, commission rate+amount, tip); earnings summaries (weekly/monthly); commission-tier status + next-tier progress; balance view with debt explanation; floor warnings and blocked state with settlement instructions.
**AC:** UC-D-15/16 flows against mocks; blocked state unmistakable; tests green.

### M8-T5 — Admin UI: grants, refunds, settlements
From user profile / ride detail: grant credit, issue refund (reason + link mandatory); driver ledger view; settlement recording (pay-in/pay-out) with instant floor-status feedback; wallet/ledger visible in user inspection (extends UC-A-13 screen).
**AC:** UC-A-15/27 end-to-end in UI; permission-gated; audited; tests green.

### M8-T6 — Money integration
E2e on the simulation harness: wallet-paid ride, mixed-payment ride, cash ride accumulating debt → floor block → settlement → unblock; tip; refund; weekly tier recalc on a controlled clock.
**AC:** scripted scenarios pass; every ledger line traceable to its ride/action.

### M8-T7 — Review audit
Audit against PAY/COM/PRC-03, UC-R-07/08/17, UC-D-15/16, UC-A-15/27; money-math review (rounding, currency isolation, race on concurrent completion+tip); ledger immutability.
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4 ∥ T5) → T6 → T7
```

## Milestone acceptance criteria
- Every monetary event lands as an immutable, typed, linked ledger entry; balances always equal their ledger sums.
- Floor blocking and settlement provably work on a controlled clock.
- All extras charge exactly per region config and appear itemized everywhere.
- Tracker updated; review audit passed.

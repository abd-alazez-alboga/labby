# M13 — Growth

> Status lives in `README.md`. Prereq: M12 `review_passed`.

## User stories
- As a rider, I apply promo codes at booking and get first-ride discounts. (UC-R-04 A1, GRW-01/02)
- As a user, I share my referral code; when my referee completes a first ride, we both get credit. (UC-R-18, GRW-03)
- As a rider, I earn loyalty points on every completed ride and redeem them for wallet credit. (UC-R-19, GRW-04)
- As a rider/driver, I earn badges, join admin-created challenges, and level up on lifetime points. (UC-S-23/24, GAME)
- As an admin, I manage promos and challenges. (UC-A-26/28)

## Scope
SRS: GRW-01…04, GAME-01…03. All credit flows land in the M8 wallet as typed transactions; points/levels per the lifetime model.

## Tickets

### M13-T1 — Growth contract & migrations
Migrations: `promos`/`promo_redemptions`, `referrals` (code, referrer, referee, status), `points_accounts`/`points_transactions` (redeemable + lifetime), `badges` catalog/`user_badges`, `challenges`/`challenge_progress`. Contracts: promo validate/apply (booking hook), promo admin CRUD, referral share/enter/status, loyalty balance/redeem, badges/levels views, challenges admin CRUD + user list/progress.
**AC:** redemption limits and referral uniqueness at DB level; migrations clean.

### M13-T2 — Promos, referrals, loyalty, gamification backend
Promo engine: validation (window, caps, per-user limit, region/service restriction, first-ride flag) + application into the fare breakdown (discount component); referral: code generation, registration capture, reward on referee's **first completed ride** (both sides, typed wallet credits), self-referral + reactivation-abuse blocks; loyalty: accrual (1 pt/currency unit on completion), redemption (threshold, rate → wallet credit); badges: fixed catalog awarding on milestone events (10th/50th/100th ride, first shared ride, first referral, 5-star week) with notifications; challenges: admin CRUD (role, region, window, goal, reward), progress tracking from live events, auto-credit on completion, early-end honoring completions; levels from lifetime points (riders: loyalty earned; drivers: trips + challenges), never decreasing on redemption.
**AC:** integration tests: every promo restriction, stacking order in the breakdown (promo after extras, floor at zero), referral end-to-end incl. abuse blocks, accrual/redemption math, badge triggers exactly-once, challenge window edges, level thresholds unaffected by spending.

### M13-T3 — Rider app: growth features
Promo entry in booking (validation feedback, discount in estimate + breakdown); referral screen (code/link share, status of referees); loyalty screen (balance, history, redeem); badges/levels on profile; challenges list with live progress.
**AC:** UC-R-18/19, UC-S-23/24 flows + exceptions against mocks; tests green.

### M13-T4 — Driver app + admin: challenges & promos
Driver app: badges/levels, challenges with progress. Admin: promo CRUD + redemption monitoring + deactivate; challenge CRUD + participation view + early-end.
**AC:** UC-A-26/28 end-to-end; permission-gated + audited; tests green.

### M13-T5 — Integration
E2e: new seeded user registers with a referral code → first ride completes → both credited; promo-discounted ride shows correct breakdown; loyalty accrues and redeems into a visible wallet credit spent on the next ride; a challenge completes and credits points; a badge fires once.
**AC:** scripted scenario passes; all credits traceable in ledgers.

### M13-T6 — Review audit
Audit against GRW/GAME and the UCs; abuse-path review (promo stacking, referral farming, redemption races); exactly-once guarantees.
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4) → T5 → T6
```

## Milestone acceptance criteria
- Every growth mechanism pays out exactly once, into the wallet, traceably.
- Promo math is correct in the stored breakdown, never recomputed.
- Abuse paths (self-referral, reactivation, stacking) provably blocked.
- Tracker updated; review audit passed.

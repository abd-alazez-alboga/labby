# M12 — Scheduled & Shared Rides

> Status lives in `README.md`. Prereq: M11 `review_passed`.

## User stories
- As a rider, I schedule a ride for any future time; a driver claims it; I get reminders; unclaimed rides fall back to live dispatch. (UC-R-10/11, RIDE-S)
- As a driver, I see a claim board filtered by my availability windows and claim rides that fit my day. (UC-D-11/12, RIDE-S2)
- As a rider, I create a public shared ride (one pickup, one destination) or join someone else's; the fare splits per seat. (UC-R-12…15, RIDE-P)
- As a driver, I take shared rides sized to my vehicle and collect per member. (UC-D-13)

## Scope
SRS: RIDE-S1…4, RIDE-P1…5, DRV-05 (availability windows now consumed by the board). Pricing-at-ride-time for scheduled (surge evaluated at execution); per-seat split in the fare engine for shared.

## Tickets

### M12-T1 — Scheduled/shared contract & migrations
Migrations: scheduled extension (time, claim state, reminder/fallback marks), shared extension (creator, seats, members + party sizes, dispatch trigger, per-seat shares). Contracts: schedule/cancel scheduled, claim board (list/claim/release), shared create/browse/join/leave/start, reminder + fallback job specs, split-fare completion shape.
**AC:** state rules documented (claim races, member races on last seat); migrations clean.

### M12-T2 — Scheduled & shared backend
Scheduled: booking with future time (reject past/too-near per cutoff), board query (availability windows × region × service type), claim (lock, race-safe) / release (cancellation metric fed), reminder job (24 h + 1 h, both parties), fallback job (T−15 min → live dispatch → early failure notification), conversion to live `accepted` at pickup time, scheduled cancellation terms; shared: create (capacity validation), browse/search, join (first-come, seat-race-safe), leave (pre-dispatch frees seats; post-dispatch = cancellation rules), creator cancel (group notify), dispatch triggers (creator manual / auto-on-full) → vehicle-capacity-aware dispatch, completion with per-seat split (each member's own payment method, own receipt, own rating right).
**AC:** integration tests: claim race (two drivers), last-seat race (two joiners), fallback timing on controlled clock, reminder delivery, per-seat math incl. mixed payment methods and a no-show member, member leave edge at dispatch moment.

### M12-T3 — Rider app: scheduling & shared rides
Schedule flow (date/time picker, "priced at ride time" flag), scheduled list with claim status + cancel; shared: create (pickup, destination, departure/when-full, seats, party size), browse/search with occupancy, join/leave, creator controls (start now, cancel), member view (occupancy, departure rule), per-seat completion breakdown.
**AC:** UC-R-10…15 flows + exceptions against mocks; tests green.

### M12-T4 — Driver app: claim board & shared flow
Weekly availability-windows screen (UC-D-05, DRV-05 — owner decision 2026-10-16: lives in this ticket); claim board (filtered to availability windows; claim/release); claimed-rides list with reminders; conversion to live flow at pickup time; shared-ride offers labeled with party composition; member list at pickup (mark no-show), per-member collection at completion.
**AC:** UC-D-05 + UC-D-11…13 flows + exceptions against mocks; tests green.

### M12-T5 — Integration
E2e on harness + controlled clock: schedule → claim → reminders → fulfil; schedule → unclaimed → fallback → live match; shared: create → 2 joiners (one cash, one wallet) → auto-start on full → complete → three correct per-seat receipts; member no-show path.
**AC:** scripted scenarios pass; every member's ledger/receipt correct.

### M12-T6 — Review audit
Audit against RIDE-S/RIDE-P and the UCs; race-condition review (claims, seats); clock-job robustness (restart during pending reminders/fallbacks).
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4) → T5 → T6
```

## Milestone acceptance criteria
- Scheduled rides are claimable, reminded, and fallback-protected on a controlled clock.
- Shared rides enforce seats, split per seat exactly, and settle each member independently.
- All races (claim, last seat) provably safe.
- Tracker updated; review audit passed.

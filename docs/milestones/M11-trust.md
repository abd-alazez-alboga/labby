# M11 — Trust & Quality

> Status lives in `README.md`. Prereq: M10 `review_passed`.

## User stories
- As a rider/driver, I rate my counterpart after each ride; only aggregates are ever shown. (UC-S-17, RATE)
- As a rider/driver, I report the other party and the case is investigated with evidence. (UC-S-18, REP)
- As a driver, I see my performance metrics and get warnings before anything bites. (UC-D-20, DRV-06/07)
- As an admin, I work the reports queue and flagged accounts, and suspend/reactivate with reasons. (UC-A-14/16/17)
- As the system, I auto-suspend on rating thresholds — per region config. (USR-05)

## Scope
SRS: RATE-01…03, REP-01…03, USR-04/05/06 (full suspension machinery incl. manual admin UI), DRV-06/07 (metrics from M7's offers/rides data, on-time from quoted ETA vs Arrived). Report evidence = ride record + GPS trace + chat log (CHAT-03, available since M10).

## Tickets

### M11-T1 — Trust contract & migrations
Migrations: `ratings` (ride × rater-role unique, immutable), `reports` (category, evidence refs, status, resolution), flag records, metric snapshots/windows. Contracts: rate, report (both directions, categories per role), admin queues (reports, flags), suspend/reactivate, driver performance dashboard, rating prompts in ride flow.
**AC:** immutability + uniqueness at DB level; migrations clean.

### M11-T2 — Ratings, reports, metrics backend
Ratings: prompt eligibility (completed, ≤7 days, once), per-role rolling aggregates, aggregate-only exposure (RATE-02); low-rating admin flag (RATE-03); auto-suspension per region thresholds + minimum counts (USR-05) with notification; reports workflow (submit with evidence → queue → investigate → `substantiated/unsubstantiated` + notes → reporter outcome notification); 3-substantiated-in-90-days flag (REP-03); driver metrics: acceptance (offers trail), cancellation, on-time (Arrived ≤ quoted ETA + 5 min), rolling 7/30-day windows; warnings on thresholds (DRV-07) — warn only; manual suspend/reactivate service (role-level, reasoned, notified, audited).
**AC:** integration tests: rating window/uniqueness/immutability, aggregate math, auto-suspend exactly at thresholds (clock-controlled), reactivation, flag triggers (3-in-90 sliding window), metric formulas against fixtures, warning (not suspension) on metric breaches.

### M11-T3 — Apps: rating, reporting, performance
Rider + driver apps: post-ride rating prompt (skippable, re-accessible from history within window), report flow (categories per direction, text/photos), suspended-state screens with reasons; driver app: performance dashboard (4 metrics, windows, active warnings with the triggering rule), rating-threshold proximity warning.
**AC:** UC-S-17/18, UC-D-20 flows + exceptions against mocks; tests green.

### M11-T4 — Admin: reports queue & flags
Reports queue with evidence panel (ride detail, trace, chat log inline); resolution flow; flagged-accounts queue (low rating, metric warnings, report threshold) with act/dismiss paths; full suspend/reactivate UI on user profiles (role-level, mandatory reason) — completes UC-A-13's profile with ratings/reports/flags sections.
**AC:** UC-A-14/16/17 end-to-end; permission-gated; audited; tests green.

### M11-T5 — Trust integration
E2e: ride → both rate → aggregates move; drive a seeded account below the rating threshold → auto-suspension fires + notification → admin reactivates; report with evidence → substantiate ×3 → flag appears; metric warning appears for a high-cancel seeded driver.
**AC:** scripted scenarios pass on controlled data/clock.

### M11-T6 — Review audit
Audit against RATE/REP/USR-04…06/DRV-06/07 and the UCs; privacy review (no per-ride rating attribution leaks anywhere, incl. timing side-channels like instant average moves on a single ride — documented mitigation).
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4) → T5 → T6
```

## Milestone acceptance criteria
- Ratings, reports, flags, warnings, and suspensions all fire exactly per config, provably, on controlled clocks.
- The rated party can never attribute a rating to a ride or person.
- Admin trust tooling is complete and audited.
- Tracker updated; review audit passed.

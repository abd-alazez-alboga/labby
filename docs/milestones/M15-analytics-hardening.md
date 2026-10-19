# M15 — Analytics & Launch Hardening

> Status lives in `README.md`. Prereq: M14 `review_passed`. Final V1 milestone.

## User stories
- As an admin, I run the business from a metrics dashboard and export filtered CSVs. (UC-A-30/31, ADM-02/06)
- As a driver, weekly/peak/rating incentives credit automatically and I track my progress. (UC-D-17, DRV-08)
- As the owner, V1 provably holds 1,000 concurrent users, backs itself up nightly with tested restores, and has a written launch-gate checklist. (NFR-P1/A1/A2, ES-04 migration gate)
- As any user, both languages are complete everywhere — no missing strings, no broken RTL. (NFR-I1)

## Tickets

### M15-T1 — Analytics backend & CSV export
Aggregate queries + endpoints for ADM-02's four groups (rides, revenue, users, ops) with date-range + region filters; CSV export endpoints on rides/users/drivers/transactions/tickets respecting active filters, audit-logged.
**AC:** metric formulas tested against seeded fixtures (counts verified by hand); exports match on-screen filters exactly; heavy queries bounded (indexed, time-limited).

**Owner rulings (2026-10-20, T1 plan gate; contract `backend/docs/api/analytics-v1.yaml`):** (Q1) T1 adds backend list endpoints for users, drivers and transactions (none existed), and each export reuses its list's exact filter; T2 adds those three list screens (canvas boards first). (Q2) formulas as in the contract — "active" = ≥1 completed ride in the range, pickup time = actual accept→arrive. (Q3) drivers online and active surge zones are point-in-time ("now"), not range-bound. (Q4) export cap 50,000 rows, 422 `export_too_large` above it. (Q5) transactions = rider wallet transactions + driver ledger entries in one list with a `source` column. (Q6) signups are platform-wide (users carry no region), labelled so.

### M15-T2 — Admin dashboard UI
Dashboard home: cards + charts for the four groups, date-range + region filters; export buttons on the five list screens.
**AC:** UC-A-30/31 end-to-end; charts correct against fixtures; permission-gated; tests green.

### M15-T3 — Incentives engine
Weekly trip bonuses (50 @ 40+, 100 @ 60+), peak-hour bonus (+1.00/trip in admin-defined windows), weekly rating reward (20 @ ≥4.8 with ≥30 trips) — all per-region configurable (config screens exist since M4; wire + verify), evaluated by scheduled jobs, credited to the driver ledger (COM-01) with notifications; driver app incentives screen with live progress (UC-D-17); admin threshold configuration verified end-to-end (UC-A-29).
**AC:** boundary tests (39/40/41 trips etc.) on a controlled clock; credits land typed + linked; progress UI matches backend state; jobs idempotent on re-run.

**Owner rulings (2026-10-20, T3 plan gate; contract `backend/docs/api/incentives-v1.yaml`):** (Q1) peak windows use the surcharge-window shape (ISO days + region-local start/end, overnight allowed) under `incentiveValues.peakWindows`; a trip counts when it was REQUESTED inside a window. (Q2) weekly trip tiers are NOT cumulative — the highest tier reached pays (60 trips → 100). (Q3) all three incentives are paid by the weekly job (Monday, region time zone, previous Mon–Sun week); the driver screen shows peak earnings accruing live. (Q4) weekly rating = average of ratings on rides completed that week; reward needs ≥ minWeeklyTrips completed trips and avg ≥ minAvgRating (inclusive). (Q5) trips = completed rides driven, in the ride's region, by completion time in the region's zone; every kind counts once (shared included); a driver suspended at evaluation is still paid. (Q6) notifications ride the `account` category with a new `incentives` deep-link screen. Design step first: driver Incentives screen (EN + AR + empty), its menu entry, admin peak-window editor.

### M15-T4 — i18n & RTL completeness audit
Sweep all three clients + notification/SMS templates: every string localized EN+AR (no fallback leaks), RTL correct on every screen, locale formatting per region (NFR-I2), one consistent Arabic numeral choice applied.
**AC:** automated missing-key check wired into CI-equivalent (`make check`); manual RTL screenshot pass recorded; zero missing keys.

### M15-T5 — Load test & fixes
Load scenario per NFR-P1: 1,000 concurrent active users incl. ~300 drivers streaming GPS @ 5 s + booking/dispatch churn, on the simulation harness against a prod-profile deployment; measure NFR-P2/P3 (≤3 s first offer, p95 ≤ 500 ms reads, no ingestion backlog); fix what fails; document results.
**AC:** targets met and recorded in a results doc; regressions fixed with tests where applicable.

### M15-T6 — Backups, restore drill, launch-gate checklist
Nightly backup script (full DB, 30-day retention, off-server target documented), documented + **executed** restore drill (RPO ≤ 24 h / RTO ≤ 4 h verified); `docs/launch-checklist.md`: mandatory OSRM/OSM self-host migration (ES-04 gate), FCM + SMS production config, secrets audit, region legal/compliance items (ASM-05), backup schedule live, load-test results attached.
**AC:** restore drill actually performed from a real backup into a clean environment and verified; checklist complete with owners/status per item.

### M15-T7 — Final review audit
Full-system audit: every SRS V1 requirement spot-checked against implementation (traceability pass over the FR IDs), structure conformance across the monorepo, test-suite health, tracker accuracy, launch checklist sanity.
**AC:** findings resolved; tracker `review_passed`; **V1 complete**.

## Dependency plan
```
(T1 → T2) ∥ T3 ∥ T4 → T5 → T6 → T7
```
(T1→T2 chain, T3 and T4 independent of them; T5 needs the finished system; T6 after T5; T7 last.)

## Milestone acceptance criteria
- Dashboard numbers provably correct; exports faithful.
- Incentives pay exactly per config on controlled clocks.
- 1k-concurrent load targets met and documented; restore drill performed for real.
- Launch-gate checklist exists with the OSRM migration as a blocking item.
- Tracker updated; final audit passed → **V1 done**.

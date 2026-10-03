# M9 — Surge & Heatmap

> Status lives in `README.md`. Prereq: M8 `review_passed`.

## User stories
- As a rider, surge is shown before I book and my multiplier is locked at request time. (PRC-02, UC-R-04 A2)
- As a driver, the heatmap shows me where demand is hot right now. (UC-D-14, DRV-09)
- As an admin, I can override any zone's multiplier manually and see surge state live. (UC-A-09)

## Scope
SRS: PRC-02 full (computation every 2 min: open requests vs idle online drivers per zone; threshold steps; cap; pickup-zone multiplier; lock-at-request — the lock plumbing exists since M7 with fixed 1.0), DRV-09. Zones + thresholds were configured in M4.

## Tickets

### M9-T1 — Surge computation backend
Scheduled job (configurable cycle, default 2 min): per active zone compute demand (open `requested/offering` rides with pickup in zone) ÷ supply (idle online fresh-stream drivers in zone) → multiplier via the zone's threshold steps, capped; persist zone multiplier state; manual override (set/reset, permission-gated, audited) wins until reset; estimates and bookings read the pickup zone's current multiplier and **lock it on the ride** (now real values through the existing M7 plumbing); surge surfaced in estimate responses with multiplier + flag; heatmap endpoint (zones + current levels) and admin surge-state endpoint.
**AC:** integration tests with seeded drivers/requests: ratio→step mapping incl. boundaries and cap, outside-zone = 1.0, override precedence and reset, lock immutability when the cycle changes mid-ride; job idempotent and cycle-safe.

### M9-T2 — Clients: heatmap, surge display, override UI
Driver app: heatmap layer on the map (zones colored by level, refreshed each cycle). Rider app: surge badge + multiplier + short explanation on estimate/confirm. Admin: zone list with live multipliers + override controls; surge overlay data prepared for the M10 live ops map.
**AC:** level changes propagate to clients within one cycle; rider sees exactly the multiplier that ends up locked on the ride; override from UI takes effect next cycle; tests green.

### M9-T3 — Surge integration
Simulation-harness scenario: flood a zone with requests, verify step-up, booking locks the raised multiplier, completion fare uses it; drain demand, verify decay; exercise manual override end-to-end.
**AC:** scripted scenario passes; fare breakdown shows the surge component correctly.

### M9-T4 — Review audit
Audit against PRC-02, DRV-09, UC-A-09, UC-D-14; computation correctness review; performance of the cycle at target scale (NFR-P1 driver counts).
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → T2 → T3 → T4
```
(T2 UI scaffolding may start against T1's contracts in parallel once endpoint shapes are committed.)

## Milestone acceptance criteria
- Surge values are computed, displayed, locked, and billed consistently — one number everywhere.
- Heatmap and admin state reflect the same zone levels the pricing uses.
- Tracker updated; review audit passed.

# M7 — On-Demand Ride Loop

> Status lives in `README.md`. Prereq: M6 `review_passed`.
> The heart of the product: after M7, a seeded rider takes a real ride with a seeded driver.

## User stories
- As a rider, I book a ride, see an estimate, watch my driver arrive, ride, and get an itemized metered fare with a receipt. (UC-R-04…07)
- As a driver, I receive sequential offers with destination shown, accept, navigate, arrive (geofenced), start, complete, and confirm cash. (UC-D-06…09)
- As a rider or driver, I can cancel with the grace rules applied. (UC-R-09, UC-D-10 — fees charged from M8)
- As an admin, I can inspect any ride: timeline, trace, offers trail. (UC-A-18)

## Scope
SRS: RIDE-01…08, TRK-02/03, PRC-01 core (base/km/min/minimum, surcharge windows), PRC-04, RIDE-07 (grace logic; fee **charging** lands in M8 with money rails — fee computed and recorded now, collected later-ride per PAY), payment = cash only this milestone, saved locations + matching toggles (UC-R-01/03), comfort prefs display (UC-R-02), ratings deferred (M11).

**Out:** wallet/mixed payment, wait/pickup-distance charges (M8); surge values (M9 — multiplier fixed 1.0 until then); chat/dial/SOS (M10).

## Tickets

### M7-T1 — Ride contract & migrations
Migrations: `rides` (+state timestamps, locked multiplier, estimate), `ride_offers`, `ride_traces`, `fares` (component breakdown), saved locations, rider preference fields. Contracts: estimate, book, cancel, ride lifecycle actions (arrive/start/complete/cash-confirm), rider+driver ride streams (WS events per state change + driver position relay), offer delivery/answer, history/receipt, admin ride search/detail.
**AC:** state machine + events documented exactly per RIDE-02; migrations clean.

### M7-T2 — Ride backend
Estimate service (RoutingProvider × region pricing × surcharge windows, minimum-fare floor); booking validation (region, role state, single active ride, ≤3 stops); **sequential dispatch engine**: candidate ranking by pickup ETA honoring service type, vehicle class, toggles, online+fresh-stream state; 15 s offers, decline/timeout advance, 10 min/exhaustion → `no_driver_found`; accept → lifecycle: geofenced arrive (100 m), start, in-ride destination/stop changes, complete; trace recording; metered fare from trace distance + duration with stored components; cash confirm / mark-unpaid path; grace-window cancellation logic both sides (fee recorded for M8 collection); rider-side driver info exposure; history + receipt queries; admin search/detail incl. offers trail.
**AC:** heavy integration tests: full happy path, every RIDE-02 exit, offer races (cancel mid-offer, simultaneous accept), geofence rejection, no-driver path, metered fare vs a known trace fixture, minimum-fare floor, breakdown stored not recomputed; dispatch excludes stale-stream and offline drivers.

### M7-T3 — Rider app: booking → completion
Booking screen (pickup pin/search/saved, destination, ≤3 stops, service types with estimates, toggles, comfort prefs visible), confirm with estimate; dispatch state ("finding your driver"); assigned screen (driver+vehicle, live approach, ETA); in-ride (route, ETA, change destination/add stop); completion (breakdown, cash due); cancellation with grace indication; history list + receipt detail (route map from trace); saved-locations management.
**AC:** every UC-R-04…07/09 flow + exception renders correctly against contract mocks; RTL verified on the booking flow; tests green.

### M7-T4 — Driver app: offer → completion
Offer modal (pickup distance/ETA, destination, est. fare, rider rating, 15 s countdown, accept/decline); to-pickup navigation view with Arrived (geofence feedback); start ride; in-ride with stops; complete → fare breakdown → cash collection confirm / mark unpaid; rider no-show cancel path; comfort preferences display.
**AC:** every UC-D-06…10 flow + exception works against mocks; glanceability rules (NFR-U2) applied; tests green.

### M7-T5 — Ride loop integration & e2e
Dev **driver-simulation harness** (seeded drivers moving along OSRM routes — the dev tool, not a product mock) to run the loop without physical devices; end-to-end scripted ride: book → dispatch → accept → arrive → start → complete → cash → receipt, verified across rider app, driver app, backend state, admin ride detail.
**AC:** scripted e2e passes repeatably; admin detail shows the full truth (timeline, trace, offers, fare components).

### M7-T6 — Review audit
Audit against RIDE-01…08, TRK-02/03, PRC-01/04, UC-R-04…09, UC-D-06…10, UC-A-18; dispatch-engine race review; fare-math verification against fixtures.
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4) → T5 → T6
```

## Milestone acceptance criteria
- A complete real ride works end-to-end on the demo region with simulated movement, cash-paid, receipted.
- Dispatch is provably sequential, race-safe, and metric-recording.
- Fare = stored components = what both parties saw.
- Tracker updated; review audit passed.

# M4 — Regions & Pricing Config

> Status lives in `README.md`. Prereq: M3 `review_passed`.

## User stories
- As an admin, I create a region with its full config bundle and activate it when complete. (UC-A-05/06, ADM-01)
- As an admin, I manage a region's service types and their pricing, including the minimum fare. (UC-A-07, PRC-01)
- As an admin, I draw surge zones on a map per region (multipliers computed in M9). (UC-A-08, PRC-02)
- As a rider/driver, the app resolves my region from GPS and shows me its currency and service types. (SD-01)

## Scope
SRS: ADM-01, PRC-01 (config side), PRC-03 (config side), SD-01, UC-A-05…09 (09 = UI stub only; live override needs M9). Config read API consumed by apps.

**Out:** surge computation (M9), fare execution (M7/M8).

## Tickets

### M4-T1 — Regions contract & migrations
Migrations: `regions` (name, boundary polygon, currency, emergency number, settings bundle: cancellation grace/fee, wait grace/rate, pickup-fee threshold/rate, commission tiers, incentive values, suspension thresholds, surge cap, state draft/active), `service_types`, `surcharge_windows`, `surge_zones` (polygon, threshold steps, cap, override fields). OpenAPI: admin CRUD for all + public `resolve-region(lat,lng)` + region config read for clients. PostGIS (or equivalent) decision implemented for polygons/point-in-polygon.
**AC:** migrations clean; geometry queries tested (point-in-region, point-in-zone); OpenAPI matches ADM-01 bundle exactly.

### M4-T2 — Regions backend
Region lifecycle (draft until mandatory config complete → active); service type / surcharge / zone CRUD; validation (overlapping zones allowed across regions? no — zones belong to one region; region boundaries may not overlap); config read endpoints; all admin mutations permission-gated + audited.
**AC:** integration tests: region activation blocked when incomplete; resolve-region correct at boundaries; in-flight-config-change rule (edits affect only new rides) encoded where applicable; UC-A-05…07 exceptions covered.

### M4-T3 — Admin UI: regions & zone drawing
Region list + multi-step form for the bundle; service types and surcharges editors; map screen (OSM tiles) with polygon drawing/editing for the region boundary and surge zones; emergency number field; activation flow with completeness checklist.
**AC:** an admin can create a complete region entirely from the UI; drawn polygons round-trip correctly; permission gating per M3 pattern; component tests green.

### M4-T4 — Apps: region resolution
Rider + driver apps resolve the region on boot/location change; show "outside operating area" state when unresolved; cache region config (currency, service types) for later milestones.
**AC:** moving the simulated location across a boundary switches region config; outside-area state correct; tests green.

### M4-T5 — Regions integration
Seed a realistic demo region (city boundary, 2–3 service types, several zones) via the dev seeder; end-to-end: admin edits config → apps reflect it.
**AC:** demo region seeded reproducibly; walkthrough passes.

### M4-T6 — Review audit
Audit against ADM-01, PRC-01/03 config, SD-01, UC-A-05…08; geometry edge cases; structure + tests.
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4) → T5 → T6
```

## Milestone acceptance criteria
- A region can go from nothing → active with full config, purely via the admin UI.
- Apps correctly resolve regions and react to config changes.
- All region mutations permission-checked and audited.
- Tracker updated; review audit passed.

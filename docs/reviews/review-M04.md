# Review — M4 Regions & pricing config (`a3ce6a9..eae6dd3`)
_6 commits · 106 files · reviewed 2026-10-05_

## Summary

M4 lands the full regions domain: a contract-first OpenAPI spec (`backend/docs/api/regions-v1.yaml`), PostGIS-backed migrations and geometry queries, a permission-gated and fully audited backend, an admin UI with Leaflet polygon drawing, region resolution with offline-tolerant caching in both apps, and an idempotent Damascus demo seeder. Implementation quality is high across all five tickets: the contract is implemented faithfully three ways (backend, admin client, app clients), geometry edge cases (ST_Covers at boundaries, overlap guard on create and update, zone containment, GeoJSON validation) are both enforced and pinned by tests, and every region-domain mutation is permission-checked and audit-logged. The two findings that matter are process, not code: the tracker's "Current state" narrative and milestone table were never updated through M4 (they still read as if M4 hadn't started), and the deliberate "boundary shrink does not re-validate existing zones" decision — pending an owner ruling — is recorded nowhere in the repository.

**Verdict:** Pass with comments
**Findings:** Critical 0 · High 0 · Warning 2 · Info 5 · Praise 4

## Acceptance criteria

### M4-T1 — Regions contract & migrations

| Criterion | Status | Evidence |
|---|---|---|
| Migrations clean | met | `V5__regions.sql` applies cleanly in the PostGIS Testcontainer (156 backend tests green); geometry(Polygon,4326) + GiST indexes on `regions.boundary` and `surge_zones.polygon`; the draft-until-complete rule is correctly modeled as nullable columns + a service rule |
| Geometry queries tested | met | `RegionsMigrationIntegrationTest.shouldFindRegionCoveringPoint` / `shouldFindZonesCoveringPoint` / `shouldRoundTripConfigBundle`; HTTP-level pinning in `RegionsAdminIntegrationTest.shouldResolveCorrectlyAtBoundaries` |
| OpenAPI matches ADM-01 bundle exactly | met | `regions-v1.yaml` carries every ADM-01 part: name+boundary, currency, emergency number, service types (base/km/min/**minimum**), surcharge windows, surge zones + thresholds + caps, cancellation/wait/pickup-fee values, commission tiers, incentive values, suspension thresholds; ASM-04 ops note included |

### M4-T2 — Regions backend

| Criterion | Status | Evidence |
|---|---|---|
| Activation blocked when incomplete | met | `RegionServiceImpl.activateRegion` + `missingMandatoryParts`; `shouldWalkDraftToActiveLifecycle` asserts the 409 names all 11 missing parts, that a DISABLED service type does not count, and that activation is idempotent |
| resolve-region correct at boundaries | met | `RegionRepository.findActiveRegionsCovering` uses ST_Covers (point ON the line resolves); shared-border tie broken deterministically by name; outside → 404; malformed/out-of-range/missing coords → 400 (`shouldResolveCorrectlyAtBoundaries`) |
| In-flight-config-change rule encoded where applicable | met | Config edits touch only region config (no ride state exists yet); the new-rides-only rule is documented in the contract (PUT description), `RegionsController.updateRegion`, and `BundleForm`'s doc; nothing in the diff mutates anything ride-shaped |
| UC-A-05…07 exceptions covered | met | E1 activation 409 lists missing parts; active region cannot un-fill mandatory config (409, tested); UC-A-07 E1 (claimed scheduled rides) explicitly deferred to M12 in the contract — disable always succeeds until then |

### M4-T3 — Admin UI: regions & zone drawing

| Criterion | Status | Evidence |
|---|---|---|
| Complete region entirely from the UI | met | `RegionsPage` (name-only draft create) → `RegionDetailPage` (BundleForm + map + pricing sections + ActivationCard); `region-detail-page.test.tsx` walks bare-draft → checklist → activate; confirmed live in the T5 walkthrough |
| Drawn polygons round-trip correctly | met | `leaflet-geojson.ts` converts [lng,lat] closed contract rings ↔ open Leaflet [lat,lng] rings; `map-geojson.test.ts` pins the round-trip; `PolygonMapEditor` is the only Leaflet-touching module |
| Permission gating per M3 pattern | met | `App.tsx` wraps both routes in `<RequirePermission permission="regions:view">`; `Sidenav` gates on `can('regions:view')`; pricing sections render under `pricing:view`, mutate under `pricing:edit` (`RegionDetailPage`); `rbac-gating.test.tsx` |
| Component tests green | met | 19 files / 88 tests green (serial run; see Test run results for the parallel-run caveat) |

### M4-T4 — Apps: region resolution

| Criterion | Status | Evidence |
|---|---|---|
| Moving across a boundary switches config | met | rider `region-resolution.test.tsx:125` and driver `region-resolution.test.tsx:156` ("re-resolves only past the significant-move threshold and switches config across a boundary") |
| Outside-area state correct | met | 404 is treated as authoritative (cache dropped, `outside` state); network/server failure keeps the cached config or shows a distinct error/retry state — both tested in both apps; permission-denied state has retry + open-settings |
| Tests green | met | rider 60/60, driver 60/60 |

### M4-T5 — Regions integration

| Criterion | Status | Evidence |
|---|---|---|
| Demo region seeded reproducibly | met | `DevRegionSeeder` is `@Profile("dev")`, idempotent (skips when Damascus exists, so admin edits survive restarts); `DevRegionSeederIntegrationTest` seeds twice and asserts exactly 1 region / 3 types / 1 window / 3 zones, ACTIVE, resolving at a central-Damascus point; values documented in `SEEDING.md` and consistent with the code |
| Walkthrough passes | met | Recorded as passed (admin edit → resolve endpoint reflected immediately, audit log complete) — but the record lives only in the session, not in the repo (see W1) |

### Milestone acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Region nothing → active purely via admin UI | met | T3 tests + T5 walkthrough; backend lifecycle pinned end-to-end in `shouldWalkDraftToActiveLifecycle` |
| Apps resolve regions and react to config changes | met | T4 tests in both apps; walkthrough confirmed admin edit → resolve reflects immediately |
| All region mutations permission-checked and audited | met | Every one of the 15 admin endpoints carries the exact `x-required-permission` from the contract via `@PreAuthorize` (RegionsController: `regions:view`/`regions:edit`; ServiceTypes/SurchargeWindows/SurgeZones controllers: `pricing:view`/`pricing:edit`); client `/api/v1/regions/**` endpoints are authenticated-but-unprivileged and are NOT in the SecurityConfig permitAll list (`SecurityConfig.java:59-69`); all 19 `auditService.record` call sites verified across the four service impls; `shouldAuditEveryMutation` asserts all 11 action types over HTTP |
| Tracker updated; review audit passed | partial | Ticket rows were updated per commit (T1–T5 `done`), but the milestone table and "Current state" narrative were not (W1); audit = this report |

## Critical

None.

## High

None.

## Warning

**W1 — Tracker drift: "Current state" and the milestone table never updated through M4**
- Category: structure · Severity: Warning · Certainty: High
- Location: `docs/milestones/README.md:27-28` (Current state), `docs/milestones/README.md:44` (milestone table)
- Rationale: The milestone table still lists M4 as `todo` and "Current state" still reads "nothing mid-flight — Next concrete action: M4-T1", while the ticket table (lines 97-102) marks M4-T1…T5 `done`. CLAUDE.md requires the tracker to be updated immediately and the "Current state" section to reflect reality at session end — a cold session resuming from this file would be misdirected. Additionally, no M4 record exists in the repo at all: no T5 walkthrough result, no per-ticket decisions (PostGIS image swap rationale is only in code comments, which is fine, but the walkthrough evidence and the W2 pending ruling exist only in the session conversation).
- Fix Suggestion: At milestone close, add an M4 closure record to "Current state" (T5 walkthrough result, suite counts, the W2 pending owner ruling, any decisions a cold session needs), flip the milestone table to `review_passed`, and record the new review baseline.

**W2 — Boundary shrink does not re-validate existing surge zones, and the pending owner ruling is documented nowhere**
- Category: srs-conformance · Severity: Warning · Certainty: High
- Location: `backend/src/main/java/com/labby/backend/service/RegionServiceImpl.java:89-118` (`updateRegion`)
- Rationale: `updateRegion` re-checks cross-region overlap (`requireNoBoundaryOverlap`, create AND update — good) but never re-checks that existing surge zones still lie within a shrunken boundary; zones that fall outside remain silently, while zone create/update enforce containment strictly (`SurgeZoneServiceImpl.requireWithinBoundary`). This asymmetry was a deliberate decision flagged to the owner with a ruling pending — but a grep of the contract, the service code, SEEDING.md and the tracker finds no trace of it. An undocumented deliberate deviation is indistinguishable from an oversight for every future session (and for M9, which will compute multipliers from these zones).
- Fix Suggestion: Record the decision + pending ruling in the tracker's M4 closure record and in a comment at `updateRegion` (or the contract's PUT description). When the owner rules, either re-validate on shrink (409 listing escaping zones) or codify "zones may outlive a shrink" explicitly.

## Info (max 5)

1. **Seeder can bypass the overlap guard after a rename** — `DevRegionSeeder.java:59-64` keys idempotency on the name `Damascus` and inserts via raw SQL; if an admin renames the seeded region, the next dev boot re-seeds a second region whose boundary overlaps the renamed one, something the API forbids. Dev-profile only; a guard on the boundary (or a fixed UUID) would close it.
2. **Seeder test doesn't assert zone containment** — `DevRegionSeederIntegrationTest` counts rows and resolves one point but never asserts the three zones lie within the boundary (verified manually in this audit: City Center, Mazzeh and Old City rectangles all sit inside the boundary ring). One `ST_Covers` assertion would pin it against future coordinate edits.
3. **Surcharge windows accept any start/end combination** — `SurchargeWindowUpsertRequestDto` validates shape only; `startsAt >= endsAt` (overnight windows?) and overlapping windows are accepted with no documented interpretation. Contract-conformant for M4's config side, but M7's fare engine will need a documented rule.
4. **Admin vitest suites are timing-sensitive under load** — with the backend Maven/Testcontainers gate running concurrently, 6 files (including three untouched M3 suites: roles, admins, audit-log) failed on ~5s timeouts; fully green serially. Consider a higher `testTimeout` so local parallel runs stay trustworthy.
5. **The last enabled service type of an ACTIVE region can be disabled** — `ServiceTypeServiceImpl.updateServiceType` has no counterpart to the activation invariant, leaving an active region with zero bookable types (empty client `serviceTypes`). Legal per contract (disable always succeeds until M12) — flagging for an owner glance only.

## What's good

- **Geometry semantics are pinned, not assumed** — `RegionsAdminIntegrationTest.shouldResolveCorrectlyAtBoundaries` proves ST_Covers behavior over HTTP: a point exactly ON the edge resolves, the shared-border tie breaks by name, outside 404s, and malformed/out-of-range/missing coordinates 400 (never 500). `shouldRejectOverlappingBoundaries` covers true overlap, full containment, AND the touching-is-legal case.
- **`GeoJson` util is a proper validation edge** — wrong type, holes, open ring, degenerate ring, malformed pairs, out-of-range coordinates and self-intersection all map to 400 (`GeoJson.java:35-81`), with a dedicated unit test; `compact()` keeps audit snapshots readable (vertex count + bbox) instead of dumping coordinates.
- **Leaflet is quarantined** — `PolygonMapEditor` is the only module touching Leaflet and speaks contract GeoJSON at its boundary; `leaflet-geojson.ts` is pure and round-trip tested, so the [lng,lat] vs [lat,lng] flip lives in exactly one audited place.
- **Audit coverage proven in one sweep** — `shouldAuditEveryMutation` drives all 11 mutation actions (`region.create/update/activate`, `service_type.create/update`, `surcharge_window.create/update/delete`, `surge_zone.create/update/delete`) and asserts them plus target-type filtering in the audit log; the permission matrix test covers 401/403 on every admin endpoint and confirms client endpoints 404 (never 403) for a plain rider.

## Pre-existing (out of scope, non-blocking)

- Malformed UUID path params returning 400 was fixed in M3 (`c9c4197`) and the new controllers inherit it; nothing new to flag.
- The M3 re-audit's Info backlog (no-op `role.update` entries, hardcoded `Language.EN` SMS, `admins:manage`-without-`roles:view` coupling) remains open and untouched by this range.

## Resolution (2026-10-05, at milestone close)

Both Warnings were repo-documentation gaps with no code findings behind them, resolved
doc-only in the closure commit (no behavior change → no re-audit cycle):

- **W1 — resolved.** Tracker brought fully current: milestone table → `review_passed`, M4
  closure record added to "Current state" (walkthrough result, geometry/caching decisions a
  cold session needs, Info backlog), review baseline advanced to `eae6dd3`.
- **W2 — resolved (as documentation; the ruling itself stays open).** The boundary-shrink
  decision is now recorded in `RegionServiceImpl.updateRegion` (code comment), the contract's
  PUT description, and the tracker's owner-inputs table as a pending ruling needed before M9.
- Info findings 1–5: recorded in the tracker's M4 closure record as non-blocking backlog.

## Test run results

All four gates were executed for this audit (Docker available; PostGIS Testcontainer):

| Command | Result |
|---|---|
| `backend: make check` | **PASS** — BUILD SUCCESS, 156 tests, 0 failures (incl. 7 ArchUnit rules, Flyway V5 on `postgis/postgis:16-3.4-alpine` Testcontainer, format/lint) |
| `apps/admin: npm run check` | **PASS** (with caveat) — first run, executed in parallel with the backend gate, failed 6/19 files on ~5s waitFor/test timeouts, including three M3 suites untouched by this range (roles, admins, audit-log) — a CPU-starvation artifact, not a regression. Serial re-run: 19 files / 88 tests, all green, exit 0. |
| `apps/rider: npm run check` | **PASS** — 13 suites / 60 tests green, exit 0 |
| `apps/driver: npm run check` | **PASS** — 10 suites / 60 tests green, exit 0 |

The PostGIS image swap (docker-compose + `AbstractIntegrationTest`) is deliberate and documented in both places, including the one-time volume-recreate instruction.

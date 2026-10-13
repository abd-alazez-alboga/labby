# Review — M9 Surge & heatmap milestone audit (`6aba407..76aa51b`)
_4 commits (ca86cc4 · f15edf2 · 570e220 · 76aa51b) · 77 files · reviewed 2026-10-13_

M8-T7-style audit for ticket M9-T4. Four independent review agents covered:
- backend surge computation and performance;
- backend REST, contracts, RBAC and structure;
- the rider app;
- the driver and admin apps.

Their findings were merged and de-duplicated. The High finding and the key Warnings were re-checked against the live code before inclusion.

## Summary
M9's core is sound:
- **One stored number drives everything.** `surge_zones.current_multiplier` drives the estimate, the booking lock, the fare, the driver heatmap and the admin state. T3 proves fare = receipt = admin detail = ledger.
- **Step mapping is exact.** It compares `demand ≥ ratio × supply`, with no division rounding.
- **Supply follows dispatch.** It matches the dispatch rules plus the owner-approved differences (floor-blocked drivers and drivers without an active vehicle are excluded).
- **The cycle is safe under concurrency.** It runs one transaction per zone with `SKIP LOCKED`.
- **Performance is comfortable.** About 4–5 ms per zone per cycle at NFR-P1 scale.
- **Contracts match the DTOs.** All three apps implement the approved designs in EN and AR.

**One High remains: the one-tap retry after "no driver found" locks a surge the rider never saw.** It was found independently by three of the four reviewers, and it needs an owner ruling. The Warnings cluster around "same levels everywhere", cycle timing, and untested defensive paths.

**Verdict:** Fail (the High needs an owner ruling before it can be fixed)
**Findings:** Critical 0 · High 1 · Warning 9 · Info 5 (+7 nitpicks) · Praise 7

## Acceptance criteria

### Milestone
| Criterion | Status | Evidence |
|---|---|---|
| Surge values are computed, displayed, locked, and billed consistently — one number everywhere | **Partial** | One stored value feeds every surface, and `SurgeSimulatorIntegrationTest` proves it end to end. Exception: retry locks an unseen value (H1). |
| Heatmap and admin state reflect the same zone levels the pricing uses | **Partial** | Multipliers are identical everywhere. Levels are not: the driver shows level 0 while riders pay surge (W1), and the admin builds its own tier scale (W2). |
| Tracker updated; review audit passed | Pending | This audit |

### Tickets
| Ticket AC | Status | Evidence |
|---|---|---|
| T1: ratio→step incl. boundaries and cap; outside-zone = 1.0; override precedence and reset; lock immutability mid-ride; job idempotent and cycle-safe | Met (with gaps) | `SurgeCalculatorTest` (16), `SurgeIntegrationTest` (8). Retry path not covered (H1); the concurrent-cycle test cannot detect a failure (W5); multi-instance runs repeat work (W4). |
| T2: level changes reach clients within one cycle; rider sees exactly the locked multiplier; override from UI takes effect next cycle; tests green | Partial | Met when device and server clocks agree and the cycle finishes within 5 s (W3); every `book()` path is exact, but retry is not (H1); override flow met. Gates: rider 295, driver 351, admin 250. |
| T3: scripted scenario passes; fare breakdown shows surge correctly | Met | `SurgeSimulatorIntegrationTest` (2): step-up 1.2→1.5→2.0, 409 then lock, decay, billing identical on fare/receipt/admin/ledger, override end to end |

## Critical
None.

## High

### H1 — One-tap retry after `no_driver_found` locks a surge the rider never saw
- **Category:** srs-conformance (PRC-02 "shown before booking"; owner ruling 5; T2 AC "rider sees exactly the multiplier locked")
- **Severity:** High
- **Certainty:** High
- **Location:**
  - `backend/src/main/java/com/labby/backend/service/RiderRideServiceImpl.java:243-251`: `retry()` builds the new booking with `expectedSurgeMultiplier = null`, so the guard at `:313-320` never fires.
  - `apps/rider/src/screens/ride/ride-view.tsx:386-398` and `apps/rider/src/api/rides.ts:492`: "Try again" posts `/rides/{id}/retry` with no body and shows the old ride's estimate.
  - `backend/docs/api/rides-v1.yaml:133-135` only says "re-priced at the moment of retry".
- **Rationale:**
  - Retry exists only after `no_driver_found`, which means no supply. That is exactly when the cycle raises the zone, up to the top step under ruling 1.
  - Example: a rider shown and locked at 1.0× taps "Try again" and is locked at 2.0× while the screen shows the 1.0× price.
  - This was harmless in M7 (surge fixed at 1.0). It became real in this range.
- **Fix Suggestion — owner ruling needed. Choose one:**
  - **(A) Recommended.** The retry carries the previous ride's locked multiplier as its expectation. If the zone moved, the backend answers 409 `surge_changed` with the live value, and the rider app shows the already-approved "price changed" sheet from the no-driver screen. Confirming then retries with the new expectation.
  - **(B)** The retry silently keeps the previous ride's lock. This is simpler, but it can underprice a hot zone and breaks "locked at request time" for the new ride.
  - Either way: amend rides-v1 Retry, add a backend integration test (the zone rises between `no_driver_found` and retry) and a rider test.

## Warning

**Backend**
- **W1 — Heatmap level is 0 ("calm", not drawn) while riders pay surge.**
  - **Category:** correctness (milestone AC "same levels")
  - **Certainty:** High
  - **Location:** `backend/.../service/SurgeCalculator.java:116-129`; driver `apps/driver/src/heatmap/levels.ts:60-64` skips level 0.
  - **Rationale:** Any current multiplier above 1.00 but below the first step's multiplier gets level 0. This happens with a cap below step 1 (e.g. cap 1.10 vs step 1.2) or an override of 1.01–1.19. Riders see `surgeActive: true` and pay, while drivers see a calm zone.
  - **Fix:** level = max(computed level, 1) whenever current > 1.00. Add a unit test plus integration cases (cap below step 1; override below step 1).
- **W2 — The admin surge state carries no `level` or effective cap, so the admin builds a different scale.**
  - **Category:** integration (milestone AC; M10 overlay)
  - **Certainty:** High
  - **Location:** `backend/.../dto/SurgeZoneStateDto.java:12-22`, `regions-v1.yaml:730-750`; `apps/admin/src/pages/surge/surge-overlay.ts:27-57` judges none/surging/max against the **region** cap only. The zone table (`RegionSurgePage.tsx:95-96,253`) uses the lower of the zone and region caps.
  - **Rationale:** A zone at its own 1.5 cap shows "max" in the table but "surging" in the overlay. The M10 live-ops map would inherit a level scale the drivers never see.
  - **Fix:** add `level` (same `SurgeCalculator.level`) and `effectiveCap` to `SurgeZoneStateDto` and the contract. The admin overlay and chips then use them. Add a test with a zone cap below the region cap.
- **W4 — Multi-instance deployments repeat the cycle, and the value can change twice in one "cycle".**
  - **Category:** performance/concurrency (NFR-P4)
  - **Certainty:** Medium
  - **Location:** `SurgeServiceImpl.java:57-73`; `SurgeZoneRepository.java:89-98` (`lockIfFree`)
  - **Rationale:** `SKIP LOCKED` prevents simultaneous work on one zone, but every instance still walks every zone each cron fire. N instances do N× the work and rewrite zones seconds apart with fresh inputs, which causes extra `surge_changed` 409s.
  - **Fix:** in `lockIfFree`, skip zones already computed in this cycle, e.g. `AND (z.computed_at IS NULL OR z.computed_at < :cycleStart)`, where `cycleStart` is now minus half the cycle period.
- **W5 — The concurrent-cycle test cannot detect a failure.**
  - **Category:** tests
  - **Certainty:** High
  - **Location:** `SurgeIntegrationTest.java:429-463` with `SurgeServiceImpl.java:68-70`
  - **Rationale:** `recompute()` swallows each zone's `RuntimeException` (warn log). The test then runs an extra sequential cycle before asserting, which repairs anything the race broke.
  - **Fix:** assert the state right after the parallel runs. Assert the per-run `processed` counts sum to the zone count, or expose a failure count.

**Clients**
- **W3 — "Within one cycle" depends on the device clock and on a cycle finishing within 5 s.**
  - **Category:** correctness (T2 AC)
  - **Certainty:** High (mechanism) / Medium (frequency)
  - **Location:** `apps/driver/src/heatmap/HeatmapProvider.tsx:39-47`; `apps/admin/src/pages/surge/use-surge-state.ts:14-20`; backend `SurgeServiceImpl.java:186` (`nextCycleAt` is always the next fire after now).
  - **Rationale:** The delay is computed as `Date.parse(nextCycleAt) − Date.now()`.
    - A device clock behind the server waits up to the driver's 10-minute cap; the admin has no cap at all.
    - If a cycle runs longer than the 5 s grace, the read returns old levels plus the *following* fire time, so the client sleeps a whole extra cycle.
  - **Fix:** base the delay on server time (the response `Date` header) or on the cycle period (`nextCycleAt − computedAt`). Clamp both clients to one period plus grace. If `computedAt` has not passed the previously announced `nextCycleAt`, retry in 10–15 s.
- **W6 — Rider: if the estimate re-fetch after a 409 fails, "Back to options" leaves stale prices and guarantees another 409.**
  - **Category:** correctness/UX
  - **Certainty:** High
  - **Location:** `apps/rider/src/screens/ride/booking-screen.tsx:346-352, 369-372, 656`
  - **Fix:** on that path set `estimate` to null, so the planner re-requests prices, or patch its multiplier and mark the prices unknown.
- **W7 — Rider: the defensive branches have no tests.**
  - **Category:** tests
  - **Certainty:** High
  - **Location:** `booking-screen.tsx:349-356` (re-fetch failure), `:360-367` (the owner-approved service-missing guard), `:414-416` (a non-surge error while the sheet is open).
  - **Fix:** add three tests, for re-fetch 500, service missing, and `active_ride_exists` from the sheet.
- **W8 — Admin: the "Live" chip stays green while refreshes are failing.**
  - **Category:** correctness/UX
  - **Certainty:** High
  - **Location:** `apps/admin/src/pages/RegionSurgePage.tsx:155-167`
  - **Rationale:** The chip only reads the last successful `nextCycleAt`. Beside a "refresh failed" banner, the "Next cycle" tile can show a past time.
  - **Fix:** show a neutral "Not updating" chip while `error !== null`.
- **W9 — Stale "computed in M9" wording is still shipped.**
  - **Category:** structure/mess
  - **Certainty:** High
  - **Location:** `apps/admin/src/i18n/en.json:350`, `ar.json:350` (user-visible hint on the region page); comments in `apps/admin/src/pages/regions/SurgeZonesSection.tsx:40-41` and `apps/admin/src/api/regions.ts:153`.
  - **Fix:** reword the hint, e.g. "Zones apply from the next surge cycle (every 2 minutes); outside every zone the multiplier is 1.0×", in EN and AR for owner proofread. Update the comments.

## Info (max 5)
1. **Cycle failures are logged with only the exception class name** (`SurgeServiceImpl.java:69`). There is no message or stack trace, so a failing zone is invisible. Log `ex`, as the other jobs do.
2. **`expectedSurgeMultiplier` has no `@DecimalMin("1")` / `@Digits`** (`BookRideRequestDto.java:22`), although rides-v1 declares `minimum: 1`. A value of 0.5 gets 409 instead of 400.
3. **Contract wording drift:**
   - regions-v1 supply rules (`:409`) omit the owner's "active vehicle" rule.
   - `overridePending` (`:745`) doesn't say the override is compared after clamping to the cap.
   - The override's implicit 99.99 maximum is undocumented.
4. **Draft regions keep their zones' last `current_multiplier`** (`SurgeZoneRepository.java:72-80`). On reactivation a stale surge is priced until the next cycle (≤ 2 min). The driver heatmap's last-ride fallback (`SurgeServiceImpl.java:127`) can also serve a draft region's frozen state.
5. **The driver map redraws every zone on every map update** (`apps/driver/src/map/leaflet-bridge.ts:171-195`). Zones only change once per cycle, so cache the last serialized zones.

+7 more nitpicks — ask to see them:
- admin polling runs in a background tab;
- the driver sheet's region name can differ from the heatmap's region;
- the rider sheet's scrim colour is not a token;
- the rider surge icon is not hidden from screen readers;
- `book()` has no in-flight guard;
- `override_above_cap` `details.cap` is not asserted in a test;
- two older admin tests (`region-detail-page` "saves the full bundle PUT…", `driver-applications` "requests per-item changes…") hit the 5 s timeout under full-suite load on the laptop. They pass alone and in CI.

## What's good
- **Exact step math:** `demand ≥ ratio × supply`, steps sorted by ratio, the lower of zone and region cap, 2-dp HALF_UP. Unit tests cover the 1.99/2.00/2.99/3.00/4.99/5.00 boundaries.
- **The 409 guard cannot race:** the compared value and the locked value are the same variable, and `compareTo` makes 1.5 equal 1.50. Every `book()` path sends `expectedSurgeMultiplier`, and a repeated 409 is tested with the sequence 1.5 → 2 → 2.5.
- **Cycle state is protected:** it is written only by targeted native updates, and the entity columns are read-only, so a zone config save can never revert an override or a cycle result.
- **The lock is immutable** through destination change, driver-cancel redispatch and completion. T3 proves billing at the locked value on fare, receipt, admin detail and ledger.
- **V14 is clean:** CHECK constraints and a partial GiST index whose predicate exactly matches the demand query. Performance is about 4–5 ms per zone per cycle at NFR-P1 scale.
- **The driver WebView is safe from XSS:** only the formatted multiplier enters the page, via `textContent`. State is JSON-escaped (`<`, U+2028, U+2029).
- **Tests and i18n:** heatmap polling is fully covered with fake timers (offline, toggle, background, ride on screen, 404). The admin override tests check the exact body, errors and view-only mode. EN/AR parity holds in all three apps, with Western digits and LTR multipliers.

## Pre-existing (out of scope, non-blocking)
- `RideAccess.requireDriver` checks approval and the role's existence, not the role's state. This is the same as the existing driver read endpoints.
- MapStruct is barely used; hand-mapped DTOs are the codebase's established pattern.

## Test run results
- **CI** run 38395149542 on `76aa51b`: success (backend, rider, driver, admin).
- **Local `make check`** at `76aa51b`: 412 tests, 0 failures.
- **Re-run by the auditors:** rider `npm run check` 295/295 and driver 351/351, both on the first run.
- **Admin:** lint, prettier and tsc are clean. The full vitest run had 1–2 timeouts in older, unrelated tests under load; both pass alone, and an earlier sequential run passed 250/250.
- **Scoped backend runs:** `SurgeCalculatorTest` 16/16 and `SurgeIntegrationTest` 8/8.

## Resolution (labby-fix, 2026-10-13)
**Owner rulings:**
- **H1:** option A. The retry carries the previous ride's lock as `expectedSurgeMultiplier`. The retry endpoint takes an optional body. A 409 `surge_changed` opens the approved price-changed sheet on the no-driver screen.
- **W1:** any multiplier above 1.00 is at least level 1.
- **W2:** `SurgeZoneState` gains `level` and `effectiveCap`.

**Fixed:** H1, W1–W9, Info 1–5, and the `details.cap` test nitpick.

**Notes on the fixes:**
- **W4:** the "already computed this cycle" skip applies only when the cycle cron is enabled. It is covered by the new `SurgeCycleIntegrationTest`, which also carries the W5 concurrent test, now with exact assertions.
- **I4:** zones of non-active regions are reset to 1.00 each cycle. Overrides are kept.
- **W3:** both clients clamp the wait to one cycle period derived from server timestamps, with a 15 s retry when the cycle hasn't written yet. The retries are capped at one cycle.

**Not fixed (nitpicks outside the touched lines):**
- admin polling in a background tab;
- the driver sheet's region name;
- the rider scrim colour token;
- the rider surge icon's accessibility label;
- the `book()` in-flight guard;
- two older admin tests that time out under load.

**Open wording point:** on the no-driver screen, the reused price-changed sheet says "…while you were choosing…" and "Back to options". It was kept as is, per the "no new copy" instruction.

**Gates on the combined tree, run sequentially:** backend 417 · rider 302 · driver 356 · admin 256, all green.

**Next:** a `/labby-review` re-audit of the fix range.

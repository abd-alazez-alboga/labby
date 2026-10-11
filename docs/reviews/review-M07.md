# Review — M7 "On-demand ride loop" milestone audit (`1bab319..HEAD`)
_19 commits · 521 files · reviewed 2026-10-11_

Range: `1bab319..7d072e8` (HEAD). Besides M7 proper (T1–T5) the range contains the owner-approved
UI/UX redesign pass (`6c99504…7dfea63`) and three owner-approved ad-hoc items (`88d8a1f`,
`2f1496c`, `906fde5`), plus the M6-X2 driver background-location work (`d83ca29`) and its
fix-driven streamer change — all separately approved; they were audited for correctness and
structure, not flagged as scope creep.

## Summary

The ride loop is in very good shape: the state machine matches RIDE-02 exactly (contract table =
implementation = DB CHECKs), dispatch sequentiality is enforced by the schema itself (partial
unique indexes on open offers) with lock-first writers, the race tests fire genuinely concurrent
HTTP requests, and the fare engine is a single calculator whose fixture math I re-verified by
hand. All four suites are green (backend 315 incl. ArchUnit, admin 194, driver 266, rider 218 —
the rider suite needed a re-run, see W3), and CI is green on HEAD (run 38137887985). What keeps
this from a clean pass is one SRS gap that never got a recorded owner ruling — RIDE-01's place
*search* — plus two decision-shaped warnings (admin ride-inspection UI exists only as an API;
the region time-zone field is API-only and an admin-UI save silently resets it).

**Verdict:** Pass with comments
**Findings:** Critical 0 · High 1 · Warning 3 · Info 5 · Praise 5

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| **T1** — state machine + events documented exactly per RIDE-02; migrations clean | met | `backend/docs/api/rides-v1.yaml:23-58` transition table matches `RiderRideServiceImpl`/`DriverRideServiceImpl`/`RideDispatchServiceImpl` and the `V10__rides.sql` CHECKs (`ck_rides_driver_bound`, `ck_rides_state_timestamp`, `ck_rides_cancellation*`); `RidesMigrationIntegrationTest` (8 tests) walks the machine at the DB level |
| **T2** — happy path, every RIDE-02 exit, offer races, geofence, no-driver, fare vs trace fixture, minimum floor, breakdown stored not recomputed, stale/offline excluded | met | `RideLifecycleIntegrationTest` (happy path incl. 2038 m fixture, floor, lock-at-request, never-recomputed, offline block, route change, stream-lost), `RideDispatchIntegrationTest` (eligibility gates, toggle, sequential advance, 10-min give-up, cancel-mid-offer, concurrent accept-vs-cancel and double-accept, re-dispatch + canceller excluded, no-show), `RideBookingIntegrationTest` (every refusal code, fee quote), `RideRealtimeIntegrationTest` (frames to both parties) |
| **T2 (carried)** — region admin API `timeZone` | met (backend) | `RegionServiceImpl.applyBundle`/`timeZone(..)`, `RegionsAdminIntegrationTest`; but see W1 — the admin UI has no field |
| **T3** — every UC-R-04…07/09 flow + exception against contract mocks; RTL on booking; tests green | **partial** | Flows and exceptions covered (`ride-flow.test.tsx` 13 cases, `booking-screen.test.tsx` incl. RTL describe, `ride-screens.test.tsx`); tests green when run alone (218). Gap: UC-R-04 step 1 pickup **search** is saved-places-only — see H1 |
| **T4** — every UC-D-06…10 flow + exception; NFR-U2 glanceability; tests green | met | `ride-offer`, `ride-active`, `ride-push`, `ride-rtl`, `ride-units` tests; driver suite 266 green; offer/ride screens per owner-approved artboards (map-first, one dominant action) |
| **T5** — scripted e2e passes repeatably; admin detail shows the full truth | met | `RideSimulatorIntegrationTest` runs the unattended loop twice with the same sim driver and asserts admin timeline + offers trail + both trace phases + stored fare = receipt; `DevRideSimulator` acts only through the real service layer, dev-profile + `RIDE_SIM_ENABLED` gated |
| **M7 AC 1** — complete real ride e2e, demo region, simulated movement, cash, receipted | met | Simulator integration test end-to-end; tracker records the live emulator runs of 2026-10-11 (3 sim rides to receipt, 1 real driver-app ride, metered 421 m real trace) as evidence |
| **M7 AC 2** — dispatch provably sequential, race-safe, metric-recording | met | `uq_ride_offers_pending_ride`/`_pending_driver` partial unique indexes (`V10__rides.sql:161-163`), `findForUpdate`/`lockIfFree` lock-first writers, concurrent-request race tests; offer responses (`accepted/declined/timeout/withdrawn`) persist the acceptance-metric trail |
| **M7 AC 3** — fare = stored components = what both parties saw | met | `fares` CHECK `ck_fares_total` (total = Σ components), tests assert driver fare == rider fare == receipt == admin detail; `PRC-04` render-from-store verified by repricing the service type after completion |
| **M7 AC 4** — ride pushes reach BOTH apps on a real Android dev build; rider push tap opens the ride | met (code + tests; live run recorded) | Push catalog in `rides-v1.yaml:177-182` implemented in `RideEvents`/`NotificationRenderer`; rider deep link `ride` (`deep-links.test.ts`), driver `ride_offer` (`ride-push.test.tsx`). The live-device half is the tracker's recorded evidence of 2026-10-11 (rider FCM push on the dev build, tap opened the live ride; driver offer pushes in Arabic) — judged as recorded evidence, consistent with the code |
| **M7 AC 5** — tracker updated; review audit passed | partial (by construction) | Tracker current through T5 + this ticket `in_progress`; this report is the audit |

## Critical

None.

## High

**H1 — RIDE-01 pickup/destination "search" is not implemented (saved-places filter only), with no recorded owner ruling**
- Category: srs-conformance · Severity: High · Certainty: High
- Location: `apps/rider/src/screens/ride/route-planner.tsx:4-7` ("Typing in a field searches the rider's saved places (the contract has no geocoding endpoint)"); `backend/docs/api/rides-v1.yaml` has no geocoding/search endpoint.
- Rationale: SRS RIDE-01 ("pickup (map pin / **search** / saved)") is in M7's scope line, and the T3 ticket text names "pickup pin/**search**/saved". What shipped is pin + saved + a filter over saved places — no place/address search. The SRS also provisions no geocoding external service (ES-01…06 cover SMS, auth, push, OSM/OSRM, voice, payments), so the requirement is unimplementable without a new owner-level decision. The gap is honestly recorded in the tracker ("owner reminded 2026-10-11") but there is no recorded ruling, SRS amendment, or owning ticket — exactly the "silent deviation" drift the conduct rule guards against once the tracker note scrolls away.
- Fix Suggestion: obtain the owner's ruling and record it: either (a) V1 ships pin + saved only — amend SRS RIDE-01 and UC-R-04 step 1 accordingly, or (b) provision a geocoding provider (e.g. self-hostable Nominatim beside the ES-04 OSRM migration) and schedule a search ticket in a named milestone. Doc-only resolution is acceptable; leaving it as a tracker note is not.

## Warning

**W1 — An admin-UI region save silently resets a non-default `timeZone`; the UI cannot set it at all**
- Category: correctness · Severity: Warning · Certainty: High
- Location: `backend/src/main/java/com/labby/backend/service/RegionServiceImpl.java` (`applyBundle` → `region.setTimeZone(timeZone(request.timeZone()))`, omitted → `Asia/Damascus` per `regions-v1.yaml:529-533`); `apps/admin/src` contains no `timeZone` occurrence.
- Rationale: the contract's PUT-replace semantics are documented, but the only API client (the admin dashboard) never sends the field — so a region whose zone was set to anything but Damascus via the raw API loses it on the next dashboard edit, and admins have no way to set a zone. Surcharge windows evaluate in this zone (FareCalculator), so a wrong zone silently misprices rush windows. Impact today is nil (every region is Damascus); the tracker already notes "admin UI field still to be agreed with the owner".
- Fix Suggestion: add the time-zone field to the region form once the owner agrees (or have the backend keep the stored zone when the request omits the field, and make the UI always echo it back).

**W2 — UC-A-18 ride inspection exists only as an API; no admin screen anywhere, and no later ticket owns it**
- Category: integration / srs-conformance · Severity: Warning · Certainty: High
- Location: `apps/admin/src/pages/` (no rides page or route; `grep "admin/rides" apps/admin/src` is empty); backend side complete in `AdminRidesController` (`rides:view`), `AdminRideServiceImpl`, tested in `RideBookingIntegrationTest` ("admin ride search and detail need rides:view") and the T5 test.
- Rationale: M7's own user story says "As an admin, I can inspect any ride: timeline, trace, offers trail (UC-A-18)", and ADM-05 is V1 — but M7's ticket plan never contained an admin-UI ticket for it (a pre-existing planning gap, not slipped implementation), and no later milestone ticket names the ride search/detail screen either, while M10's live-ops map ("click-through to ride/driver detail") and M11's reports evidence panel both assume it exists.
- Fix Suggestion: schedule the admin rides screen explicitly (the backend is ready; a search page + detail per the admin design language is a small ticket — design-first applies) or record an owner-approved deferral naming the owning milestone (M10 at the latest).

**W3 — The rider jest suite is load-flaky on the dev machine: 15/31 suites failed purely on 5000 ms test timeouts, all green when re-run**
- Category: tests · Severity: Warning · Certainty: High
- Location: run 1 of `apps/rider npm run check` (e.g. `booking-screen.test.tsx`, `ride-flow.test.tsx` — every failure "Exceeded timeout of 5000 ms", suite times 30–40 s); run 2, alone, 218/218 green; CI on HEAD green (run 38137887985).
- Rationale: the pattern (first test of a suite dying at exactly the default timeout under CPU contention from jest's own workers) is the machine-local flake already on record for admin (M4) and driver (M6) — but the new ride suites now make the rider app the biggest jest consumer and it reproduced with nothing else running. A gate that fails one run in two stops being trusted.
- Fix Suggestion: raise `testTimeout` (e.g. 20 s) or cap `maxWorkers` in `apps/rider/jest.config`; same prophylactic for driver.

## Info (max 5)

1. **Stale driver copy:** `availability.onlineHint` still says "Keep Labby open while you're online…" (`apps/driver/src/i18n/translations/en.json:418` + ar) — contradicts M6-X2 background streaming and the owner-approved background-location banner copy. Already in the tracker's nitpick backlog.
2. **Cancellation-fee granularity:** fee is per region only (`Region.cancellationFee`, `RideLifecycle.regionFee`), while SRS RIDE-07 says "per region + service type" and PRC-03 says per region — the SRS contradicts itself. Needs a ruling before M8 starts *collecting* the recorded fees.
3. **Driver offer card carries no trip length/duration** (`RideOfferDto` has pickup distance/ETA + estimated fare only) — UC-D-06's required fields are all present; known gap already recorded in the tracker.
4. **Mark-unpaid note is never sent:** the contract supports a `note` (UC-D-09 E1 support path) but `apps/driver/src/api/rides.ts:71` `markUnpaid(rideId)` takes none and `complete-screen.tsx:213` calls it bare — the future support ticket loses the driver's account of the dispute.
5. **`RideTrackingServiceImpl.monitor()` loads full `Ride` entities for every assigned ride each 5 s tick just to collect ids** (`findByStateIn`) — fine at demo scale, wasteful later.

+0 more nitpicks — ask to see them.

## What's good

- **Dispatch sequentiality is a database guarantee, not a convention:** at most one open offer per ride *and* per driver via partial unique indexes (`V10__rides.sql:161-163`); every writer locks the ride row first (`findForUpdate` / `FOR UPDATE SKIP LOCKED` for jobs), so accept-vs-cancel, double-accept and accept-vs-timeout each have exactly one winner — and the race tests prove it with genuinely concurrent HTTP requests asserting *both* legal outcomes (`RideDispatchIntegrationTest.shouldResolveAcceptVersusCancel`).
- **One fare engine, stored forever:** estimate and metered fare run through the same `FareCalculator`; components land in `fares` with a DB CHECK that the total equals their sum; receipts render from the row, proven by repricing the service type after completion. Fixture math independently re-verified (2038 m / 600 s → 1.00 + 1.02 + 1.00 = 3.02; surcharge-then-surge rounding per component; overnight/overlap window rules incl. the UTC↔Damascus case).
- **Metering reads the trace, not the odometer:** windowed PostGIS `LAG` sum over `in_ride` samples in device-time order (`RideTraceRepository.meteredDistanceMeters`), `to_pickup`/`in_ride` phase split at `startedAt`, future `recordedAt` clamped server-side.
- **The dev simulator mocks nothing:** `DevRideSimulator` goes online, streams, accepts, drives OSRM geometry and settles cash only through the same services the controllers call — dev profile + `RIDE_SIM_ENABLED` + configured phones, triple-gated.
- **Clients treat the server as the judge:** both apps resync on every (re)connect/foreground because events are not replayed; the driver offer countdown survives a wrong device clock (`offerDeadline` fallback) while the server still answers a late accept with 409; the M6-X2 fix-driven send/reconnect in `location-streamer.ts` is clean and well-tested.

## Pre-existing (out of scope, non-blocking)

- `/routing/route` remains an unthrottled proxy to the public OSRM demo server (M6 backlog; ES-04 self-hosting is a mandatory pre-launch gate).
- Per-socket session-liveness query every 5 s (M6 V2 note); a device whose only session ended without `DELETE /devices` keeps receiving pushes while another session is live (M6 N2, revisit before M10).
- Admin tables render mixed Arabic+digit plates bidi-reordered (M5 cosmetic note).

## Test run results

- `cd backend && make check` — **green**: 315 tests, 0 failures (incl. 7 ArchUnit + full Testcontainers suite; tests never touch the public OSRM server — URL points at a closed port).
- `cd apps/admin && npm run check` — **green**: 30 files, 194 tests.
- `cd apps/rider && npm run check` — **run 1 RED**: 15/31 suites failed, all 15 failures "Exceeded timeout of 5000 ms"; **run 2 (alone) green**: 31 suites, 218 tests (see W3).
- `cd apps/driver && npm run check` — **green**: 30 suites, 266 tests.
- CI on HEAD `7d072e8`: green (run 38137887985, all four jobs).

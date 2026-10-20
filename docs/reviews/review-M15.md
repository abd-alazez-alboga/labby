# Review — M15 Analytics & launch hardening + V1 final audit (`605d74d..5bf88a7`)
_10 commits · 184 files · reviewed 2026-10-20_

## Summary
M15 delivers what V1 still lacked for launch:
- the admin dashboard and directory lists, with CSV exports that reuse each list's exact filter;
- the weekly incentives engine with peak-hour windows, a driver progress screen and the admin editor;
- automated missing-key and digit checks in all three apps, plus an RTL screenshot pass;
- a 1,000-user load test;
- backup and restore scripts with a performed drill;
- a 16-row launch checklist.

The audit ran six independent read-only slice reviews:
1. backend T1;
2. backend T3/T4;
3. admin app;
4. rider and driver apps;
5. ops, docs and tracker;
6. a full V1 traceability pass over every SRS V1 requirement ID, structure conformance and test-suite health.

Every High below was re-checked against the code. H1 was reproduced: a checksum file copied to another directory fails `sha256sum --check`.

Four High findings block the milestone:
- **H1:** a backup restored from its off-server copy fails its checksum, so the production restore path does not work.
- **H2:** the `PaymentProvider` seam that ES-06 and NFR-M1 name was never built.
- **H3:** the admin user profile lacks the "full history" required by ADM-05 and UC-A-13: rides, tickets, badges/level, audit trail.
- **H4:** ADM-05 lists notification categories as an admin-managed entity, but they are a fixed catalog, and the owner never confirmed that M6 decision.

Every other V1 requirement ID traces to backend code, a client and at least one test.

**Verdict:** Fail
**Findings:** Critical 0 · High 4 · Warning 16 · Info 5 · Praise 6

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| T1: metric formulas tested against hand-counted fixtures | met | `AnalyticsIntegrationTest` fixture table with an inline derivation per expected number (all four groups, region filter, empty range, validation, permission). Time-zone bucketing not proven (W4) |
| T1: exports match on-screen filters exactly | met | One `AdminListFilters` parser and one where-clause builder per list, shared by page, count and export. Rides tie-break on id. `AdminExportsIntegrationTest.assertSameRows` covers all five lists |
| T1: heavy queries bounded (indexed, time-limited) | partial | V30 range indexes; `SET LOCAL statement_timeout` on dashboard and exports. The three new list endpoints have no limit (W3) |
| T2: UC-A-30/31 end-to-end, charts correct against fixtures, permission-gated, tests green | met | admin `analytics-dashboard`, `directory-lists`, `csv-export` (55 tests in the scoped run). Nav, route and control gating agree. Browser-time-zone day bounds (W5) |
| T3: boundary tests 39/40/41 on a controlled clock | met | `IncentiveIntegrationTest.shouldPayTheHighestTierReached` (39/40/41, 59/60/61) |
| T3: credits land typed and linked | met | `bonus` ledger entry + `incentive_awards.driver_ledger_id` (NOT NULL UNIQUE) + outbox row, one REQUIRES_NEW transaction |
| T3: progress UI matches backend state | partial | Shared `IncentivePolicy` for job and endpoint (`shouldShowProgressThatMatchesThePayout`). Driver screen hides the tier already secured between tiers (W8) |
| T3: jobs idempotent on re-run | met | `shouldBeIdempotent`, plus `uq_incentive_awards_week`. Missed or failed runs are never caught up (W1) |
| T4: automated missing-key check in the gate, zero missing keys | met | `i18n-keys` tests in all three apps, run by `npm run check` / CI (green on 4620c81). Auditors' own scans found zero missing keys and identical EN/AR key sets |
| T4: manual RTL screenshot pass recorded | met | `docs/qa/rtl-pass-2026-10-20.md`, 16 screenshots. Money panels still leak English server text (W7) |
| T5: targets met and recorded | partial | Run 2 numbers match `run2.json` exactly. The harness drops unoffered rides from the first-offer stats and samples GPS about every 6 s, not every 5 s (W12) |
| T6: restore drill performed from a real backup into a clean environment | partial | Same-machine drill passed; the off-server copy fails its checksum (H1) |
| T6: checklist complete with owner/status per row | met | 16 rows, owner and status each, OSRM blocking. Missing the proxy client-IP step (W14) |
| T7 / milestone: final audit passed, tracker accurate → V1 done | unmet | This audit is a Fail; tracker drift (W13) |
| Milestone: dashboard numbers provably correct; exports faithful | met | see T1 |
| Milestone: incentives pay exactly per config on controlled clocks | met | see T3 |
| Milestone: 1k load targets met and documented; restore drill for real | partial | W12, H1 |
| Milestone: launch checklist with OSRM as a blocking row | met | row 1 |

## Critical
None.

## High

### H1 — A dump restored from its off-server copy fails its checksum
- **Category:** correctness · **Severity:** High · **Certainty:** High (reproduced)
- **Location:** `ops/backup/labby-backup.sh:52` (`sha256sum "$dump"` records the absolute path); `ops/backup/labby-restore.sh:33`.
- **Rationale:**
  - The restore changes into the dump's directory and runs `--check`, which opens the *recorded* absolute path.
  - On a clean host restoring the fetched copy (`backups.md` restore step 3), it fails with "No such file". With `--status` and `set -e` it exits 1 and prints no reason.
  - When the original still exists, it verifies the original, not the copy.
  - The drill passed only because it ran on the same machine.
  - A missing `.sha256` silently skipped the check, although `backups.md` says the check always runs.
- **Fix Suggestion:**
  - Write the checksum with the bare file name from inside `$BACKUP_DIR`.
  - Make the restore refuse a missing or mismatching checksum.
  - Re-run the drill from a copied dump on a "clean host".

### H2 — The `PaymentProvider` seam that ES-06 / NFR-M1 require does not exist
- **Category:** srs-conformance · **Severity:** High · **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/service/` holds seams for SMS, routing, push, storage and realtime only. A repo-wide grep finds `PaymentProvider` only in `docs/SRS.md` (lines 54, 68, 317, 352).
- **Rationale:** NFR-M1 requires "enforced provider seams (`SmsSender`, `PaymentProvider`, `RoutingProvider`, push)". ES-06 says the interface "reserves the V2 gateway seam", and SD-03 says payments are "behind swappable interfaces". Cash and wallet settlement run inline in `RideMoneyServiceImpl`. V1 behaviour is correct, but the named architectural seam was never built and no ruling defers it.
- **Fix Suggestion:**
  - Add `service/PaymentProvider`, with the V1 implementation covering the cash + earned-credit wallet settlement `RideMoneyServiceImpl` performs today.
  - Route ride settlement through it with no behaviour change, and add a unit test of the seam.
  - V2 card gateways then plug in behind the interface.

### H3 — The admin user profile lacks the "full history" of ADM-05 / UC-A-13
- **Category:** srs-conformance · **Severity:** High · **Certainty:** High
- **Location:** `apps/admin/src/pages/trust/TrustUi.tsx:54-57` (two tabs: Trust, Wallet); `UserTrustPage.tsx`.
- **Rationale:**
  - UC-A-13 requires the profile to show:
    - roles and states, ratings, reports and wallet/ledger (all present);
    - **ride history, tickets, badges/level and the audit trail of admin actions on them** (absent).
  - The backend already filters rides (`/admin/rides?userId`), tickets (`/admin/tickets?userId`) and the audit log (`?targetId`). Today an admin finds a user's rides only by retyping the phone on the Rides page.
  - Earlier milestone audits did not catch this; the full-system traceability pass did.
- **Fix Suggestion:**
  - Draw a History tab on the canvas first (design-first rule): recent rides, tickets, badges/level, and audit entries gated on `audit:view`, each linking to the full filtered list.
  - Then build it against the existing endpoints, adding a read endpoint for a user's badges/level if none exists.

### H4 — Notification categories: ADM-05 says admin-managed, the system has a fixed catalog
- **Category:** srs-conformance · **Severity:** High · **Certainty:** Medium (SRS ambiguity)
- **Location:** `V7` DB CHECK on the category set; `backend/docs/api/realtime-v1.yaml` header. No admin endpoint or page exists.
- **Rationale:**
  - ADM-05 lists "notification categories" among the entities admins manage.
  - NTF-01 fixes the category set and locks `ride` and `safety`.
  - The M6-T1 tracker record chose the fixed catalog "owner to confirm on return", and no confirmation was ever recorded.
- **Fix Suggestion:** record the fixed-catalog ruling in SRS ADM-05: the NTF-01 catalog, not admin-editable in V1. Admins still see the categories through the notification records. List it for owner confirmation. The alternative is to build category management, which no board or contract covers.

## Warning

### W1 — Incentive payout is a single weekly shot; a missed or failed run is never paid, and western regions are paid a week late
- **Category:** correctness · **Severity:** Warning · **Certainty:** High
- **Location:** `IncentiveJob.java:22`; `IncentiveServiceImpl.java:116-132`, `:248`.
- **Rationale:**
  - The Monday 00:30 cron is the only payer. If a restart misses it, the week is lost.
  - Any exception other than the unique-key race aborts the loop, so later drivers and regions go unpaid.
  - The cron runs in Asia/Damascus. A region in a zone behind it is still in Sunday at 00:30 Damascus time, so `previous()` pays the week before last.
- **Fix Suggestion:** run hourly; this is safe because awards are exactly-once. Catch and log per award and per region.

### W2 — Scheduled rides: the peak bonus counts the booking moment, not the moment surcharge pricing uses
- **Category:** srs-conformance · **Severity:** Warning · **Certainty:** Medium
- **Location:** `IncentiveStatsRepository` (`rides.requested_at`) vs `ScheduledRideServiceImpl.java:91,113`.
- **Rationale:** ruling Q1 says peak trips are those "REQUESTED inside a window (the moment surcharge pricing uses)". A scheduled ride is priced at its `scheduled_at`, but counted at its booking time.
- **Fix Suggestion:** count the pricing moment, `COALESCE(scheduled_at, requested_at)`, and record it as an application of Q1.

### W3 — The new admin list endpoints have no statement timeout
- **Category:** performance · **Severity:** Warning · **Certainty:** Medium
- **Location:** `AdminDirectoryServiceImpl.java:36-38, 77-79, 118-121`.
- **Rationale:** `GET /admin/transactions` counts the whole wallet + ledger union on every page with no time limit. The T1 AC asks that heavy queries be time-limited.
- **Fix Suggestion:** `analyticsRepository.limitStatementTime(...)` at the start of each page method, inside a read-only transaction.

### W4 — Tests do not prove region-local daily buckets or the 503 path
- **Category:** tests · **Severity:** Warning · **Certainty:** High
- **Location:** `AnalyticsIntegrationTest.java:316-320` (fixture rides fall on the same date in UTC and +3), `:302-313`.
- **Rationale:**
  - A UTC-bucketing bug would pass.
  - The timeout test proves only the exception class, never the `503 query_timeout` response.
- **Fix Suggestion:**
  - Add a ride at local 00:30 (the previous UTC day) and assert its local date.
  - Add a handler-level test for `QueryTimeoutException → 503 query_timeout`.

### W5 — Dashboard day bounds use the browser's time zone, not the region's
- **Category:** correctness · **Severity:** Warning · **Certainty:** High
- **Location:** `apps/admin/src/pages/dashboard/dashboard-utils.ts:41-48, 60, 97-107`.
- **Rationale:** an admin outside Syria sees rides near midnight counted in the totals but dropped from the per-day chart, so the bars stop adding up to the cards.
- **Fix Suggestion:** with a region selected, compute the day bounds in `region.timeZone`.

### W6 — The custom-range 366-day check rounds away a DST hour
- **Category:** correctness · **Severity:** Warning · **Certainty:** High
- **Location:** `dashboard-utils.ts:74` (`Math.round`) vs `AnalyticsServiceImpl.java:54`.
- **Rationale:** the client accepts a range the backend rejects with `range_too_long`, leaving a Retry button that can never succeed.
- **Fix Suggestion:** compare exact milliseconds against `366 × 86 400 000`.

### W7 — Money panels show the backend's English message inside the Arabic UI
- **Category:** srs-conformance (NFR-I1) · **Severity:** Warning · **Certainty:** High
- **Location:** `apps/admin/src/pages/money/money-format.ts:86-88` (`rejectionDetail`), used by `SettlementPanel.tsx` and `GrantRefundPanel.tsx`.
- **Rationale:** T4 fixed exactly this leak in `SurgeOverridePanel`; the same class survived here.
- **Fix Suggestion:** show the server detail only in the English UI, as the surge panel does.

### W8 — The driver incentives card hides the tier already secured between tiers
- **Category:** correctness · **Severity:** Warning · **Certainty:** High
- **Location:** `apps/driver/src/components/incentives/incentives-screen.tsx:139-206`.
- **Rationale:** with 45 trips on tiers 40/60, the card shows only "next: 60". The amount that would pay right now appears nowhere until the top tier is reached. The fixtures cover only 26 and 63 trips.
- **Fix Suggestion:**
  - Show the secured tier amount in the in-between state.
  - Add a 45-trip test.

### W9 — Award dates rely on `en-CA` formatting as `YYYY-MM-DD`
- **Category:** correctness · **Severity:** Warning · **Certainty:** Medium
- **Location:** `apps/driver/src/incentives/format.ts:122-137`.
- **Rationale:** the output depends on the device's ICU data. On a mismatch, the row shows the raw string. The fixture time (06:00Z) never exercises the zone shift of the real job time.
- **Fix Suggestion:**
  - Build the date from `formatToParts`.
  - Test with `awardedAt: 2026-10-18T21:30:00Z`.

### W10 — Driver incentives states untested
- **Category:** tests · **Severity:** Warning · **Certainty:** High
- **Location:** `apps/driver/src/__tests__/incentives.test.tsx`.
- **Rationale:** these paths have no test:
  - loading, error and no-region;
  - a hidden "off" card;
  - all cards off falling back to the empty state;
  - the in-between tier.
- **Fix Suggestion:** one test per branch.

### W11 — The backup keeps an unverified archive and writes world-readable dumps
- **Category:** correctness / security · **Severity:** Warning · **Certainty:** High
- **Location:** `ops/backup/labby-backup.sh:33-50`.
- **Rationale:**
  - When `pg_restore --list` rejects an archive, the script takes the "not on PATH" branch and keeps it with exit 0.
  - There is no `umask`, so dumps holding phones and password hashes are created 0644.
  - The runbook does not mention encrypting the off-site copy.
- **Fix Suggestion:**
  - Check `command -v` first and make a `--list` failure fatal.
  - Delete the partial file with a `trap`.
  - Add `umask 077`.
  - Document at-rest encryption of the target.

### W12 — Load harness: unoffered rides drop out of the first-offer stats; GPS sampled about every 6 s
- **Category:** tests · **Severity:** Warning · **Certainty:** High
- **Location:** `backend/src/test/java/com/labby/backend/load/LoadScenario.java:517-521` (inner join), `:320-344` (5 s sample checked inside a 2 s poll loop).
- **Rationale:**
  - Run 1 excluded 2,879 never-offered rides, yet the doc says run 1 "met every latency target too". Run 2 is unaffected (2,671 = 2,671).
  - 30,594 samples against about 34,200 at a true 5 s cadence means about 11 % less GPS load than NFR-P1 states.
- **Fix Suggestion:**
  - Left-join and report unoffered rides.
  - Run the sample on a fixed 5 s schedule.
  - Re-run and correct the doc.

### W13 — Tracker drift
- **Category:** structure (tracker) · **Severity:** Warning · **Certainty:** High
- **Location:** `docs/milestones/README.md`: line 103 shows M15 `todo`; line 260 shows M15-T5 `todo`; lines 29/34-36 describe the T2 era and M14 blockers; commit hashes are missing for T1/T3–T6.
- **Rationale:** a cold-start session would be misled. This breaks the CLAUDE.md "update immediately" rule.
- **Fix Suggestion:**
  - Rewrite "Current state" as one accurate M15 block.
  - Flip both rows.
  - Add the hashes.

### W14 — Launch checklist misses the client IP behind the TLS proxy
- **Category:** security · **Severity:** Warning · **Certainty:** High
- **Location:** `docs/launch-checklist.md` row 6; `AuthController.java:86` (`getRemoteAddr()`); no `server.forward-headers-strategy`.
- **Rationale:** behind the proxy every request carries the proxy's IP. Login throttling, keyed on phone + IP, then becomes phone-only, so anyone can lock any user out (NFR-S3).
- **Fix Suggestion:** a checklist step covering three things:
  - set the forward-headers strategy;
  - let only the proxy reach the backend;
  - verify the 429 behaviour behind it.

### W15 — The ADM-01 "map-extract ops step" note never reaches the admin
- **Category:** srs-conformance · **Severity:** Warning · **Certainty:** High
- **Location:** only `backend/docs/api/regions-v1.yaml:18-19`; not in the admin activation card.
- **Rationale:** ADM-01 and UC-A-05 step 5 require new-region setup to note the map-extract step.
- **Fix Suggestion:** an EN/AR hint on the region activation card.

### W16 — Instance-local state in the API (NFR-P4)
- **Category:** structure · **Severity:** Warning · **Certainty:** High
- **Location:** `MeServiceImpl.java:57` (`phoneChangeSessions` ConcurrentHashMap); `LoginThrottle.java:20`.
- **Rationale:**
  - NFR-P4: "Stateless API, no instance-local state".
  - A phone change in progress breaks across a restart or a second instance.
  - Login counters reset on restart and are per instance.
- **Fix Suggestion:** persist both in the database (a phone-change stage table and login-failure rows) so the API holds no state.

## Info (max 5)
1. **I1:** the incentive notification says "for 1 peak-hour trips" in English, and the Arabic always uses the singular «رحلة» (`NotificationRenderer.java:1180-1201`). The renderer already handles Arabic plural agreement for days.
2. **I2:** `peak_window_invalid` is used by the admin client but not documented in `regions-v1.yaml`.
3. **I3:** the broad `DataIntegrityViolationException` catch (`IncentiveServiceImpl.java:248`) silently skips a sub-cent amount that fails the `amount > 0` CHECKs, and logs it as "already paid".
4. **I4:** `DevRegionSeeder` seeds a peak bonus with no windows, so any admin save of the dev region returns 400.
5. **I5:** the results doc links `run2-resources.log`, which is gitignored (`*.log`), and some of its wording overstates. The drill doc mixes two runs.

+14 more nitpicks — ask to see them. Among them:
- the admin directory page offset overflow;
- an unvalidated `currency` filter;
- the object URL revoked synchronously;
- a 0.5 axis tick;
- an unused `EXPORT_MAX_ROWS` and a hidden `userId` filter;
- only the newest award shown on the driver screen;
- a progressbar without a label;
- no rider `format-time` regression test;
- `rides.requested_at` reset on scheduled fallback.

## What's good
- **Exports match their lists by construction:** one filter object feeds list, count and export on both sides of the wire, and `assertSameRows` proves it per list.
- **Hand-counted fixture table:** each dashboard assertion carries its derivation inline.
- **Incentive exactly-once is DB-enforced:** a unique week key, a NOT NULL UNIQUE ledger link and a per-award REQUIRES_NEW transaction. The job and the live progress share one pure `IncentivePolicy`, so they cannot disagree.
- **`TimeWindows` extraction:** surcharge pricing and peak bonus now share one time-window implementation, byte-identical to the old logic.
- **Load and drill docs are honest:** they state their scope (one laptop, no OSRM, polling). The balance-floor finding was turned into a launch gate (row 12).
- **System-wide:**
  - ArchUnit rules unchanged since the skeleton.
  - One `@PreAuthorize` per admin endpoint across all 28 admin controllers.
  - Append-only DB triggers on the audit log, ledgers and SOS events.
  - Flyway V1–V31 contiguous.
  - No skipped or focused tests anywhere.
  - No secrets in the repository or its history.

## Pre-existing (out of scope, non-blocking)
- The admin rides `phone` filter is open to admins without `support:handle` (rides-v1, unchanged).
- The rides page day bounds have the same browser-time-zone choice as W5 (`rides-search.ts:98-106`); exports reuse it, so the CSV still matches the list.
- Driver/rider no-region copy says "Turn on location" for the `outside` / `error` statuses too (challenges does the same).
- Rider photo upload shows the network copy for a 413/415.
- The M13 growth Javadoc in `NotificationRenderer` sits above `incentiveAwarded` (displaced in M14).
- No lint-enforced module boundaries in the apps (accepted in earlier audits).
- MapStruct used only by `UserMapper` (accepted pattern).

## Test run results
Scoped suites only (owner rule 2026-10-19); the full gate is CI.

| Slice | Command | Result |
|---|---|---|
| Backend T1 | `./mvnw test -Dtest='AnalyticsIntegrationTest,AdminExportsIntegrationTest,CsvWriterTest,LayeredArchitectureTest'` | 24 tests, 0 failures |
| Backend T3/T4 | `./mvnw test -Dtest='IncentiveIntegrationTest,RegionServiceImplTest,NotificationRendererTest,OtpServiceImplTest,FareCalculatorTest,LayeredArchitectureTest'` | 59 tests, 0 failures |
| Admin | `npx vitest run` on 8 scoped files; `tsc -b`; `eslint src`; `prettier --check` | 55 tests passed; all clean |
| Driver | `npx jest` incentives, i18n-keys, settings-screen, push-deep-links; `tsc --noEmit`; eslint | 32 tests passed; clean |
| Rider | `npx jest src/i18n …profile-edit-screen… src/notifications`; `tsc --noEmit`; eslint | 51 tests passed; clean |
| Ops | checksum reproduction in a scratch directory | H1 reproduced (`FAILED open or read`, exit 1) |

CI on `main`, all four jobs green:

| Run | Commit | Contents |
|---|---|---|
| 39338405499 | 9463ef5 | T2 fix |
| 39342470928 | 29ed040 | T3 |
| 39347621706 | 4620c81 | T4 |
| 39350677172 | 5bf88a7 | T5 + T6 |

## Resolution (labby-fix, 2026-10-20, owner standing approval)
Fix commits: f7661e5 (driver/rider) · f819800 (ops, restore drill run B, load run 3) · 1d3487e (SRS ADM-05) · e120c03 (backend analytics + incentives) · edd0f90 (payment seam + V32 auth state) · eb46915 (admin + user history + boards). CI run 39355941216 on edd0f90: all four jobs green.

| Finding | Resolution |
|---|---|
| H1 | Fixed: the checksum names the bare file; restore refuses a missing or mismatching checksum. **Drill run B** restored the off-server copy on a clean host (original deleted): pass, 18 s, 11/11 tables match. Refusals verified: one changed byte, no checksum, non-empty database. |
| H2 | Fixed: `PaymentProvider` (`collectUpTo` / `collectInFull`) with `WalletPaymentProvider` + `CashPaymentProvider`, selected by `PaymentProviders` (fails at startup unless each `PaymentMethod` has exactly one). Fares, shares, carried dues and cancellation fees now go through the seam with unchanged arguments and order. `PaymentProvidersTest` + 11 money suites green. |
| H3 | Fixed: boards `A15UserHistory` / `A15UserHistoryAr` drawn first (approved under the standing approval, in the review gallery), then a History tab (`users/:id/history`) with rides, tickets, badges/level and audit trail. Each section is gated by its own permission. New `GET /admin/users/{id}/gamification` (`users:view`, growth-v1). |
| H4 | Resolved as an SRS clarification: ADM-05 notification categories = the fixed NTF-01 catalog, not admin-editable in V1 (SRS + realtime-v1 header). **Owner to confirm.** |
| W1 | Fixed: hourly cron; each region pays its own last finished week; failures are isolated per region and per award. Tests cover two zones, failure isolation and retry. |
| W2 | Fixed: a scheduled ride counts for peak at `scheduled_rides.scheduled_at` (Q1 applied); tested both directions. |
| W3 | Fixed: statement timeout on the three list endpoints (contract documents 503). The page-offset overflow is fixed as well. |
| W4 | Fixed: local-00:30 bucketing test; `GlobalExceptionHandlerTest` checks the 503 `query_timeout` response. |
| W5 / W6 | Fixed: dashboard day bounds are computed in the region's zone (`zoneMidnight`, DST-safe); exact-millisecond 366-day check. |
| W7 | Fixed: money panels show the server detail in the English UI only. |
| W8–W10 | Fixed: boards `D15IncentivesSecured` (+AR) drawn first, then a secured-tier line; `formatToParts` dates; 9 new state tests. Every award of the latest week is shown; bars have accessibility labels. |
| W11 | Fixed: `umask 077`, `pg_restore --list` failure is fatal, a trap removes partial dumps; runbook asks for at-rest encryption of the off-site copy. |
| W12 | Fixed: true 5 s GPS schedule, unoffered rides counted, freshness measured at the stop. **Run 3** became the record: steady state 0 of 2,522 first offers over 3 s (p95 1.07 s); 26 of 2,798 over 3 s, all in the cold-JVM ramp minute (documented, checklist row 10). |
| W13 | Fixed: tracker rows, hashes and Current state rewritten. |
| W14 | Fixed: checklist row 6 adds the forward-headers strategy, proxy-only access and a 429 check. |
| W15 | Fixed: map-extract hint (EN/AR) on draft regions' activation card. |
| W16 | Fixed: V32 `phone_change_sessions` + `login_failures`; no instance-local auth state left. `login` keeps the failure count on a 401 (`noRollbackFor`). |
| I1–I5 | Fixed: trip plurals EN/AR; `peak_window_invalid` documented; zero-amount skip + narrowed catch; dev seed windows; log renamed `.txt`, doc wording and the drill doc's two runs separated. Nits fixed: offset overflow, deferred URL revoke, whole-number ticks, dead `EXPORT_MAX_ROWS`, hidden `userId` filter removed, all awards shown, progressbar labels, rider format-time test, load-account warning (checklist row 13). |

Judgment calls for the owner (all under the standing approval):
- the H4 ruling;
- the secured-line copy «… مضمونة · تُدفع يوم الاثنين»;
- the Arabic genitive «رحلتين» after «عن»;
- Q1 and Q3 amendments recorded in the milestone file;
- the History tab's ticket list reads the latest 50 and shows the newest 10;
- the dashboard fetches each region's detail to learn its time zone.

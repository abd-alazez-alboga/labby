# Review — M11 Trust & quality (`10171c2..0adee10`)
_9 commits · 230 files · reviewed 2026-10-16 · four independent read-only reviewers (backend incl. the T6 privacy review, rider, driver, admin); lead verified the High and the DRV-04 finding against source and ran every gate_

## Summary
M11 delivers the full trust machinery: immutable ratings with a daily-snapshot exposure model, reports with photo evidence and a once-only resolution, REP-03/RATE-03/DRV-07 flags, rating auto-suspension, role-level and whole-account suspension with the owner's mid-ride exemption, the driver performance dashboard, and the admin reports/flags/user-trust tooling. Contracts match the code field for field in all three clients, every admin endpoint carries the contract's permission and audit row, the threshold math and sliding windows are correct and clock-tested, and the four T5 scenarios pass end to end. One High remains: the immediate low-rating suspension lets the suspended party attribute the rating that tipped them, and the milestone AC "the rated party can never attribute a rating" is therefore only partly met. Plus a set of Warnings, most of them small, four needing owner rulings.

**Verdict:** Fail
**Findings:** Critical 0 · High 1 · Warning 16 · Info 5 (+11 more) · Praise 4

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| T1 — immutability + uniqueness at DB level; migrations clean | met | V17 triggers `trg_ratings_immutable`, `trg_reports_guard_mutation`, `uq_ratings_ride_rater_role`, `uq_reports_ride_reporter`, `uq_account_flags_open`; TrustMigrationIntegrationTest (11) |
| T2 — rating window/uniqueness/immutability, aggregate math, auto-suspend exactly at thresholds, reactivation, REP-03 3-in-90, metric formulas, warning-not-suspension | partial | All tested on a controlled clock (Trust*IntegrationTest, TrustRulesTest), but B-W2/B-W3 concurrency gaps can miss a crossing and B-W4 lets a reactivation bypass DRV-04 |
| T3 — UC-S-17/18, UC-D-20 flows + exceptions against mocks; tests green | met | rider 388 / driver 437 green; all rows met in both reviewer AC tables (with R-W*, D-W* below) |
| T4 — UC-A-14/16/17 end-to-end; permission-gated; audited; tests green | met | admin 336 green; routes/nav/actions gated per contract; every admin decision audited server-side (A-W1/A-W2 below) |
| T5 — scripted scenarios pass on controlled data/clock | met | TrustSimulatorIntegrationTest (4 scenarios), backend 505 green |
| Milestone — fire exactly per config, provably, on controlled clocks | partial | correct sequentially and tested; B-W2/B-W3 races |
| Milestone — the rated party can never attribute a rating to a ride or person | partial | daily snapshot closes the average-move channel; B-H1 and B-W1 remain, undocumented |
| Milestone — admin trust tooling complete and audited | met | AdminReports/Flags/UserTrust controllers + pages; audit rows on every admin action |

## Privacy review (M11-T6)
No rider/driver endpoint, DTO, push, notification or error message exposes an individual received rating, its ride, its rater or its comment; users see only what they gave (`myRating`) and aggregates from `rating_snapshots`, null below 5 ratings; admin views show live aggregates only, never individual ratings. The documented mitigation (trust-v1.yaml "Aggregates and privacy": daily snapshot) holds for the average itself. Two residual channels are NOT documented: B-H1 (immediate suspension) and B-W1 (exact count + 2-decimal average across daily snapshots).

## High
### B-H1 — The low-rating suspension identifies the rater of the ride that just ended
- **Category:** srs-conformance (RATE-02, milestone privacy AC) · **Severity:** High · **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/service/RatingServiceImpl.java:104` (evaluate inside `POST /rides/{id}/rating`), `:129-131`; `SuspensionServiceImpl.java:53-59`; demonstrated by `TrustSimulatorIntegrationTest.java:151-169`
- **Rationale:** USR-05 is evaluated synchronously on the live average when the counterpart rates. The suspended driver/rider gets the `account.role_suspended` push seconds after their last ride's counterpart submitted — so they know that person rated them low. The owner ruling "suspension evaluates live" did not weigh this channel, and it is not documented as accepted.
- **Fix suggestion (owner ruling needed):** (a) evaluate USR-05/RATE-03 in the daily snapshot job (suspension lands next day, decoupled from any one ride), or (b) keep it live and record the residual risk explicitly in trust-v1.yaml + SRS RATE-02.

## Warning
**Backend**
- **B-W1 — snapshot count + 2-decimal average reveal each day's new scores** · privacy · Warning · High · `RatingServiceImpl.java:190-200`. Diffing two daily snapshots with an exact `ratingCount` yields the exact new score(s); with one ride that day it is attributable. Fix (ruling): expose the count bucketed (e.g. "20+"), refresh only after ≥ k new ratings, or document as accepted.
- **B-W2 — two concurrent ratings of the same user can both miss a USR-05/RATE-03 crossing** · correctness · Warning · Medium · `RatingServiceImpl.java:112-119`. The aggregate is read without a lock in each transaction. Fix: lock the rated user's role assignment (`findForUpdate`) before computing the aggregate.
- **B-W3 — concurrent substantiations can miss the REP-03 threshold** · correctness · Warning · Medium · `ReportServiceImpl.java:253-273`. Same pattern. Fix: same lock on the reported user's role before counting.
- **B-W4 — reactivating a driver role bypasses DRV-04** · correctness/srs DRV-04 · Warning · High · `SuspensionServiceImpl.java:98-104`. A manual suspension that replaced `document_expired`, or a document that expired while the role was low_rating-suspended, becomes ACTIVE on reactivation although a current document is expired; the driver can go online until the next daily expiry pass. Fix: on reactivation of the driver role, if any current document is expired, set `document_expired` instead (or 409 `document_expired`).
- **B-W5 — whole-account suspension leaves a searching request live** · correctness/USR-06 · Warning · High · `SuspensionServiceImpl.java:114-138`, `AccountSuspensionInterceptor.java:104-111`. A `requested`/`offering` ride stays dispatchable and the rider can no longer cancel it. Fix: cancel the account's pre-acceptance rides on account suspension (system cancel, no fee), or allow cancel of own pre-acceptance ride.
- **B-W6 — `rider_no_show` cancellations count against the driver's cancellation rate** · srs-conformance · Warning · Medium · `RideRepository.java:225-226`. Matches the contract text literally, but penalises the driver for the rider's no-show. Needs a ruling.

**Rider app**
- **R-W1 — a reactivated rider stays on the suspended screen until relaunch** · correctness · Warning · High · `apps/rider/src/auth/auth-context.tsx:133`, `:188-205`. The `account.reactivated` / `account.role_reactivated` pushes and app foregrounding don't re-read `/users/me`. Fix: re-read the profile on those events (as the driver app does).
- **R-W2 — whole-account-suspended rider is offered rating/reporting that always fails** · correctness · Warning · High · `ride-view.tsx:241-261`, `safety-actions.tsx:265`; errors shown as retryable (`rating-view.tsx:181-187`, `report-screen.tsx:162-170`). Fix: hide prompt/link when the account is suspended, and map 403 `account_suspended` to a non-retry notice.
- **R-W3 — a second rating prompt can open right after the first** · correctness · Warning · Medium · `apps/rider/src/trust/rating-prompts.ts:66-86`. Fix: mark the launch check done when the post-ride rating view shows.

**Driver app**
- **D-W1 — role-suspended drivers lose rating/reporting and "Your reports"** · correctness · Warning · High · `RatingPromptProvider.tsx:109`, `_layout.tsx:64, 97-110`. The backend allows both for a role-only suspension; the app hides them once the ride hold ends, so a low_rating-suspended driver receives `report.resolved` pushes but can't open the outcomes. Fix: keep rate/report/reports reachable for role-only suspensions (block only for whole-account).
- **D-W2 — dead-end in-ride Report link on a whole-account suspension** · correctness · Warning · High · `safety-actions.tsx:173-189`, `report-rider-screen.tsx:42-50`. Same as R-W2 for the driver. Fix: same.
- **D-W3 — the ride-hold release is untested** · tests · Warning · High. No test for: breakdown dismissed / ride cancelled → suspended gate shows and availability stops; role suspension landing mid-ride.

**Admin**
- **A-W1 — a failed suspend/reactivate carries the typed reason into a different action** · correctness · Warning · High · `apps/admin/src/pages/trust/SuspensionPanel.tsx:384, 399-411`. After a 409 + reload the form falls back to another action with the old note still filled in — a note the user will see. Fix: clear note + selection on failure.
- **A-W2 — "Suspend role" hidden for document_expired roles** · srs-conformance · Warning · High · `apps/admin/src/pages/trust/trust-format.ts:481-487`. The contract and `SuspensionServiceImpl.java:68-71` allow it (reason becomes manual). Fix: offer it whenever the reason isn't `manual` (safe once B-W4 is fixed), or get a ruling.
- **A-W3 — misleading metric-warnings hint** · correctness · Warning · High · `apps/admin/src/i18n/en.json` / `ar.json` `regionDetail.metricWarningsHint`; `BundleForm.tsx:268-276`. Says "Blank = the defaults", but an omitted group keeps the stored value, so clearing a saved group silently changes nothing. Fix: reword the hint.
- **A-W4 — "View" link's accessible name doesn't contain its visible text** · accessibility · Warning · High · `apps/admin/src/pages/ReportsPage.tsx:201-206` (WCAG 2.5.3). Fix: use a name that starts with "View".

## Info (top 5)
- **B-I1** — MetricWarningJob's candidate query has no usable time index on `ride_offers` / `rides` and scans them in full every hour (`idx_rides_driver_accepted` is per driver). Add `(offered_at)` / `(accepted_at)` indexes in a new migration.
- **B-I3** — only one open `metric_warning` flag per driver: a second metric's breach never reaches the queue while the first is open.
- **D-I4 / admin** — fixed plural forms: driver "1 of 1 offers" and AR «عرضاً» wrong for 1, 2, 3–10; admin "1 ratings" (pre-existing pattern).
- **R-I (dead code)** — `wasRatingPrompted` unused; driver `Ride.myRating`/`MyRating` typed but unused.
- **B-I4** — automatic low-rating suspension writes no audit row (actor column NOT NULL; same as DRV-04).

+11 more nitpicks — ask to see them.

## What's good
- **Praise:** immutability and once-only resolution enforced by DB triggers, not just services.
- **Praise:** clock-controlled tests at the exact boundaries (7 days vs 7 days + 1 s, 90 days + 1 s, 19 vs 20 ratings, 15% exactly).
- **Praise:** one central suspension gate with a tight, documented, tested mid-ride allow-list; SOS always reachable.
- **Praise:** client contract types match the backend field for field in all three apps; 409 races handled and tested in the admin.
- Security: no IDOR — rating/reporting require being a party, report photos must be the caller's own unused uploads; all 9 admin endpoints carry the contract permission.

## Pre-existing (out of scope, non-blocking)
- Driver `availability.blocked.role_suspended` (en/ar.json:426) still says "Contact support for details" — against the no-support-until-M14 ruling.
- Driver M5 pushes `driver.suspended` / `driver.reinstated` missing from `ACCOUNT_STATE_EVENTS` (`deep-links.ts:130-135`).
- DRV-04 automatic suspension writes no audit row.
- History row builder looks up the service type once per row (`RideLifecycle.java:251`).
- Admin: no plural forms anywhere; phone search in user lookup needs `rides:view`; the ride SOS lookup pages the region's whole SOS list.

## Test run results
- `cd backend && make check` at 0adee10 → 505 tests, 0 failures, 0 Checkstyle violations, BUILD SUCCESS.
- Apps at their final code (unchanged since 32b990b), run sequentially: `apps/rider npm run check` → 388 passed; `apps/driver npm run check` → 437 passed; `apps/admin npm run check` → 336 passed (46 files). Lint + typecheck clean.

---

## Resolution (labby-fix, 2026-10-16)
All findings re-validated against live code (lead verified B-H1 and B-W4 directly) → all valid. Owner rulings 2026-10-16: (1) USR-05 suspension + RATE-03 flag evaluated by the daily job, never on a rating; (2) user-facing rating count hidden, snapshot rewritten only after ≥ 3 new ratings (or first exposure at 5); (3) `rider_no_show` excluded from the driver cancellation rate; (4) whole-account suspension auto-cancels the account's searching rides; (5) a closed low_rating flag reopens only after a newer rating. Recorded in trust-v1.yaml, rides-v1.yaml and docs/SRS.md.

| Finding | Resolution |
|---|---|
| B-H1 | fixed — `RatingEvaluationService` run by `RatingSnapshotJob`; `POST /rating` only stores; re-fire only after a rating newer than `role_assignments.reactivated_at` (V18) |
| B-W1 | fixed — `OwnRatingAggregate` = {role, average, snapshotAt} (no count); snapshot refresh rule ≥ 3 new / first exposure |
| B-W2 / B-W3 | fixed — role assignment locked (`findForUpdate`) before the aggregate / REP-03 count |
| B-W4 | fixed — driver reactivation with an expired current document keeps `document_expired` + DRV-04 notice; audited with the result |
| B-W5 | fixed — searching rides system-cancelled (`cancelled_by_rider`, reason `account_suspended`, V18), offer withdrawn, no fee; `PartyRideSummary.cancellationReason` added |
| B-W6 | fixed — `rider_no_show` excluded from cancellation numerator and base |
| R-W1 | fixed — profile re-read on account-state pushes and on foreground while suspended |
| R-W2 / D-W2 | fixed — no rating/report entry points on whole-account suspension; 403 `account_suspended` → non-retry notice; rider Settings "Your reports" hidden then |
| R-W3 | fixed — one rating prompt per launch |
| D-W1 | fixed — role-only suspension keeps rating, reporting and "Your reports" |
| D-W3 | fixed — hold-release and mid-ride role-suspension tests |
| A-W1 | fixed — failed action clears reason + selection |
| A-W2 | fixed — "Suspend role" offered unless already `manual` |
| A-W3 | fixed — hint reworded (blank keeps saved values) |
| A-W4 | fixed — "View …" accessible name |
| B-I1 | fixed — V18 indexes `ride_offers(offered_at)`, `rides(accepted_at)` |
| D-I4 | fixed — driver EN/AR plural forms |
| R-I dead code | fixed — `wasRatingPrompted` removed |
| B-I3, B-I4 | not changed — one open flag per kind is the approved design; automatic suspensions are unaudited like DRV-04 (no actor) |
| Admin region-form flake | `region-detail-page` full-bundle test given a 15 s timeout (no assertion change) — times out under machine load since M11 added fields |

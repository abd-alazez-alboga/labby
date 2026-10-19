# Review — M13 Growth (`515e181..15d44d8`)
_20 commits · 343 files (+31,153 / −83; 145 of them the offline design-canvas copy) · reviewed 2026-10-18_

Range: the M12 review baseline `515e181` to `HEAD` `15d44d8`. M13 proper is `931aff8..f382925` (T1 contract + V24/V25, T2 backend, T3 rider, T4 driver + admin, T5 integration); the range also carries two M12 backlog commits (`92be376`, `7706040`, spot-checked) and docs/tracker commits. Four read-only reviewers (backend, rider, driver, admin) plus the lead's own pass over the promo engine, referral/loyalty/challenge services, migrations and the T5 simulator; every finding below was re-verified by the lead against the live file before it was kept.

## Summary
M13 is substantially correct and unusually well tested: the promo money path (discount last, floor at zero, commission on the pre-discount fare, platform-funded `promo_compensation`), the referral abuse design (phone-ever uniqueness, in-place reactivation, status transition under a row lock), loyalty redemption traceability and challenge exactly-once credit are all DB-backstopped and asserted end to end, and the T5 simulator walks the three growth journeys through the real HTTP API. Two High findings keep it from passing as is: a shared-ride member who leaves or is marked absent keeps the ride's promo reservation (the code is burned for them and for every other member), and the admin promo audit snapshot omits exactly the money-relevant fields a PATCH can change. Nineteen Warnings follow, eight of which are owner rulings rather than code defects.

**Verdict:** Fail (H1 needs a real fix + test; H2 is trivial) → `/labby-fix`, then re-audit.
**Findings:** Critical 0 · High 2 · Warning 19 · Info 5 (+14 more nitpicks on request) · Praise 6

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| T1 redemption limits + referral uniqueness at DB level; migrations clean | met | `V24__growth.sql` `uq_promo_redemptions_ride`, `uq_referrals_referee(_phone)`, `ck_referrals_not_self`, `user_badges` PK, `uq_challenge_progress_credit`; `V25` ledger type/sign/ride checks + unique `promo_compensation` per ride; `GrowthMigrationIntegrationTest` 7 |
| T2 every promo restriction; stacking order; floor at zero | met | `PromoServiceImpl.check` (window, cap, per-user, first-ride, region, service) + `FareCalculator.applyDiscount` (last, clamped); `GrowthIntegrationTest` restrictions / floor / redispatch / scheduled / shared-share tests |
| T2 referral e2e incl. abuse blocks | met | self / phone-ever / too-late / suspension → `blocked`; `GrowthIntegrationTest` referral + freeze tests, `AuthFlowIntegrationTest` registration capture |
| T2 accrual / redemption math; level thresholds unaffected by spending | met | `LoyaltyServiceImpl.redeem` decrements `redeemable` only; simulator asserts level after redeem |
| T2 badge triggers exactly once | partial | sequential exactly-once proven (`GrowthGamificationIntegrationTest`); the concurrent loser aborts the caller's transaction instead of standing down (W2) |
| T2 challenge window edges; early end honors completions | met | `ChallengeRepository.runningAt`, `GrowthGamificationIntegrationTest` edges + early end |
| T3 rider: promo on all four surfaces, referral, loyalty, badges, challenges; flows + exceptions vs mocks | met (promo "discount in estimate" partial, W12) | rider report AC table; `promo-flows`, `promo-surfaces`, `loyalty-screen`, `referral-screen`, `badges-screen`, `challenges-screen` tests |
| T4 driver: badges/levels, challenges with progress | met | `level-screen.tsx`, `challenges-screen.tsx`; 11 tests |
| T4 admin: UC-A-26/28 end-to-end, permission-gated + audited | partial | promo CRUD/deactivate/monitoring and challenge CRUD/participation/early-end built and gated with the backend's own codes; audit snapshots incomplete (H2) |
| T5 scripted scenario passes; all credits traceable in ledgers | met | `GrowthSimulatorIntegrationTest` 3/3 inside the green full gate; every credit read back from `wallet_transactions` / `driver_ledger` / `points_transactions` / `promo_redemptions` and through rider, driver and admin endpoints |
| Milestone: every mechanism pays out exactly once, into the wallet, traceably | met (badge race aside, W2) | referral under `lockByRefereeUserId`, redemption under `lockOrCreate`, challenge under the progress row lock |
| Milestone: promo math correct in the stored breakdown, never recomputed | met, one rare edge | `fares.discount` stored and read back; shared path re-reads the reservation row (W8) |
| Milestone: abuse paths provably blocked | partial | self-referral / reactivation / stacking blocked and tested; member-leave reservation leak (H1), first-ride double reservation (W1), redemption region chosen by the client (W3) |
| Milestone: tracker updated; review audit passed | in progress | this report |

## Critical
None.

## High

**H1 — A shared-ride member who leaves or is marked absent keeps the ride's promo reservation**
Category: correctness · Severity: High · Certainty: High
Location: `backend/src/main/java/com/labby/backend/service/SharedRideServiceImpl.java` (`leave` and the no-show path never touch `promo_redemptions`; the only promo calls are the two `reserve` calls at :189 and :292); `PromoRedemptionRepository.java:34-53` counts by ride state only; `DriverRideServiceImpl.java:300-306` applies the discount over the boarded members only.
Rationale: growth-v1 promises that a cancelled ride releases its reservation and that one promo per ride is first come. When the redeeming member leaves (or is no-showed) and the ride still runs to completion, the reservation row stays alive: it counts against the promo's total cap and the member's per-user limit forever (default limit 1 → the code is burned), `uq_promo_redemptions_ride` blocks every other member from applying a promo on that ride, and at completion nobody is discounted. `deleteByRideId` exists in the repository and is unused — the intended hook was never wired. No test covers a leaving promo holder.
Fix: on `leave` / member `CANCELLED` / `NO_SHOW`, release the member's own reservation when `redemption.userId == member.riderUserId` (delete it or mark it released and exclude released rows from the cap queries), and add a test "joiner with promo leaves → cap freed, another member may apply".

**H2 — Promo and challenge audit snapshots omit editable fields**
Category: security · Severity: High · Certainty: High
Location: `AdminGrowthServiceImpl.java:322-333` `snapshot(Promo)` records code/type/value/window/perUserLimit/firstRideOnly/active; `patchPromo` (:145-163) also edits `regionId`, `serviceTypeId`, `maxDiscount`, `totalCap`. `snapshot(Challenge)` (:335-346) omits `titleAr` and stores `endedAt` as `String.valueOf(null)`.
Rationale: lifting a cap, raising the max discount or unbinding a region — the money-relevant knobs — produces an audit row whose before/after are identical, so T4's "audited" criterion is not met for the edits that matter.
Fix: include every editable field in both snapshots; store `endedAt` as an Instant/null.

## Warning

**W1 — A rider can hold two first-ride reservations** · srs-conformance · Medium · `PromoServiceImpl.java:152` (flag checked only at validate/reserve), `applyAtCompletion` :97-109 unconditional; scheduled rides are not the rider's active ride. A new rider schedules with first-ride promo A and books on-demand with first-ride promo B while `riderCompletedCount == 0`; both complete discounted. Owner ruling needed; fix = one alive first-ride reservation per user at reservation time.

**W2 — Badge / referral-code race loser aborts the caller's transaction** · correctness · Medium · `GrowthServiceImpl.award` :215-229 and `ReferralServiceImpl.codeOf` :152-161 catch `DataIntegrityViolationException` from `saveAndFlush` and continue. The exception crosses the repository proxy inside the enclosing ride-completion or rating transaction, which is then rollback-only (and already aborted on PostgreSQL), so the next statement fails and the caller's `complete` / rating returns 500. Realistic trigger: two riders rating the same driver at the same moment both completing a 5-star week. Fix: native `INSERT … ON CONFLICT DO NOTHING` returning the row count (the pattern `points_accounts` / `challenge_progress` already use).

**W3 — Loyalty redemption currency and rate are chosen by the client** · srs-conformance · Medium · `LoyaltyController.java:69-75`, `LoyaltyServiceImpl.redeem`. Points are one currency-less balance per user; SRS GRW-04 defines threshold/rate per region. A rider who earned points in region A can redeem in whichever region has the richest rate or currency. Owner ruling (moot if every deployment is single-currency); fix = derive the region from the rider's operating/home region.

**W4 — Driver challenge points become redeemable rider wallet credit** · srs-conformance · Medium · `GrowthServiceImpl.addPoints` :275-288 credits CHALLENGE points to `redeemable` for every role; `LoyaltyServiceImpl.redeem` gates only on the rider role, which every account holds. GAME-03 says driver points feed levels; GRW-04 redemption is "Loyalty (riders)". Owner ruling; otherwise credit driver-role challenge points to `lifetime` only.

**W5 — Code defaults diverge from the SRS and an unconfigured region marks referrals `rewarded` while paying nothing** · srs-conformance · Medium · `GrowthRules.java` defaults referral 0/0, threshold 10,000, 0.02/pt vs SRS GRW-03 "defaults 5 + 5" and GRW-04 "100 pts → 5 credit"; `GrowthServiceImpl.credit` :184-187 returns silently when the amount is 0 while `rewardReferral` still sets `REWARDED` and skips the notification. The tracker records the loyalty defaults as owner-acknowledged; the referral row reading "rewarded" with no credit is not. Owner ruling: seed 5/5, or keep the row `pending` with a reason when the amount is 0, and amend the SRS rows to the per-region model.

**W6 — Admin promo counters include released reservations and estimate-based amounts** · integration · High · `AdminGrowthServiceImpl.java:293-294` → `countByPromoId` / `redeemedAmount` (`PromoRedemptionRepository.java:21, 56-57`) sum every row, including cancelled / no-driver rides and not-yet-completed reservations whose `amount` is still the booking estimate, while growth-v1 says "Sum of applied discounts". Fix: reuse the live-ride join for the count and sum only rows whose ride is completed.

**W7 — A percent promo above 100 is not validated server-side** · correctness · High · `SavePromoRequestDto.java` (`value` only `> 0`), `AdminGrowthServiceImpl.createPromo` (no check); the V24 `ck_promos_percent` CHECK then fails as an unhandled integrity error (500). The admin form's HTML `max=100` is the only guard. Fix: validate `type == percent → value ≤ 100` in the service (422 `value_invalid`).

**W8 — Shared completion derives the member discount from the reservation row even when the applied discount rounded to zero** · correctness · High (rare) · `PromoServiceImpl.applyAtCompletion` :104-107 updates `amount` only when `discount > 0`; `RideMoneyServiceImpl.applySharedAtCompletion` :121-127 then uses `redemption.getAmount()` (the booking estimate) as the member discount → phantom `promo_compensation` and commission on an inflated base. Triggers only when `discount()` rounds to 0.00. Fix: pass the discounts computed in `DriverRideServiceImpl` :300-306 into the money service, or persist 0.

**W9 — A promo refused at booking stays applied on the surface** · integration · High · rider `booking-screen.tsx:459-461`, `schedule-screen.tsx:180`, `shared-create-screen.tsx:180`, `shared-ride-screen.tsx:412`: a `promo_*` refusal only sets the error banner; the promo state and chip remain and the next tap re-sends the dead code. UC-R-04 A1 says "booking continues without it". Fix: clear the promo on a promo-coded refusal and show the reason on the row.

**W10 — Rider loyalty and challenges hang on the loading view without a region** · integration · High · `loyalty-screen.tsx:124-125,150`, `challenges-screen.tsx:150-151,175`: `if (!regionId) return;` with region status `outside` / `permissionDenied` / `error` leaves the data null forever, no retry, no copy (home and shared-browse branch on `region.status`). Fix: render the region-blocked copy / error view with `region.retry`.

**W11 — Rider earnings/level: badge award dates never shown** · srs-conformance · High · driver `level-screen.tsx:97-118`: `awardedAt` is typed and in fixtures but not rendered, while the rider badges screen shows it; UC-S-23 says "earned badges (with award dates)". The approved D13Badges board has no date, so this is a board-vs-UC conflict. Owner ruling: add a muted date caption (tiny board amendment) or record the deviation.

**W12 — Rider promo preview requested but never shown** · srs-conformance · Medium · `promo-row.tsx:238-264`: the app sends `estimateTotal` to `/promos/validate` and discards `discountPreview`; the T3 ticket says "discount in estimate", UC-R-04 step 4 says "promo applied" on the estimate, the approved board R13PromoChoose shows terms only. Owner ruling: show a one-line preview under the chip or stop sending `estimateTotal`.

**W13 — Driver trip card labels are untrue on promo cash rides** · integration · Medium · driver `trip-earnings-screen.tsx:188-192, 237-244`: "Fare · you keep the cash" shows the pre-discount `fareTotal` while the driver pocketed the discounted `cashDue`; the "promo top-up" line reads like a bonus. Numbers are the server's; the labels mislead. Fix: a "Fare before promo" label variant (EN/AR) or a muted "Rider's promo −X" line; one-line board note.

**W14 — Driver challenges flash the empty state before the region resolves** · integration · Medium · `challenges-screen.tsx:213-218`, `onboarding/use-remote.ts:49-56`: with `regionId === null` the loader resolves `[]`, recorded as loaded; when the region resolves the reload runs in refreshing mode over "No challenges right now". Fix: skip the loader until a region exists.

**W15 — Admin promotions page prints the raw currency code in Arabic** · integration · High · `PromosPage.tsx:124-129, 139, 144, 300-304` pass `region.currency` straight to `formatMoney`; every other money page goes through `useCurrencyLabel()` (AR "ل.س"). Fix: use the label hook.

**W16 — Admin new-promo summary shows the English service-type name in Arabic** · integration · High · `PromoCreatePage.tsx:144` uses `nameEn` regardless of language while the select at :400 switches to `nameAr`. Fix: same language switch.

**W17 — Admin "Active promotions" KPI counts scheduled and window-expired promos** · integration · High · `PromosPage.tsx:72-88` queries `?active=true`; `PromoRepository.java:31` filters the flag only; the hint says "running right now". Owner call: reword to "not deactivated", or add a window-aware filter/aggregate (the 7-day aggregates are already deferred).

**W18 — Admin Limits column says "1 ride type" where the approved board names the type** · integration · High · `PromosPage.tsx:158-160` vs A13Promos ("3 / user · Damascus · Economy"); not among the six recorded rulings. Fix: resolve names via `listServiceTypes` for the regions on the page (degrade without `pricing:view`), or record a ruling.

**W19 — Admin challenge detail keeps the End-early panel after a 409 `already_ended`** · integration · Medium · `ChallengeDetailPage.tsx:106-117` only toasts; `endedAt` stays null until reload. Fix: refetch (or apply the 409 as ended).

## Info (max 5)
1. Mess: `PromoRedemptionRepository.deleteByRideId` and `countByPromoIdAndUserId` unused and the class javadoc says non-completing rides "delete theirs", contradicting the live-count design; `GamificationServiceImpl.lifetime()` driver branch unreachable; `NotificationEvent.java:128` comment names a "growth" category that does not exist (renderer uses `PROMOTIONS`).
2. 500s where 4xx is expected: `GamificationController` `RideParty.fromValue` on a bad `as`, `LoyaltyServiceImpl` unknown region (`NoSuchElementException`), `patchPromo` with an unknown `regionId` (FK violation; create validates, patch does not).
3. Admin `PromoCreatePage.tsx:31` maps any 400/422 to the "window is invalid" message; EN footnotes say "Edit promotions / challenges permission" while the Roles checklist says "Manage"; `challenges.goal.*` plurals lack `_one` ("1 rides"); `toIso()` duplicated in two pages; `promos__code` / `promos__footnote` classes have no CSS rule.
4. Rider: the "Add a promo code" row's trailing label reuses `booking.change` ("Change"); challenge cards render `progressLine` twice; redeem sheet shows the threshold unformatted and keeps the stepper value across opens; referral screen fetches `/referrals/me` twice when the region resolves after mount; loyalty history is first page only, no pull-to-refresh on growth screens; `home-screen.tsx:47-48` hardcodes two purples outside the tokens.
5. Driver: catalog vs board badge order; the board's "Done 12 Oct" needs a `myCompletedAt` the contract lacks; AR dual forms "رحلتين" used standalone where "رحلتان" is right; one `noRegion` string covers `outside` / `error`; `earnings-screen.tsx:239` doc comment predates the promo part. Backend: `riderCompletedCount` runs twice per payer completion; no concurrency tests in the growth suites (cap race, redeem double-spend, badge race).
+14 more nitpicks — ask to see them.

## What's good
- The promo money path is clean and DB-backstopped: a pure `FareCalculator.applyDiscount` applies the discount last and clamped, `ck_fares_total` keeps the stored breakdown consistent, commission on the pre-discount fare plus a unique ride-linked `promo_compensation`, dues carried after the discount — all asserted end to end.
- The referral abuse design is solid: in-place reactivation keeps the `user_id`, the phone is captured at entry with phone-ever uniqueness, self-referral is refused in code and by CHECK, the reward is only ever the status transition under `SELECT … FOR UPDATE`, and a suspended party blocks it for good.
- The reservation model (live-ride counting under the promo row lock, carry on retry/redispatch, scheduled reserved at booking) is coherent and tested for cancel-release, redispatch and scheduled execution.
- Admin: permission strings are exactly the backend enum's; every route, nav entry and mutating action is gated and both sides are tested; all HTTP lives in the API layer, pure display logic in `growth-format.ts`; the six T4 rulings are honored to the letter.
- Rider: the contract is mirrored one to one with nullability, every refusal code is mapped, promo state is owned by the surface and sent only at booking, the re-validation effect is keyed on the full context; EN+AR complete with Western digits and LTR isolates; routes are thin; tests assert request bodies and visible outcomes.
- Driver: types mirror the backend records, the level math uses only the server ladder, the T5 earnings amendment adds no arithmetic; EN/AR parity 959/959 keys; no leftovers.

## Pre-existing (out of scope, non-blocking)
- Catch-all `GlobalExceptionHandler` mapping `IllegalArgumentException` / `NoSuchElementException` to 500 predates M13 (Info 2 inherits it).
- Rider `t()` has no plural support, so Arabic counts of 11+ read wrong across all milestones; hardcoded hex colours already exist in chat, wallet and ride views; `formatDate` renders "Oct 12" where boards show "12 Oct".
- Driver `trip-earnings-screen.tsx:246-252` adjusts the shown "Balance change" by the carried-dues pass-through client-side (M12); `onboarding/use-remote.ts` docblock still says "onboarding resource".
- Region `growthSettings` has no admin UI (ruling 4 says admin-editable; same as M12's `scheduledSettings`) — owner decided on 2026-10-18 to leave it API-only and filed it as a follow-up task; W5's zero payout is the production default until a region is configured.

## Test run results
- Full gates at `f382925` (the T5 commit; `15d44d8` is docs only): backend `make check` 608 tests green (format + Checkstyle + unit + Testcontainers + ArchUnit); driver `npm run check` 492 tests / 51 suites green; admin 357 tests / 50 files green; rider 484 tests / 56 suites green. Reviewers did not re-run suites (read-only briefs).
- CI: run 39136873116 on `15d44d8` was in progress at audit time (the run on `f382925` was superseded and cancelled by the docs push); its result is recorded in the tracker when it lands.

---

## Resolution (labby-fix, 2026-10-19)

Owner rulings 2026-10-19 (all nine decided in one batch, lead's recommendation accepted): W1 one alive first-ride reservation per rider; W3 accepted as moot for single-currency V1 and recorded in the growth contract header; W4 driver challenge rewards feed the level only; W5 the SRS defaults (5/5 referral, 100 pts → 5 credit at 0.05/pt) become the code defaults and a 0/0 region leaves the referral `pending`; W11 badge award dates added (board D13Badges amended); W12 the server's discount preview shown under the applied chip (board R13PromoChoose amended); W17 a window-aware `running` filter backs the KPI; W18 the Limits column names the ride type; W13 a muted "Rider's promo" line itemizes the discount on the trip card (board DriverTripEarnings amended).

**Fixed** — every finding of the report, namely:
- H1 `releaseMember` on leave / member cancel / no-show / dispatch-drop / suspension sweep (`SharedRideServiceImpl`, `PromoServiceImpl`), + test (cap freed, another member may apply).
- H2 full before/after snapshots incl. regionId / serviceTypeId / maxDiscount / totalCap / titleAr, `endedAt` as an Instant, + audit round-trip test.
- W1 `countAliveFirstRideReservations` guard at reservation, + test. W2 badge awards and referral codes via `INSERT … ON CONFLICT DO NOTHING`. W4 level-only driver challenge credits, + redeemable-is-zero assertion. W5 new defaults + pending-when-unpaid, + test; regions-v1/growth-v1 notes amended (SRS rows already said 5+5 and 100→5). W6 live-ride count + completed-rides `appliedAmount` in the admin counters. W7 percent ≤ 100 → 422 `value_invalid`, + test. W8 shared completion passes the actually-applied discounts into the money service. W17 `running` param through repository → service → controller → contract, + filter test.
- W9 all four rider surfaces drop a booking-refused promo and explain it on the row (tests updated per the approved behavior change). W10 loyalty + challenges render the region-blocked copy with retry, + tests. W12 preview line, + test. Rider Info 4: "Add" label, duplicate progress line dropped, redeem sheet threshold formatted + stepper reset, referral single fetch (test now asserts one call).
- W11 earned-date captions, + test. W13 "Rider's promo −X" line, + test. W14 the driver challenges loader never records [] as data before a region exists, + no-flash guard test. Driver Info 5 doc comment.
- W15 currency label hook on the promos page. W16 language-aware ride-type name in the summary. W18 ride-type names in Limits (pricing:view-gated, degrades), + tests. W19 `already_ended` refetches so the panel closes, + assertion. Admin Info 3: only `window_invalid` maps to the window message, "Manage …" footnotes, `_one`/Arabic plural goal keys, `toIso` hoisted, the two CSS rules added.
- Backend Info: unused repository methods removed, stale javadoc/comments fixed, 400 for a bad `as`, 404 `region_not_found` for an unknown loyalty region, patch validates an unknown promo region, `riderCompletedCount` computed once per completion.

**Deferred (recorded, non-blocking)** — growth-suite concurrency tests; rider pull-to-refresh + loyalty history paging; rider home-card hardcoded purples (pre-existing pattern); Arabic dual forms standalone; driver badge ordering vs board; `myCompletedAt` missing from `ChallengeView` (board's "Done {date}" stays dropped); `GamificationServiceImpl.lifetime` driver-branch reachability claim (not verified, left as is).

Verification: targeted suites green during the round; full gates re-run after (results recorded in the tracker with the re-audit).

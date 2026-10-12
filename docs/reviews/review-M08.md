# Review — M8 Money milestone audit (`a4cda68..00ad16b`)
_8 commits · 193 files · reviewed 2026-10-12_

Audit ticket M8-T7. Five independent review agents covered separate areas: backend money core, backend extras/REST/RBAC, rider app, driver app and admin app. Their findings were merged and de-duplicated here. Every High finding was then re-checked against the live code before inclusion.

## Summary
M8 delivers a solid money foundation:
- the three ledgers are append-only with sign/type CHECKs and partial unique indexes;
- every balance write locks its balance row;
- rounding is HALF_UP and centralized;
- tips are race-safe;
- grants, refunds and settlements are permission-gated and audited.

Floor block → settlement → unblock is proven on the controlled clock, and the T6 sweep shows every ledger line is traceable.

The audit still finds **5 High** issues. One is an admin regression that can block almost every driver: saving a region resets the floor. Two are in rider dues: currency isolation, and cash dues booked before any cash is confirmed. The last two are client defects: there is no in-ride tip, and the driver Balance shows the wrong amount for mixed rides.

The milestone ACs "every monetary event … linked ledger entry" and "extras … itemized everywhere" are only partially met. Three of the Highs need an owner ruling before they can be fixed.

**Verdict:** Fail
**Findings:** Critical 0 · High 5 · Warning 20 · Info 5 (+ nitpicks) · Praise 6

## Acceptance criteria

### Milestone
| Criterion | Status | Evidence |
|---|---|---|
| Every monetary event lands as an immutable, typed, linked ledger entry; balances always equal their ledger sums | **Partial** | Holds for sequential flows: V12 triggers + CHECKs, `assertLedgerInvariants`, T6 traceability sweep. Broken by cross-currency dues (H2) and by cash dues booked without confirmation and never reversed (H3). Concurrency untested (W4). |
| Floor blocking and settlement provably work on a controlled clock | Met | `FloorIntegrationTest`, `MoneySimulatorIntegrationTest.shouldBlockAtFloorAndUnblockOnSettlement` |
| All extras charge exactly per region config and appear itemized everywhere | **Partial** | Tests can't tell region values from SRS defaults (W9). Carried fees are invisible or blended (W6). A region save wipes the floor (H1). Receipt wait/pickup lines lack units (known). |
| Tracker updated; review audit passed | Pending | This audit: Fail |

### Tickets
| Ticket AC | Status | Evidence |
|---|---|---|
| T1: append-only, balance derivable, migrations clean | Met | V12 triggers; `MoneyMigrationIntegrationTest`. V12 backfill SQL assessed correct (`V12__money.sql:233-236`) but untested (W4). |
| T2: PAY/COM rows incl. mixed math, tip expiry, tier boundaries, floor, debt, invariants, exact decimal | Partial | All named tests exist and pass. paid_wallet + cash-due path is wrong and untested (H3). Currency isolation broken (H2). Invariants are property-tested on primitive operations only (W4). |
| T3: rider wallet, payment choice, tips, wait notice, pickup disclosure, fee display | Partial | No in-ride tip (H4). Cancel-sheet copy is wrong for wallet rides (W10). Gate 245/245. |
| T4: driver earnings, tier, balance, floor states | Partial | Mixed-ride Balance amount is wrong (H5). Gate 307/307. |
| T5: admin grants/refunds/settlements, permission-gated, audited | Met (with W19/W20) | Gate 219/219. "From ride detail" is N/A (admin Rides screen deferred to M10-T4 by M7 ruling). |
| T6: scripted scenarios pass, every ledger line traceable | Met | `MoneySimulatorIntegrationTest` (4 tests); see Info-2 for an assertion to tighten |

## Critical
None.

## High

### H1 — Saving a region from the dashboard resets the driver balance floor to −50
- **Category:** integration
- **Severity:** High
- **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/service/RegionServiceImpl.java:238`; `apps/admin/src/pages/regions/BundleForm.tsx:169-213`
- **Rationale:**
  - `setDriverBalanceFloor(request.driverBalanceFloor())` runs on every save, with no condition.
  - The PUT is a full replace (`regions-v1.yaml:88`), but the dashboard never sends `driverBalanceFloor`. No file under `apps/` references it.
  - So any dashboard edit of a region stores NULL, which means the SRS default −50.
  - For a Damascus region with a floor of −500,000 SYP, that instantly blocks every driver with any cash-commission debt (`DriverDutyGatesImpl`).
  - This is the same class of bug as the M7 W1 timeZone fix (`RegionServiceImpl.timeZone`, line ~211), and it was not applied to the new field.
  - The T6 test does not catch it, because its `updateRegion` starts from the admin GET.
- **Fix Suggestion:**
  - Treat the field like `timeZone`: omitted keeps the stored value.
  - Amend regions-v1 to say so.
  - Add an integration test: a PUT without the field keeps the floor.
  - A dashboard floor field is a separate design-first owner call.

### H2 — Rider dues are collected regardless of currency (PAY-01 currency isolation)
- **Category:** correctness
- **Severity:** High
- **Certainty:** High
- **Location:**
  - `backend/src/main/java/com/labby/backend/repository/RiderDueRepository.java:20-25`: `lockPending` has no currency filter.
  - `RideMoneyServiceImpl.java:115-146` (`collectDues`) and `:262-269` (`rideMoney`).
- **Rationale:**
  - Example: a USD due is collected on a SYP ride.
  - The SYP driver gets a USD `due_collection` debit, which the floor never checks.
  - `cashDue` adds the USD amount to the SYP fare as one number, shown on the receipt and in the completion push.
  - On wallet rides, a cross-currency due's wallet `balance()` read (`:120-122`) takes no lock. A concurrent tip can then make the debit 409 and roll back the whole completion.
- **Fix Suggestion:**
  - Use `lockPending(riderUserId, ride.getCurrency())`; dues in other currencies stay pending until a ride in a matching-currency region.
  - Add a USD-due / SYP-ride test.
  - **Owner ruling needed:** this narrows ruling (1), "collected on the rider's next completed ride".

### H3 — Cash dues are booked as collected at completion, with no cash confirmation and no reversal
- **Category:** correctness
- **Severity:** High
- **Certainty:** High
- **Location:** `RideMoneyServiceImpl.java:73-79` and `:131-145`; `DriverRideServiceImpl.java:298-305` and `:394-414`
- **Rationale:** Two cases.
  - **(a) Wallet covers the fare but not the due.**
    - The ride becomes `paid_wallet` and auto-confirms.
    - The due is still collected "in cash": the driver gets a `due_collection` debit, `cashDue` > 0 is shown, and the rider is told to pay cash.
    - The driver cannot cash-confirm or mark the ride unpaid (both return 409 `payment_not_pending`), so a refusal cannot be reported.
    - Untested: `CancellationFeeIntegrationTest` always funds fare + due.
  - **(b) Cash or mixed ride later marked unpaid.**
    - The `due_collection` debit stays.
    - The due stays `collected`.
    - The cancelled ride's driver keeps the credit.
    - The collecting driver silently pays the rider's fee, and the rider's receivable disappears.
- **Fix Suggestion:**
  - Keep `paymentStatus = pending` whenever `cashDue > 0` (`PAID_WALLET` only when nothing is owed in cash).
  - Then either defer due collection to cash-confirm, or on mark-unpaid post counter-entries (append-only) and open a new pending due.
  - Add a test for each path; amend the money-v1 contract.
  - **Owner ruling needed** on which of the two.

### H4 — The rider cannot tip during the ride (PAY-04, UC-R-08)
- **Category:** srs-conformance
- **Severity:** High
- **Certainty:** High
- **Location:** `apps/rider/src/screens/ride/ride-view.tsx:190-191` and `:263-292` (completed view only); `receipt-screen.tsx:109-110`
- **Rationale:**
  - PAY-04 says "during ride or ≤ 24 h after".
  - The backend accepts IN_PROGRESS tips (`RideMoneyServiceImpl.java:210-220`).
  - `TipSheet` already supports `completedAt = null`, but it is mounted only on the completed view and the receipt. The in-progress sheet has no tip action.
- **Fix Suggestion:**
  - Add a "Tip {name}" secondary action to the `in_progress` sheet, mounting `TipSheet` with `completedAt={null}` and hidden once tipped.
  - Add a test.
  - If the approved artboard deliberately omitted it, amend the SRS instead (owner).

### H5 — Driver Balance shows the wrong amount for mixed-payment rides
- **Category:** correctness
- **Severity:** High
- **Certainty:** High
- **Location:** `apps/driver/src/components/money/balance-screen.tsx:74-83`
- **Rationale:**
  - Every wallet-method row renders `fareTotal − commissionAmount`, always as a credit.
  - The backend posts one netted entry, `walletApplied − commission`, which is a debit when negative.
  - Example: fare 28,000, wallet 10,000, commission 7,000. The ledger shows +3,000; the app shows +21,000.
  - The test covers only a fully wallet-paid fixture (`balance-screen.test.tsx:130-154`).
- **Fix Suggestion:**
  - Render the server's `net` (minus tip), signed and coloured by its sign.
  - Add a mixed-ride fixture test.

## Warning

**Backend**

- **W1 — Commission falls back to the base tier from the region's Monday until the weekly job runs; if a run is missed, for the whole week.**
  - Category: correctness · Certainty: High
  - Location: `CommissionServiceImpl.java:43-49` and `:63-68`; `CommissionRecalcJob.java:19` (no `zone=`)
  - Rationale: Top-tier drivers are overcharged in that window, and the ledger is immutable. `status()` can report "120 trips last week · 25%".
  - Fix: make `ratePercent` compute lazily and `insertIfAbsent` when a row is missing (the job becomes a pre-warm). Add `zone = "${labby.onboarding.timezone}"`.
- **W2 — Lock-order deadlock between two concurrent completions that each collect a due owed to the other's driver.**
  - Category: performance/concurrency · Certainty: Medium
  - Location: `RideMoneyServiceImpl.java:78`, `:145`, `:155`; `DriverLedgerServiceImpl.java:30-39`
  - Rationale: Locks are taken X→Y in one completion and Y→X in the other. Postgres aborts one; there is no corruption, but the request fails.
  - Fix: lock all involved balance rows in user-id order, or retry once on a lock failure.
- **W3 — First-ever balance row is created find-then-insert, so two concurrent first postings can hit a primary-key violation.**
  - Category: concurrency · Certainty: Medium
  - Location: `DriverLedgerServiceImpl.java:30-39`; `WalletServiceImpl.java:168-175`
  - Fix: `INSERT … ON CONFLICT DO NOTHING`, then `findForUpdate`.
- **W4 — No concurrency tests (T7 asks about completion vs tip), and the V12 dues backfill is untested.**
  - Category: tests · Certainty: High
  - Rationale: No latch/executor appears in any money test. `LedgerInvariantIntegrationTest` never drives rides, tips or dues. The backfill SQL itself is correct: V10 checks guarantee fee > 0 and a cancelled state, there is one due per ride, and every M7 fee was cash-method.
  - Fix:
    1. **Backfill test:** in a scratch database, run Flyway `target("11")`, then seed:
       - `cancelled_by_rider` with a 2.00 fee;
       - `cancelled_by_driver` / `rider_no_show` with a 2.00 fee;
       - a cancelled ride with no fee;
       - a completed ride.

       Then run `target("12")` and assert exactly 2 pending dues with the right amount, currency, rider and source ride.
    2. **Concurrency test:** use a `CountDownLatch` for tip vs complete on an in_progress ride, tip vs tip, and settlement vs cash completion. Then run `assertLedgerInvariants()` and check that the `balance_after` chains are consistent.
- **W5 — `GET /driver/earnings/summary?period=<bad>` returns 500 (no `ConstraintViolationException` handler), and the endpoint has no tests.**
  - Category: tests/correctness · Certainty: High
  - Location: `DriverEarningsController.java:23`, `:57`; `GlobalExceptionHandler.java`
  - Fix: bind `period` to an enum, or map `ConstraintViolationException` to 400. Add tests for weekly, monthly, anchor, 404 when there is no region, and 400.
- **W6 — Carried fees are not itemized on the ride that collected them.**
  - Category: srs-conformance (milestone AC) · Certainty: High
  - Location: `RideMoneyServiceImpl.java:125-130`, `:255-266`; `apps/driver/.../trip-earnings-screen.tsx:104-106`; `complete-screen.tsx:130-133`, `:207-218`
  - Rationale:
    - A wallet-collected due is linked to the *source* ride, so the collecting ride's view, receipt and push show only the fare while the wallet dropped by fare + fee.
    - On cash, the fee is blended into `cashDue` with no line of its own.
    - The driver's "Collected in cash" shows `fareTotal`, and Complete has no carried-fee line.
  - Fix: add an itemized `collectedDues[]` (dueId, sourceRideId, amount, method) to RideDto and the receipt (rides-v1 amendment). Render it in both apps. This also closes the known "receipt carried-fee line derived from cashDue" item.
- **W7 — Currencies are not validated on grants, refunds and settlements.**
  - Category: correctness · Certainty: High
  - Location: `AdminMoneyServiceImpl.java:77-102`, `:148-178`; DTOs only check `^[A-Z]{3}$`
  - Rationale: An admin can make a "XYZ" grant, refund a SYP ride with USD, or record a settlement in a currency the driver doesn't hold.
  - Fix:
    - Refund currency must equal the ride's currency.
    - Grant and settlement currencies must be one used by a region; for settlements, a currency the driver holds or the operating region's.
    - Return 400 and add tests.
- **W8 — Server-rendered money pushes use raw `toPlainString()` amounts.**
  - Category: srs-conformance (NFR-I2) · Certainty: Medium
  - Location: `NotificationRenderer.java:251-327`
  - Rationale: Amounts show as "-500000.00 SYP": no grouping, decimals on SYP, and the ISO code in Arabic instead of "ل.س".
  - Fix: add a per-currency/per-language money formatter in the renderer. The AR label needs owner sign-off.
- **W9 — Extras tests can't distinguish region config from SRS defaults.**
  - Category: tests · Certainty: High
  - Rationale:
    - The fixture region equals the defaults (`AbstractRideIntegrationTest.java:70-75` vs `RideExtrasCalculator.java:191-195`).
    - `RideExtrasCalculator` has no unit test.
    - `FareCalculatorTest` doesn't cover the new extras arguments.
    - RBAC tests never prove the `wallets:view` vs `wallets:manage` split.
  - Fix:
    - One extras scenario on a region with non-default values.
    - A `RideExtrasCalculatorTest`.
    - A `FareCalculatorTest` extras case.
    - A test where a view-only role gets 200 on GET and 403 on POST `/credits`.

**Rider app**

- **W10 — The cancel sheet always says the fee "will be added to your next ride".**
  - Category: correctness/copy · Certainty: High
  - Location: `apps/rider/src/screens/ride/cancel-sheet.tsx:139-149`
  - Rationale: Wallet-method rides are debited immediately; only the shortfall is carried.
  - Fix: branch on `paymentMethod` with new EN/AR copy (owner proofread) and add a test.
- **W11 — Float math on amounts produces a phantom "carried fee 0" line on many 2-dp mixed amounts.**
  - Category: correctness · Certainty: High
  - Location: `ride-view.tsx:150-151`; `receipt-screen.tsx:105-106`
  - Rationale: Integer SYP mocks hide it.
  - Fix: use integer minor units, or the itemized dues from W6.
- **W12 — Custom tip parsing.**
  - Category: correctness/i18n · Certainty: High
  - Location: `apps/rider/src/screens/wallet/tip-sheet.tsx:85-91`
  - Rationale: "5,000" becomes 5. Arabic-Indic digits give NaN. "٫" is not accepted as a decimal mark. More than 2 decimals gets a generic error.
  - Fix: normalise digits and separators, cap at 2 decimals, and add tests.
- **W13 — Suggested tips `[2000, 5000, 10000]` are SYP-scale for every currency.**
  - Category: correctness · Certainty: High
  - Location: `tip-sheet.tsx:29`, `:61`
  - Fix: key the suggestions by currency, or make them region config. Owner call.

**Driver app**

- **W14 — Next-tier copy and progress are off by one against the strict `>` threshold.**
  - Category: correctness · Certainty: High
  - Location: `apps/driver/.../earnings-screen.tsx:180`, `:196-198`; `en.json:652` vs `CommissionPolicy.java:69`, `:96`
  - Rationale: At 100 trips the bar is full and the copy says "Finish 100+", but the driver needs 101.
  - Fix: show `weeklyTripsAbove + 1`.
- **W15 — Earnings for a driver with no operating region (404) shows a server-error card whose Retry can never succeed.**
  - Category: correctness · Certainty: High
  - Location: `earnings-screen.tsx:297-308`, `:374-380`
  - Fix: show an empty state on 404 and add a test.
- **W16 — GO is disabled when blocked; UC-D-04 E2 says the toggle stays allowed and only offers stop.**
  - Category: srs-conformance · Certainty: Medium
  - Location: `home-screen.tsx:198-199`, `:228`; `availability-sheet.tsx:88`; `DriverMoneyProvider.tsx:40-46`, `:125-134`
  - Rationale:
    - The gate uses the worst status across all currencies, while dispatch checks only the operating currency.
    - An offline blocked driver never re-reads balance after an unblock push.
  - Fix: owner ruling (artboard vs UC). Gate on the operating currency, and refresh balance and availability on a `driver.balance_*` push.
- **W17 — Fee-only earning rows render phantom "fare 0 · commission −0" lines, and test fixtures are not contract-shaped.**
  - Category: tests/correctness · Certainty: High
  - Location: `earnings-screen.tsx:223-241`; `balance-screen.tsx:65-84`; `balance-screen.test.tsx:35`
  - Rationale: The backend sends a fee credit as its own row (`DriverEarningsServiceImpl.java:98-110`).
  - Fix: branch on fee-only rows, and fix the fixtures (also `cashDue: 0` vs the server's `null`).
- **W18 — New money screens use plain `"ar"` formatters for times, dates, distances and minutes.**
  - Category: srs-conformance (Western-digits ruling) · Certainty: Medium
  - Location: `trip-earnings-screen.tsx:110-111`; `earnings-screen.tsx:244`; `balance-screen.tsx:58-59`
  - Rationale: Hermes on older ICU can render Arabic-Indic digits.
  - Fix: use `ar-u-nu-latn` there, or do the small M7 formatter retrofit now.

**Admin app**

- **W19 — The grant/refund ride picker lists rides where the user was the *driver*; the backend rejects those with a generic 400.**
  - Category: integration · Certainty: High
  - Location: `apps/admin/src/pages/UserWalletPage.tsx:107`; `GrantRefundPanel.tsx:165-177` vs `AdminMoneyServiceImpl.java:87-92`
  - Fix: filter to `riderUserId === userId` and add a mixed-role fixture test.
- **W20 — The ride picker shows only the 50 newest rides, with no ride-ID fallback when `rides:view` is held.**
  - Category: correctness · Certainty: High
  - Location: `apps/admin/src/api/rides.ts:78`; `GrantRefundPanel.tsx:165-186`
  - Fix: offer "enter ride ID" alongside the select (the `isUuid` path exists), or page the list.

## Info (max 5)

1. **Contract drift on tip errors** (`backend/docs/api/money-v1.yaml`).
   - The tip 409s carry machine codes (`tip_window_closed`, `already_tipped`, `not_tippable`, `insufficient_balance`), but the contract still says "distinct plain messages".
   - The rider app classifies them by regex (`apps/rider/src/api/wallet.ts:119-131`), and its tests use invented messages.
   - Fix: document the codes, switch on `code` first, and test with the real code/message pairs.
2. **The T6 assertion `cashDue` = 0 is vacuous** (`MoneySimulatorIntegrationTest.java:81`).
   - The API returns `null` for a fully wallet-paid ride, and `NullNode.decimalValue()` is 0, so the assertion passes whatever is returned.
   - Fix: assert `isNull()`. The `assertFareEntry` Javadoc also says "cash ride" though it handles wallet rides too.
3. **Unindexed outbox lookup on every 5 s monitor tick** for each ride waiting past the grace (`NotificationOutboxRepository.java:71-78`, `params->>'rideId'`).
   - Fix: add a partial expression index or a `rides.wait_notice_sent_at` column. This adds to the known monitor scale note.
4. **The rider wait preview under-states the charge.** It shows `floor(minutes) × rate` (`ride-view.tsx:456-458`), while the backend prorates per second (`RideExtrasCalculator.java:51-57`).
5. **Ledger immutability relies on the database only.** Entities are not `@Immutable`, repositories inherit `delete*`, and the triggers don't block TRUNCATE. Separately, backfilled dues get `created_at = now()` rather than `cancelled_at` (`V12__money.sql:233-236`).

+14 more nitpicks — ask to see them. They include:
- admin minus-sign/LRM handling and an amount parser that accepts `0x10`;
- the admin dues hint shows the oldest due on every currency tile;
- unreachable `cashConfirmed` in the driver app, and a "missing" state with no retry;
- driver fetch races and the "1 trips" plural;
- raw hex colours outside the tokens in the rider app;
- duplicated wait-grace defaults;
- a `paid_mixed` status with 0 wallet applied.

## What's good
- **Ledger schema:** sign-by-type CHECKs, itemization exactly on fare entries, partial unique indexes (one fare, tip and fee entry per ride; one `due_collection` per due), and append-only triggers on all three ledgers.
- **Locking:** every balance write takes `FOR UPDATE` on the balance row in the same transaction as its entry. Tips lock the ride, then check, with a unique index as backstop. The checked cycles (tip vs completion, settlement vs posting, double tip) are safe.
- **Rounding and tiers:** HALF_UP is centralized and tested with exact amounts. The weekly recalc is idempotent, with tier boundaries 99/100/101 and 199/200/201 tested.
- **Wait-charge notice:** runs under the per-ride lock with the outbox as a once-only guard, and is proven once across repeated ticks.
- **Admin RBAC:** the dashboard's gating mirrors the backend `@PreAuthorize` exactly (`wallets:*`, `settlements:*`), and the shared `PermissionCode` union is extended.
- **i18n:** the Western-digits ruling is applied with `-u-nu-latn` in all three apps, amounts sit in LTR isolates, and "ل.س" is used. EN/AR key parity is enforced by tests.
- **Driver blocked state:** the blocked card is unmistakable, and the T6 traceability sweep is a strong guard.

## Pre-existing (out of scope, non-blocking)
- `RideDispatchServiceImpl.java:143-147`: `nearby_only` gets no distance cap when the region threshold is null. This is unreachable for active regions today.
- The M7 `RIDE_COMPLETED` push already used plain-string amounts (the root of W8).
- MapStruct is barely used (only `util/UserMapper`), against PROJECT-STRUCTURE's mapper convention.
- UC-R-04 A3 asks for a pickup-fee *range* before confirming; the M7 estimate gives only the rule.

## Test run results
- Backend `make check` (lint + unit + ArchUnit + Testcontainers) on the M8 tree: **356 tests, 0 failures**, BUILD SUCCESS.
- CI run 38264796182 on `00ad16b`: **success**, all four jobs (backend, rider, driver, admin).
- Rider `npm run check`: lint, tsc and jest **245/245** green (re-run by the rider auditor).
- Driver `npm run check`: **307/307** green. Only existing console noise (the i18next banner and an `act()` warning from vector-icons).
- Admin `npm run check`: lint, format, tsc and **219/219** green.

## Resolution (labby-fix, 2026-10-12)
Owner rulings 2026-10-12:
- **H2:** only dues in the ride's currency are carried.
- **H3:** a ride stays `pending` whenever cash is owed. Cash dues are earmarked at completion (V13 `rider_dues.collecting_ride_id`) and collected at cash-confirm; mark-unpaid releases them.
- **W16:** follow UC-D-04 E2. GO stays enabled when blocked, the gate checks the operating currency, and an unblock push refreshes.
- **W13:** suggested tips are set per currency in code.
- **W8:** server push money formatter (AR "ل.س").
- **H4:** the in-ride tip button needs no artboard. The driver carried-fee and empty-state lines need no artboard either.
- Admin keeps showing the English-only server 400 message under the localized banner.

**Fixed:** H1–H5, W1–W20, I1–I4.
- **I3:** V13 outbox index.
- **W4:** backfill migration test plus concurrency test.
- **W6:** `carriedDues` added to the ride, the receipt and the driver Trip earnings.

**Not fixed (by decision):** I5 (immutability is DB-only, and V12 is already applied) and the nitpicks outside touched lines.

**Gates on the combined tree:** backend 385 · rider 284 · driver 323 · admin 229, all green. Run one at a time: four parallel suites time out on the laptop.

**Next:** `/labby-review` re-audit of the fix range.

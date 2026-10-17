# Review — M12 Scheduled & shared rides (`01167b4..2e99bb8`)
_12 commits after the M11 pass (`7dc370b`) · 237 files · reviewed 2026-10-17_

## Summary
M12 delivers scheduled rides (booking, claim board, availability windows, reminders, conversion, fallback) and public shared rides (create/browse/join/leave, dispatch triggers, per-seat split, per-member money, trust and chat) across the backend and all three apps. Every gate is green and the core race and clock design holds up: every writer locks the ride row first, the clock job runs one transaction per row with SKIP LOCKED, the last-seat race is safe, the split is exact and money settles per member with correct lock ordering.

The audit found **five High defects**, verified at the cited lines:
- A claimed driver can end up on two live rides.
- A gathering member (the creator in particular) can book another ride, which later breaks the shared ride's dispatch.
- A creator who leaves after dispatch stays bound to the group's ride.
- In the driver app, the per-member rating prompt carries the previous member's score over.
- In the driver app, a chat push from one member is muted while another member's thread is open.

**Verdict:** Fail
**Findings:** Critical 0 · High 5 · Warning 13 · Info 5 (+9 more) · Praise 4

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| T1 state rules documented (claim races, last-seat races); migrations clean | met | `scheduled-shared-v1.yaml` race table; `ScheduledSharedMigrationIntegrationTest` |
| T2 booking with future time, past / too-near rejected | met | `ScheduledRideServiceImpl.java:72-79`; `shouldScheduleWithMinimumLeadAndNoSurge` |
| T2 board query (windows × region × service type) | met | `ScheduledRideRepository.java:35-75`; `shouldFilterBoardByWindowsAndLead` |
| T2 claim (race-safe) / release (metric fed) | met | `ClaimBoardServiceImpl.java:276-343`; `shouldLetExactlyOneDriverWinTheClaimRace` |
| T2 reminders 24 h + 1 h both parties; fallback T−15; conversion to `accepted` | met (conversion: see H1) | `ScheduledRideClockServiceImpl`; reminder / fallback / conversion tests |
| T2 shared create, browse, join (seat-race-safe), leave, creator cancel, dispatch triggers, capacity-aware dispatch | met (see H2) | `SharedRideServiceImpl`; `shouldLetExactlyOneJoinerTakeTheLastSeats`, `shouldResolveLeaveAtTheDispatchMoment` |
| T2 completion per seat: own payment, own receipt, own rating | partial | money, receipt, tips, ratings per member ✓; rider history shows group numbers (W1) |
| T2 test ACs (claim race, last-seat race, fallback timing, reminders, per-seat math incl. mixed methods + no-show, leave at dispatch) | met | `ScheduledRideIntegrationTest`, `SharedRideIntegrationTest`, `SharedRideMoneyIntegrationTest` |
| T3 rider UC-R-10…15 + exceptions, tests green | met | rider review; 452 tests green |
| T4 driver UC-D-05 + UC-D-11…13 + exceptions, tests green | met | driver review; 477 tests green |
| T5 scripted e2e scenarios, every member's ledger/receipt correct | met | `ScheduledSharedSimulatorIntegrationTest` (4 scenarios, `assertLedgerInvariants`) |
| M: scheduled claimable, reminded, fallback-protected on a controlled clock | met | above |
| M: shared rides enforce seats, split exactly, settle each member independently | partial | H2, H3 |
| M: all races (claim, last seat) provably safe | partial | claim and last-seat races safe; conversion vs open live offer is not (H1); one-membership-per-rider has no DB guard (W12) |

## High

**H1 — A claimed driver can be bound to two live rides**
- correctness · Certainty High
- Location: `backend/.../ScheduledRideClockServiceImpl.java:237-252`, `DriverRideServiceImpl.java:109-127`
- Rationale:
  - `driverAvailable` treats the claimer as free when they have no ASSIGNED ride (`DriverDutyGatesImpl.hasActiveRide`), but ignores an open live offer.
  - A claimer who is online just before T−15 is a normal dispatch candidate. Conversion can bind them while they hold an offer.
  - `accept()` never checks that the driver is free, and no DB index enforces "one assigned ride per driver".
- Fix:
  - At conversion, withdraw the claimer's open offer (or count it as busy — owner call).
  - Make `accept()` refuse when the driver already has an assigned ride.
  - Consider a partial unique index `rides(driver_user_id) WHERE state IN ('accepted','driver_arrived','in_progress')`.
  - Test: claimer holding an offer at T−15.

**H2 — A gathering member can book a live ride; the shared dispatch then fails**
- correctness · Certainty High
- Location: `RiderRideServiceImpl.java:369-373`, `SharedRideMemberRepository.java:53-62`, `SharedRideServiceImpl.java` `dispatch()`
- Rationale:
  - The booking check ignores `gathering` memberships, so a creator can book on-demand (or have a scheduled ride convert) while their shared ride gathers.
  - At dispatch the creator's ride row goes to `requested` and violates `uq_rides_rider_active` (V10:125).
  - The joiner's `join` / creator's `start` return an unmapped 500, and the clock `step` fails every tick (`log.warn`). The timed ride stays `gathering` and joinable past its departure, and stuck rows head `findDue` and can starve the batch.
  - A non-creator member simply ends up on two live rides.
- Fix (behaviour needs an owner ruling): block booking / conversion while the rider holds a gathering membership, or handle the member at dispatch like `rider_busy` (drop the member; cancel the group if it is the creator). Catch the constraint violation in dispatch.

**H3 — A creator who leaves or no-shows after dispatch stays bound to the group's ride**
- correctness · Certainty High
- Location: `RiderRideServiceImpl.java:158-165` (`active`), `:369` (booking), `SharedRideServiceImpl` `requireFree`
- Rationale:
  - `rides.rider_user_id` stays the creator. Their `/rides/active` keeps returning the ride they left, and `POST /rides` and create/join are refused with `active_ride_exists` (and by `uq_rides_rider_active`).
  - Their scheduled ride is cancelled `rider_busy`.
  - This breaks the contract's "the creator after dispatch is a member like any other". Only the creator-leaves-last case is tested.
- Fix: decide "active" by membership on shared rides — exclude the shared ride from the creator's active lookups once their membership is no longer `joined`. Reconsider `uq_rides_rider_active` for `kind = 'shared'`.

**H4 — Driver rating prompt carries the previous member's score and comment**
- correctness · Certainty High
- Location: `apps/driver/src/components/home-screen.tsx:239`, `components/auth/apply-to-drive-screen.tsx:528`
- Rationale:
  - When the prompt chains to the next member, `RateRiderScreen` re-renders in place with no `key`, so member B opens with A's stars, comment and error.
  - One tap rates B with A's score. If A ended closed (`alreadyRated`), B opens closed.
  - The test taps a new star for B and hides it.
- Fix: `key={ratingKey(target)}` on both usages (and `app/rate-rider.tsx`). Assert that B starts empty.

**H5 — Driver: a chat push from member B is muted while member A's thread is open**
- correctness · Certainty High
- Location: `apps/driver/src/components/chat/chat-screen.tsx:160-166`, `notifications/push.ts:273-280`
- Rationale: the open chat is registered by `rideId` only, and `isPushForOpenChat` compares only `params.rideId`. B's banner is suppressed, the provider ignores frames for unfocused threads, and the member list has no unread counts, so B's message produces no signal at all.
- Fix: register the open thread as `rideId/memberId` and compare `link.params.memberId` too.

## Warning

- **W1 — srs-conformance · High** · `backend/.../RideLifecycle.java:261-262`
  - Rider history of a shared ride shows the group fare (`fare.getTotal()`) and the ride's fee (always null), not the member's own share or fee. The contract says history shows "their own share".
  - Fix: for `kind = shared` on the rider side, use the caller's membership `shareAmount` / `cancellationFee`.
- **W2 — srs-conformance · High** · `RideRepository.java:294-305`
  - Converted scheduled rides have no accepted offer, so they never count as on time but do count as arrived. Every fulfilled scheduled ride lowers the DRV-06 on-time %.
  - Fix: exclude offer-less rides from the base, or judge against `scheduled_at` (owner reading).
- **W3 — srs-conformance · High** · `ScheduledRideClockServiceImpl.java:244-248`
  - Switching the active vehicle silently releases the claim as a cancellation-metric event. No ruling covers it (the contract lists offline, busy, suspended).
  - Fix: owner ruling — bind the current eligible vehicle, or document the rule.
- **W4 — srs-conformance · High/Medium** · `SuspensionServiceImpl.java:265-276`
  - A rider-ROLE suspension (incl. the M11 low-rating auto-suspension) leaves their scheduled rides pending, and the clock still converts or dispatches them.
  - Fix: owner ruling — cancel free `account_suspended`, or check the role at execution.
- **W5 — srs-conformance · Medium** · `RideDispatchServiceImpl.java:211`, `RiderRideServiceImpl.retry`
  - `no_driver_found` on a shared ride pushes a one-tap Retry to every member. Non-creators get a 404; for the creator, retry silently creates a solo on-demand ride.
  - Fix: owner ruling — refuse retry on shared rides, or re-gather; adjust the copy.
- **W6 — integration · High** · `apps/rider/src/screens/shared/shared-create-screen.tsx:76-79`
  - The create screen estimates with live surge and the current surcharge, but the stored ride uses no surge and the departure-time surcharge. Creators and joiners can see different totals.
  - Fix: pass `scheduledAt` (departure, or now for when-full).
- **W7 — correctness · High** · `apps/rider/src/screens/shared/shared-rides-screen.tsx:122`
  - A rider who left a gathering ride still sees "You're in" on its browse card (`me` is the latest membership, whatever its status).
  - Fix: `ride.me?.status === "joined"`.
- **W8 — srs-conformance · High** · rider `home-screen.tsx` (`later` 44), `shared-create-screen.tsx` (`segment` 44), `shared-rides-screen.tsx:371-376`, `schedule-screen.tsx:446-447`
  - Four new touch targets are 44 px, below the 48 px rule.
- **W9 — integration · Medium** · `apps/rider/src/screens/ride/receipt-screen.tsx:82-94`
  - The receipt returns `paymentStatus: split`. The client fetches the ride for `me.paymentStatus` and swallows a failure, so a paid member silently shows "Pending" and loses the split box.
  - Fix: surface or retry the fetch (or return the member's status in the receipt).
- **W10 — srs-conformance · Medium** · rider shared routes
  - A creator or member who navigates away from a gathering ride can find it again only through browse (filters, first page).
  - Fix: confirm the intended entry point with the owner (e.g. a home card).
- **W11 — correctness · High** · `apps/admin/src/pages/rides/ChatLogCard.tsx:79-91`
  - `loadOlder` has no stale guard. Switching member while "earlier messages" is in flight shows A's thread under B's tab.
  - Fix: capture `memberId` and drop stale results (or disable the tabs while loading).
- **W12 — correctness (race) · High** · `SharedRideServiceImpl` `requireFree`
  - "One open shared membership per rider" is check-then-insert under different ride locks, with no DB guard. Concurrent joins into two rides can both succeed.
  - Fix: per-rider advisory lock in create/join, or a partial unique index once terminal rides' members are marked terminal.
- **W13 — srs-conformance / correctness · High/Medium** · `apps/driver/src/components/chat/shared-chats-screen.tsx:25-29`, `scheduled/scheduled-rides-screen.tsx:484-487`
  - The per-member chat list hides cancelled / no-show members (whose threads stay open 24 h) and shows no unread counts.
  - The claim board does not refetch after the driver sets availability windows from its empty state (`useFocusEffect` missing).

## Info (max 5)
- **I1 — privacy · High** · `RideAssembler` view
  - The rider view's `paymentMethod` on a shared ride is the creator's method. Strangers learn it, and it is wrong for the member.
  - Fix: use `viewer.getPaymentMethod()`.
- **I2 — privacy · Medium** · `ShareServiceImpl.page`
  - A member who cancels or no-shows keeps a working trip-share link until the ride ends.
- **I3 — correctness · High** · `ScheduledRideClockServiceImpl:181-189`
  - Converted rides keep the booking time as `requested_at`, so history sorts them by booking time, not ride time.
- **I4 — integration · High** · `DriverRideServiceImpl.java:431`
  - A driver-cancel redispatch of a scheduled ride copies `kind = scheduled` without a `scheduled_rides` row, so the scheduled block is null (handled by the apps).
- **I5 — tests · High** · no tests for:
  - backend: the busy-claimer branch, the open-offer conversion, the V21 backfill, the lock order across two members' wallets;
  - rider app: `party_too_large`, `departure_in_past`, `already_member`.

+9 more nitpicks — ask to see them.

## What's good
- **Clock job robustness (T6):**
  - one transaction per row;
  - `FOR UPDATE SKIP LOCKED` with the state re-checked under the lock;
  - reminder marks written with the outbox row, so no double reminders;
  - only the latest due tier after downtime;
  - overdue rows run on the next tick;
  - the DST-correct `AT TIME ZONE` window SQL, including overnight windows.
- **Race discipline:**
  - every scheduled and shared writer locks the ride row first;
  - the last-seat race is backed by `ck_shared_rides_seats_taken`;
  - ratings and reports rely on unique constraints with mapped catches;
  - ledger uniques are per ride × member (`NULLS NOT DISTINCT`).
- **Money:**
  - shares sum to the fare;
  - commission is charged per share;
  - wallet steps for all members run before the sorted driver-balance locks, with no deadlock path found;
  - dues are earmarked, collected and released per member;
  - the fee credit goes to the right driver, attributed to the member.
- **Privacy and integration:**
  - rider views carry only `me`;
  - chat threads are private per member;
  - `memberId` appears only on frames and pushes to the driver;
  - every client wire shape and error code matches the backend;
  - EN/AR key sets are identical in all three apps (Western digits, لبي).

## Pre-existing (out of scope, non-blocking)
- `GlobalExceptionHandler` has no `DataIntegrityViolationException` mapping, so any unhandled unique violation is a 500 (it makes H2 worse).
- `DriverRideServiceImpl.accept` never checked driver freedom (it relied on the candidate filter); M12 added the second binding path (H1).
- `findDue` / `findDispatchDue` order oldest first with a LIMIT. Persistently failing rows stay at the head and can starve throughput.
- The admin `surge-zones.test.tsx` "creates a zone…" case timed out once (5 s) in the audit's full admin run while four reviewers loaded the machine. It passed twice when run alone. The file is not in the range.
- The driver app's lint has 3 warnings in `heatmap-units.test.tsx`, which existed before M12.

## Test run results
- `backend: make check` → BUILD SUCCESS, **564 tests**, 0 failures, 0 Checkstyle violations.
- `apps/rider: npm run check` → green, 50 suites / **452 tests**.
- `apps/driver: npm run check` → green, 49 suites / **477 tests** (3 lint warnings that existed before M12).
- `apps/admin: npm run check` → 339 / 340. One flaky timeout in `surge-zones.test.tsx` (out of range, see above); that file then ran green twice alone (5 / 5).
- CI on `main`: green through `ce6e521` (run 39027211116); later pushes not checked during the audit.

## Resolution (labby-fix, 2026-10-17)
Owner rulings, 2026-10-17: H1 the claim wins · H2 a gathering membership counts as busy · W2 a converted ride is judged against its pickup time · W3 bind the new vehicle · W4 a rider-role suspension works like an account suspension · W5 no retry on a shared ride · W10 backlog · I2 close a member's share link when they leave. The rulings are recorded in `scheduled-shared-v1.yaml` and `docs/SRS.md`.

| Finding | Outcome | Commit |
|---|---|---|
| H1 | fixed: conversion withdraws the claimer's open offer (`scheduled_converted`); accept → 409 `driver_busy`; V22 `uq_rides_driver_assigned` | 79f2e23 |
| H2 | fixed: gathering = busy for booking and scheduling; a scheduled ride at T−15 → `rider_busy`; dispatch drops a busy member (a busy creator → the group is cancelled) | 79f2e23 |
| H3 | fixed: a shared ride counts as a rider's active ride only through their membership; V23 limits `uq_rides_rider_active` to non-shared rides | 79f2e23 |
| H4 | fixed: `key={ratingKey(target)}` on the three rate screens; the test asserts the next member starts empty | df5bbab |
| H5 | fixed: the open chat is registered as ride + member; the push check compares the member | df5bbab |
| W1 | fixed: rider history shows the member's own share / fee | 79f2e23 |
| W2 | fixed: a converted ride is on time if the driver arrives by `scheduled_at` + 5 min | 79f2e23 |
| W3 | fixed: conversion binds the current eligible vehicle; otherwise `vehicle_changed` (no metric) + `scheduled.claim_lost` | 79f2e23 |
| W4 | fixed: a rider-role suspension cancels scheduled rides and pre-acceptance memberships | 79f2e23 |
| W5 | fixed: backend refuses retry and pushes the shared text; the rider app shows no Retry, only "Find another shared ride" | 79f2e23, 81caf2b |
| W6 | fixed: the create estimate is priced at the departure time (or now for "when full") | 81caf2b |
| W7 | fixed: "You're in" only while the membership is `joined` | 81caf2b |
| W8 | fixed: the four touch targets are 48 px | 81caf2b |
| W9 | fixed: a failed member split read shows a retry, never "Pending" | 81caf2b |
| W10 | backlog (owner ruling): a home entry for an open shared ride needs an artboard and a "my membership" read | — |
| W11 | fixed: stale "earlier messages" answers are dropped after a member switch | 51c5e86 |
| W12 | fixed: a per-rider transaction lock on book / schedule / create / join; a race test proves one membership | 79f2e23 |
| W13 | fixed: the chat list includes cancelled / no-show members with unread badges; the claim board reloads on focus | df5bbab |
| I1 | fixed: the member's own payment method in their view | 79f2e23 |
| I2 | fixed: a member's share link returns 410 once they cancel or no-show | 79f2e23 |
| I3, I4 | not fixed, backlog (minor; nothing breaks) | — |
| I5 | covered by the new tests listed above | — |

Gates after the fixes:
- **Backend:** 575 tests ran; 572 passed. The 3 errors were test fixtures that seeded two live rides for one driver, which the new V22 index now forbids; they were adjusted and both classes re-ran green. spotless and Checkstyle are clean.
- **Rider:** 457 tests green.
- **Driver:** 479 tests green, with the same 3 lint warnings as before.
- **Admin:** 341 tests green.

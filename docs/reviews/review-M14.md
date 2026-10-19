# Review — M14 Support & content (`a4f8197..28706f6`)
_15 commits · 251 files · reviewed 2026-10-19_

## Summary
M14 delivers the full support loop end to end: tickets with a real state machine and a 48 h reminder, a help CMS that cannot publish half-translated content (service check + DB CHECK), lost-item cases whose chat window is *derived* from the open-case index, feedback with tags and trends, and SOS-linked tickets — in all three clients, with a scripted walkthrough (T5) and a live admin smoke behind it. The audit ran four independent slice reviews (backend, rider, driver, admin); every finding below was re-checked against the code at `28706f6`.

Four High findings block the milestone: a lost-update race on tickets that can resurrect a closed case (and its chat), shared-ride lost-item cases whose reopened chat the driver and admin cannot reach, a rider case screen that reports a `not_found` item as returned, and help-article ordering (UC-A-23 / SUP-04) missing from the admin CMS.

**Verdict:** Fail
**Findings:** Critical 0 · High 4 · Warning 13 · Info 5 · Praise 4

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| T1: state machines documented; migrations clean | met | support-v1 header; V26 CHECKs + comments; `TicketStatus/CaseStatus.canMoveTo`; `SupportMigrationIntegrationTest` (9) |
| T2: full ticket lifecycle incl. `waiting_on_user` reminder | met | `SupportTicketsIntegrationTest.shouldRunTheFullLifecycle` (47 h none, 48 h one, once per stay) |
| T2: publish blocked on a missing language | met | `HelpCenterServiceImpl.requireComplete` + `ck_help_articles_published_complete`; `HelpCenterIntegrationTest`; live smoke |
| T2: chat window reopen/close exactly tracks case state | partial | Sequential paths proven (`LostItemsIntegrationTest`, `SupportSimulatorIntegrationTest`, >24 h ride, closed → new report); concurrent writes can resurrect a closed case (H1); shared rides untested (W11) |
| T2: feedback aggregation | met | `FeedbackIntegrationTest.shouldBrowseTagAndAggregate`; simulator scenario 3 |
| T3: UC-S-19…22 flows + exceptions, EN/AR + RTL, tests green | partial | Rider 16/16, driver 32/32, full EN/AR key parity, Western digits; UC-R-20 A1 shown wrong (H3); UC-D-21 broken on shared rides (H2) |
| T4: UC-A-21…25 end-to-end, permission-gated + audited, tests green | partial | Admin 30/30; gating consistent across route/nav/control; `@PreAuthorize` + `auditService.record` on every admin write; UC-A-23 article ordering missing (H4); UC-A-24 delete / FDBK-01 tag filter (W5, W6) |
| T5: scripted walkthrough passes | met | `SupportSimulatorIntegrationTest` 3/3; live admin smoke 2026-10-19 |
| Milestone: full support loop with notifications at every step | met | created, every status move (`TicketHistory.move`), support reply, reminder, case opened (driver), every case change (both sides) — center + push asserted in the simulator |
| Milestone: lost-item cases provably control the chat window | partial | see T2 row (H1, H2) |
| Milestone: help content impossible to publish half-translated | met | service + DB CHECK, admin UI blocks with missing fields named |
| Milestone: tracker updated; review audit passed | unmet | this audit: Fail |

## Critical
None.

## High

### H1 — Ticket writes have no concurrency control; a closed ticket/case can come back to life
- **Category:** correctness · **Severity:** High · **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/model/SupportTicket.java` (no `@Version`); `backend/src/main/java/com/labby/backend/service/SupportTicketServiceImpl.java:235-240` (`detail()` saves the whole entity to stamp `user_read_at`); also `reply` (:249), `setStatus`, `LostItemServiceImpl.setCaseStatus`, `TicketHistory` saves.
- **Rationale:** Hibernate updates every column. A rider opening `GET /tickets/{id}` while an admin closes the case writes the pre-close `status/case_status/closed_at` back → `existsOpenCase` sees an open case again and the **ride chat reopens** — the milestone's "case controls the chat window" guarantee breaks. Same race: a user reply vs `resolved→closed` makes `closed` non-terminal; two admins can both move `driver_contacted→found` and `→not_found`; an admin save can clear a natively stamped `reminder_sent_at` (second reminder). The codebase convention for contended aggregates is `@Version` (`Ride.java:186`).
- **Fix Suggestion:** V29 `support_tickets.version BIGINT NOT NULL DEFAULT 0` + `@Version` on `SupportTicket`, mapped to 409 (like Ride). Stamp the read marker with a targeted `UPDATE support_tickets SET user_read_at = :now WHERE support_ticket_id = :id` instead of a full save. Integration test: stale read-marker save after a close leaves the case closed.

### H2 — Shared-ride lost-item cases: the driver and admin cannot open the reopened chat
- **Category:** integration · **Severity:** High · **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/dto/LostItemCaseDto.java:11-22` (no `memberId`); `apps/driver/src/components/support/lost-item-case-screen.tsx:63`, `:98-103`; `apps/admin/src/pages/LostItemCasePage.tsx:311-315`.
- **Rationale:** A shared-ride member may report (support-v1 line 349; `LostItemServiceImpl.report` uses `RideParties.RIDING`). On a shared ride the driver must address a member (`RideParties.driverTarget` → 400 `member_required`), but the case payload never carries the member, so the driver's Call button silently disappears and "Open ride chat" opens a failing thread; the admin case page falls back to "open the ride's page". UC-D-21's main action and UC-A-22's "reopened chat visible" fail for shared rides.
- **Fix Suggestion:** Contract amendment: `LostItemCase.memberId` (and on the admin `lostItem` block), null on one-rider rides; driver passes it to `getChatThread` and the `/chat` route, admin to `ChatLogCard`. Backend + driver + admin tests on a two-member shared ride (also closes W11).

### H3 — Rider case screen shows a `not_found` item as returned once the case closes
- **Category:** correctness · **Severity:** High · **Certainty:** High
- **Location:** `apps/rider/src/screens/support/lost-item-case-screen.tsx:31-44`, `:89-94`
- **Rationale:** `stepIndex("closed")` is 3 (all steps done) and the "Not found" label applies only while the status is exactly `not_found`. A `not_found → closed` case (UC-R-20 A1, allowed by the contract) renders "Found ✓ · Returned ✓" — the rider is told the item came back when it did not. Untested.
- **Fix Suggestion:** Derive the outcome for `closed` from the ticket history (`case_status_changed` to `not_found` / `returned`) or expose the outcome in `LostItemCase`; render "Not found → Closed" accordingly. Tests for both closing paths.

### H4 — Help-article ordering is not available in the admin CMS
- **Category:** srs-conformance · **Severity:** High · **Certainty:** High
- **Location:** `apps/admin/src/api/support.ts:481` (`reorderHelpArticles` defined, never called); `apps/admin/src/pages/HelpCmsPage.tsx` (article table has no order controls; drafts show `—`).
- **Rationale:** SUP-04 ("ordered") and UC-A-23 ("order them") require ordering articles; the backend endpoint `PUT /admin/help/categories/{id}/articles/order` exists and is tested, but no UI reaches it. The approved A14HelpCms board shows an Order column without controls, so this is a gap the board carried, not an implementation slip — **needs an owner ruling** (add arrows like the category list, or accept fixed ordering for V1 and amend the SRS).
- **Fix Suggestion:** Up/down arrows on published article rows reusing the category `move` pattern, sending the full id list; test.

## Warning

### W1 — Admin: a failed publish of a new article leaves orphan drafts
- **Category:** correctness · **Certainty:** High · **Location:** `apps/admin/src/pages/HelpArticleEditorPage.tsx:160-171`
- **Rationale:** `publish()` creates then publishes; if publish fails, `article` stays null and the next click creates the article again.
- **Fix Suggestion:** `setArticle(saved)` and navigate right after the create succeeds, before publishing.

### W2 — Admin: load failures show "Loading…" forever
- **Category:** correctness · **Certainty:** High · **Location:** `apps/admin/src/pages/HelpCmsPage.tsx:82-86`, `apps/admin/src/pages/FeedbackPage.tsx:125-128`, `apps/admin/src/pages/HelpArticleEditorPage.tsx:81`
- **Fix Suggestion:** Error state + `LoadFailure` with retry, as on the queue pages.

### W3 — Driver: merged ticket/case list loses its order after page 1
- **Category:** correctness · **Certainty:** High · **Location:** `apps/driver/src/components/support/tickets-screen.tsx:184-196`
- **Rationale:** Cases are merged only into page 0; later ticket pages are appended below them, breaking "most recently updated first" (UC-S-20).
- **Fix Suggestion:** Keep loaded tickets and cases in state and re-run `mergeRows(allTickets, cases)` after each page.

### W4 — Driver: "show older" has no busy state
- **Category:** correctness · **Certainty:** Medium · **Location:** `apps/driver/src/components/support/tickets-screen.tsx:197-205`, `:243-248`
- **Rationale:** A double tap fetches the same page twice and inflates `loadedTickets`; a page-2 failure replaces the whole list with the error view.
- **Fix Suggestion:** `loadingMore` flag; inline error for later pages.

### W5 — Admin: no delete for ticket categories / help categories (UC-A-24 "CRUD")
- **Category:** srs-conformance · **Certainty:** Medium · **Location:** `apps/admin/src/api/support.ts:300-340`, `apps/admin/src/pages/TicketCategoriesPage.tsx:229-272`
- **Rationale:** The contract defines `DELETE /admin/ticket-categories/{id}` (409 `category_in_use`) and `DELETE /admin/help/categories/{id}` (409 `category_not_empty`); the approved boards show no delete and the owner only waived *article* delete. Owner ruling: add delete for unused rows, or accept deactivate-only.

### W6 — Admin: feedback tags can't be removed, and there is no tag filter
- **Category:** srs-conformance · **Certainty:** High · **Location:** `apps/admin/src/pages/FeedbackPage.tsx:166`, filters `:238-270`
- **Rationale:** FDBK-01 "browse/filter/tag"; the contract's `tag` filter is not exposed and a mistaken tag is permanent from the UI.
- **Fix Suggestion:** Remove "×" on chips for `support:handle`; chip click filters by tag.

### W7 — Rider: ride-history failure blocks ticket creation
- **Category:** correctness · **Certainty:** High · **Location:** `apps/rider/src/screens/support/ticket-create-screen.tsx:84-96`
- **Rationale:** Categories and the optional ride list load in one `Promise.all`; `/rides` is blocked for account-suspended riders (`AccountSuspensionInterceptor`) while `/tickets` is not, so such a rider can never open a ticket.
- **Fix Suggestion:** Load rides separately and hide the picker on failure.

### W8 — Rider: search failures shown as "No results"
- **Category:** correctness · **Certainty:** High · **Location:** `apps/rider/src/screens/support/help-search-screen.tsx:64-67`
- **Fix Suggestion:** Separate error state with retry copy.

### W9 — Rider: ticket composer ignores the bottom safe area
- **Category:** structure · **Certainty:** High · **Location:** `apps/rider/src/screens/support/ticket-thread-screen.tsx:370-379`
- **Rationale:** Fixed `paddingBottom: spacing.xl`; the chat composer uses `insets.bottom` (`chat-screen.tsx:239`) and `useBottomBarPadding` exists. CLAUDE.md: safe-area insets on every mobile screen.
- **Fix Suggestion:** `paddingBottom: useBottomBarPadding(spacing.xl)`; set `keyboardVerticalOffset`.

### W10 — Touch targets under 48 px (rider + driver)
- **Category:** structure · **Certainty:** High · **Location:** rider `ticket-create-screen.tsx:263-273`/`:424-434` (22×22 remove), `lost-item-report-screen.tsx:224-234`, `ticket-create-screen.tsx:311-319`; driver `feedback-screen.tsx:180` (40 px chips), `help-article-screen.tsx:175` (38 px toggle)
- **Rationale:** CLAUDE.md ≥ 48 px. The driver chips match the board's 40 px drawing, but the rule still applies.
- **Fix Suggestion:** `hitSlop` / `minHeight: 48` (pattern: `screens/trust/report-screen.tsx:285`).

### W11 — Backend: no shared-ride lost-item test
- **Category:** tests · **Certainty:** High · **Location:** `backend/src/test/java/com/labby/backend/integration/LostItemsIntegrationTest.java`
- **Rationale:** T6 asks for the multiple-riders edge; nothing proves only the reporting member's thread reopens. Concurrent reports (the `uq_support_tickets_open_case` → 409 path) are untested too.
- **Fix Suggestion:** Two members on a completed shared ride; A reports → A `reopened`, B `read_only`, driver view per `memberId`.

### W12 — Rider: thread bubbles don't flip in the RTL switch window
- **Category:** structure · **Certainty:** Medium · **Location:** `apps/rider/src/screens/support/ticket-thread-screen.tsx:357-366`
- **Fix Suggestion:** Use `flipRows` as the M10 chat does (`chat-screen.tsx:524`).

### W13 — Client test gaps
- **Category:** tests · **Certainty:** High
- **Location:** rider `src/notifications/__tests__/deep-links.test.ts` (no `ticket` / `lost_item_case` cases); rider support suites (no `not_found` path, `category_inactive`, upload 413/429, caps, search failure); driver (upload failures, merged pagination, shared-ride case); admin `lost-items.test.tsx:182` (no `not_found → closed`), assignee change incl. `assignee_not_handler`, `initialReason` pre-fill, `weekStart` Sunday edge.

## Info (max 5)
- **I1** `backend/.../repository/SupportTicketRepository.java:100-102` — the reminder stamp doesn't re-check `waiting_since <= cutoff`; a ticket leaving and re-entering `waiting_on_user` between scan and stamp gets an early reminder. Add the cutoff to the stamp. (Certainty Medium)
- **I2** `SupportTicketServiceImpl.java:258` → `TicketHistory.move` — the user's own reply pushes "Support is working on your ticket" to that user. Conforms to "every change notifies"; owner may prefer to skip the push when `side == USER`.
- **I3** `LostItemServiceImpl.java:58` injects the concrete `SupportTicketServiceImpl` for shared helpers; move them to a small `@Component`.
- **I4** `LostItemServiceImpl.java:142`, `:242-266` — rider/driver case lists do ~6 queries per case (≤ 50 per page); batch like `SupportAssembler`.
- **I5** `apps/admin/src/pages/support/TicketThread.tsx:46` — sorts ISO instants with `localeCompare`; varying fraction lengths can misorder same-second items. Use `Date.parse` (stable sort keeps amendment (g) order).

+7 more nitpicks — ask to see them.

## What's good
- **Praise:** the chat window is *derived* from the open-case partial unique index, never stored — the same index arbitrates the one-open-case race.
- **Praise:** invariants live in the database as well as the service (case/ticket closing together, `waiting_since` ↔ status, complete published articles, protected system category, lost items always `rider`).
- **Praise:** the reminder is exactly-once per stay across instances (conditional stamp in its own `REQUIRES_NEW` transaction).
- **Praise:** all three clients mirror the contract 1:1 in one API slice, keep EN/AR key parity with Western digits, and gate admin controls consistently at route, nav and control level.

## Pre-existing (out of scope, non-blocking)
- Admin `ChatLogCard` needs `members` on shared rides (M12 design); H2 inherits it.
- 40 px chip pattern also in driver `components/trust/reports-screen.tsx:183` and `components/ride/ride-parts.tsx:456`; rider `ChoiceChip` `hitSlop={4}`.
- A role-suspended driver cannot open support (routes in the active-driver stack, approved T3 call) yet still receives `lost_item.case_*` pushes — owner decision, not counted.

## Test run results
- Backend (scoped, local, 2026-10-19 on the T5 tree): `./mvnw test -Dtest='SupportSimulatorIntegrationTest,SupportTicketsIntegrationTest,LostItemsIntegrationTest,SupportMigrationIntegrationTest,HelpCenterIntegrationTest,FeedbackIntegrationTest,SupportStateMachinesTest'` → 25/25 green; `LayeredArchitectureTest` 7/7; `checkstyle:check` clean.
- Rider: `npx jest src/screens/support` → 2 suites, 16/16.
- Driver: `npx jest src/__tests__/support-{help,ticket,lost-feedback}.test.tsx` → 3 suites, 32/32.
- Admin: the 7 M14 test files via `npx vitest run` → 30/30.
- Full gate: CI run 39274776918 on 5b5e12d (T1–T4) **green**; CI run 39282931694 on 28706f6 (T5) **green** (all four jobs).

## Resolution (labby-fix, 2026-10-19)
Owner rulings: H4 add article reorder arrows (no new board); W5 delete only unused rows; I2 skip the push for the user's own move; contract T6 amendments (h) `memberId`, (i) `outcome`, (j) the I2 rule.

| Finding | Resolution | Commit |
|---|---|---|
| H1 | V29 `version` + `@Version`/`@DynamicUpdate` on `SupportTicket` (stale save → 409); read marker stamped by a one-column UPDATE; reminder stamp bumps the version | 0e16b62 |
| H2 | `memberId` on `LostItemCase` + admin `lostItem`; driver passes it to the chat thread and `/chat`; admin `ChatLogCard` reads it | 0e16b62, 4d53cb4, 7fa3f65 |
| H3 | V29 `case_outcome` / `LostItemCase.outcome`; rider timeline built from the outcome (not found stays not found after closure) | 0e16b62, 99d4655 |
| H4 | Up/down arrows on published article rows → `PUT …/articles/order` | 7fa3f65 |
| W1 | Editor keeps and navigates to the created draft before publishing | 7fa3f65 |
| W2 | `LoadFailure` + retry on help articles, feedback stats, editor categories | 7fa3f65 |
| W3, W4 | Driver list re-merged after every page; busy "show older"; inline page error | 4d53cb4 |
| W5 | Delete for unused ticket categories / empty help categories, confirm step, 409s handled | 7fa3f65 |
| W6 | Tag remove "×" and tag filter via `?tag=` | 7fa3f65 |
| W7, W8, W9, W12 | Rider: rides load separately; search error state; composer safe area + keyboard offset; bubbles follow `flipRows` | 99d4655 |
| W10 | hitSlop / minHeight to 48 px (rider + driver; visuals unchanged) | 99d4655, 4d53cb4 |
| W11 | Shared-ride lost-item test (only the reporter's thread reopens; member reaches driver + admin) + concurrent double report → one 201, one 409 | 0e16b62 |
| W13 | Rider deep links / caps / upload / search / not_found tests; driver upload + paging tests; admin not_found, assignee, remedy pre-fill, week-start tests | all four |
| I1 | Reminder stamp re-checks `waiting_since <= cutoff` | 0e16b62 |
| I2 | No status push for a user-caused move (history kept); contract amendment j | 0e16b62 |
| I3 | `TicketFiles` component shared by both services | 0e16b62 |
| I4 | Lost-item lists batched (rides, threads, open cases, attachments, names) | 0e16b62 |
| I5 | Admin thread sorts by `Date.parse` | 7fa3f65 |

Scoped results: backend support + chat suites 40/40, ArchUnit 7/7, Checkstyle clean; rider 60/60; driver 40/40; admin 65/65; tsc + eslint clean in all three apps. Not verified on a device: rider keyboard offset / safe-area padding.

## Re-audit (`3cb3bac..58903a6`, 2026-10-19)
Independent re-audit of the five labby-fix commits. Every finding was checked against the live code: H1–H3, W1–W13, I1–I3 and I5 are **resolved**, with no regressions found. The regression checks covered:
- the version / `@DynamicUpdate` interplay with the native read-marker and reminder stamps;
- the 409 mapping;
- that the batched case list gives the same windows, `memberId` and `outcome` as the single-case view;
- the `TicketFiles` transaction boundaries;
- I2 applying only to `reply`;
- contract ↔ DTO ↔ app types for the new fields;
- EN/AR parity.

I4 is mostly resolved: one member lookup per case remains on shared rides only.

**Re-audit verdict: Fail.** One new High finding kept H4 only partially resolved:

### N1: Article reorder sent only the published ids
- **Category:** integration
- **Severity:** High
- **Certainty:** High
- **Location:** `apps/admin/src/pages/HelpCmsPage.tsx` (`moveArticle`); backend `HelpCenterServiceImpl.reorderArticles` / `requireCompleteOrder`; support-v1 `order_incomplete`.
- **Rationale:** The backend requires every article of the category exactly once. In any category holding a draft, every arrow click answered 422. The admin test mock accepted a partial list, so the test hid the failure.
- **Resolution:** Fixed in 605d74d. The request now sends the swapped published ids followed by the drafts in their current order. The test mock now answers 422 `order_incomplete` exactly as the backend does, and the test asserts the full list `['a3', ARTICLE_1, 'a2']`. The same commit fixes **N3**: the order cell shows the published position (`orderIndex + 1`), so numbers no longer skip around drafts. Verified with `npx vitest run src/test/help-cms.test.tsx` (8/8), plus `tsc -b`, eslint and prettier, all clean.

### After N1: **Pass with comments**
These items are non-blocking and go to the backlog:
- **N2 (Info):** in the rider ticket form, a prefilled `initialRideId` is still sent when the ride list fails to load, even though the picker is hidden. No caller passes it today.
- **I4 leftover:** on shared rides, the lost-item lists still do one member lookup per case.
- **W9:** the rider composer's keyboard offset and safe-area padding have not been checked on a device.
- The new admin controls (tag ×, tag filter chip, delete with confirm, article arrows) were added to existing screens under the owner's H4 and W5 rulings, without new boards.

CI: green on the labby-fix commits — run 39289352913 on 0e16b62 and run 39291079583 on 58903a6 (all four jobs each); 605d74d rides with the closure push.

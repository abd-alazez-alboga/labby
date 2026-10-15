# Review — M10 Communication & safety (`957b7b0..92933f8`)
_4 commits · 157 files (backend 75, rider 30, driver 25, admin 26) · reviewed 2026-10-15_

Milestone audit (M10-T6). Range: from the M9 tracker-handoff commit 957b7b0 (after the M9 review baseline e0c3038) to HEAD 92933f8 — commits 0756457 (T1 contract + V15), b857827 (T2 backend), 3e6bb01 (T3/T4 apps + admin, phone gating), 92933f8 (T5 e2e + walkthrough fixes). Four independent reviewers (backend, rider, driver, admin) read the full files; every High was re-verified against the code before inclusion. Owner rulings and accepted deviations recorded in the tracker, and the known backlog (admin SOS-filter workarounds, share-page Arriving tile, rider ride-card photo URL, SYP decimals), are not re-raised.

## Summary
M10 delivers per-ride chat, click-to-dial, trip sharing, SOS and the admin live ops map end to end, proven by behaviour-asserting backend tests, a full-ride e2e test and a live emulator walkthrough. The share-token design is sound and SOS is permanent and reaches admins in seconds at demo scale. Six High findings remain — a phone-number leak around the owner's contact-access ruling, drivers being served the rider quick replies, an empty-chat reconnect gap on the rider, and three admin SOS-handling gaps (the default Support role cannot use the live map, the alert panel never refreshes, SOS links ignore the region) — so the milestone does not pass yet.

**Verdict:** Fail
**Findings:** Critical 0 · High 6 · Warning 20 · Info 18 (5 shown) · Praise (see What's good)

Owner decisions needed before the fix round: **A-H1** (how the Support role gets a region list for the live map: grant `regions:view` to Support by migration, or serve the region list from the live-ops/`rides:view` side), **B-H1** (should `/admin/sos-events` also need `support:handle` for the caller's phone, not only `support:view`), **B-H2** (confirm drivers see driver + shared quick replies only — the current test encodes the opposite), **D-W3** (offline driver in the 24 h chat tail: composer hidden, or REST send), **B-I4** (Arabic on the public share page).

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| T1 — window rules (acceptance → +24 h, read-only after, reopen hook) encoded in the contract; migrations clean | met | comms-v1.yaml window table; V15; `CommsMigrationIntegrationTest` (5) |
| T2 — window edges, reconnection/dedup, share token unguessable + dead post-ride, SOS immutability, alert fan-out to the right admins only | met (concurrent-dedup push duplication B-W1) | `ChatIntegrationTest`, `ChatPushIntegrationTest`, `ShareIntegrationTest`, `SosIntegrationTest`, `CommsMigrationIntegrationTest` |
| T3 — UC-S-13…16 flows + exceptions against mocks; one-tap quick replies while driving (NFR-U2); RTL; tests green | partial | flows covered (rider `chat-screen`, `safety-actions`, `push-lifecycle`, `cold-start-chat`; driver `chat-screen`, `safety-actions`, `chat-push`); gaps: driver shown rider quick replies (B-H2), empty-chat reconnect (R-H1), exception paths untested (R-W6, D-W6) |
| T4 — UC-A-19/20 end-to-end; map live at demo scale; UC-A-18 rides search/detail standalone + click-through; permission-gated | partial | `live-ops-page`, `rides-page`, `ride-detail-page` tests; walkthrough passed with a Super Admin; gaps: Support role cannot load the map (A-H1), alert panel stale (A-H2), region-less SOS links (A-H3), phone leak via live-ops (B-H1) |
| T5 — e2e chat both ways + quick replies + push, dialer number, share link live then dead, SOS dialer + admin alert + red pin + permanent event; walkthrough on real devices for dial/share/push | met | `CommsSimulatorIntegrationTest`; emulator walkthrough 2026-10-14 + re-check 2026-10-15 (tracker) |
| Milestone — chat, dial, share, SOS work on real devices within their windows | met (emulator) | walkthrough record in the tracker |
| Milestone — the share page leaks nothing beyond SHARE-02 and dies on time | met (driver UUID inside the signed photo URL, B-I2 — nitpick list) | exact field-set test; 410 tests |
| Milestone — SOS permanent, instant to admins, visible on the live map | partial | permanent + map pin met; "instant" is ~1–6 s push / ≤5 s map at demo scale, unbounded under an outbox backlog (B-W4); Support role cannot open the map (A-H1) |
| Milestone — tracker updated; review audit passed | pending | this report |

## High

### B-H1 — Live-ops feed gives SOS caller phone numbers to admins with only `rides:view` (Backend)
- **Category:** Security / authorization (PII)
- **Severity:** High
- **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/service/LiveOpsServiceImpl.java:92` → `SosServiceImpl.java:203-204` (`TriggeredByDto(id, name, phone)`); gate at `AdminLiveOpsController.java:32` (`rides:view`)
- **Rationale:** On 2026-10-14 the owner ruled that party phones are contact access (UC-A-20), so `GET /admin/rides/{id}` shows them only to `support:handle` holders. The backend enforces this (`AdminRidesController.detail`, `withoutPhones()`), and both RideLifecycleIntegrationTest and CommsSimulatorIntegrationTest:353-359 test it. The live-ops snapshot does not follow the rule. Its `sosEvents[]` are built with the same `adminViews()` that the alert list uses, so every open pin includes `triggeredBy.phone`. Any `rides:view` admin gets the phone of every rider or driver who pressed SOS in the region, which is the contact access the ruling restricts. CommsSimulatorIntegrationTest:338 even calls live-ops as the `ridesViewer` but never checks the phone field. The comms-v1 `LiveOps.sosEvents` schema came before the ruling and reuses `AdminSosEvent`, so the contract is now out of date with the ruling as well. Related owner question: `/admin/sos-events` returns the phone with `support:view` (as the contract says). Should it also need `support:handle`, to match the ruling's reasoning?
- **Fix Suggestion:** In `LiveOpsServiceImpl.snapshot`, null `triggeredBy.phone` unless the caller holds `support:handle`. Pass a `contactAccess` flag the same way `AdminRidesController` does, or add a `withoutPhone()` on `AdminSosEventDto`. Update comms-v1 `LiveOps.sosEvents` and add an assertion to the simulator test (`ridesViewer` → phone null). Ask the owner about the `/admin/sos-events` case.

### B-H2 — Driver accounts get the rider quick replies, and the driver app shows all of them (Backend)
- **Category:** Correctness / backend↔app contract
- **Severity:** High
- **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/service/ChatServiceImpl.java:191-205`; locked in by `ChatIntegrationTest.java:428-432`; consumed unfiltered by `apps/driver/src/chat/ChatProvider.tsx:331-333` → `apps/driver/src/components/chat/chat-screen.tsx:165,324-326`
- **Rationale:** `quickReplies()` adds the `rider` audience whenever the account holds `Role.RIDER`. Registration gives every account that role (`AuthServiceImpl.java:131`), so every driver also gets `rider_coming`, `rider_where_are_you` and `rider_wait_please`. The test comment says so ("both sets"). The driver app expects "audience driver + both" (`apps/driver/src/api/comms.ts:56-58`) and draws the whole catalog as one-tap chips. A driver therefore sees "I'm coming" and "Where are you now?" mixed in with "On my way" and "I've arrived" (sort_order interleaves them: 10/10, 20/20, …). That differs from the approved driver-chat artboard and from the contract's "caller's role" wording. `validate()` (`ChatServiceImpl.java:338-342`) also never checks the audience, so either party can send the other side's codes.
- **Fix Suggestion:** Let the client say which app is asking (e.g. `GET /chat/quick-replies?as=driver|rider`, accepted only if the account holds that role), or pick the audience from the party role when the catalog is requested in a ride context. In `send`, refuse a code whose audience is neither `both` nor the sender's `RideParty` (`invalid_message`). Update the ChatIntegrationTest assertion so a driver gets driver + both only. The owner should confirm the intended set first, because the current test encodes the opposite.

### R-H1 — Reconnect backfill is skipped when no message is shown yet (driver's first message lost on screen) (Rider app)
- **Category:** Correctness / contract (UC-S-13 E1, comms-v1 "after" backfill)
- **Severity:** High
- **Certainty:** High
- **Location:** apps/rider/src/chat/use-chat-thread.ts:243-245 (`const last = …; if (!last) return;`)
- **Rationale:** `backfill()` only runs with an anchor message. With an empty thread (the normal state
  right after acceptance, when the first message is usually "I'm here") a socket drop/reconnect while
  the chat is open fetches nothing: any `chat.message` sent during the gap is never shown. The same
  happens when the screen was in `missing` (404) and a later `chat.ready` → `refreshThread()` flips it to
  `ready` — the thread appears but its history is never loaded. It is compounded by the push rule: while
  this ride's chat is focused the foreground banner is suppressed (open-chat.ts / isPushForOpenChat), so
  the rider gets no signal at all until leaving and reopening the chat. The only reconnect test
  ("resends the unacked message after a reconnect … backfills with `after`") seeds two messages, so the
  empty case is untested.
- **Fix Suggestion:** when `messagesRef` is empty, backfill with the latest page (no cursor, size 50) and
  merge via `appendMessages`; also load history when `refreshThread` moves the status from
  `missing`/`error` to `ready`. Add a test: empty history → reconnect → missed driver message rendered.

### A-H1 — Live map unusable for the default Support role (undeclared `regions:view` dependency) (Admin app)
- **Category:** Permission gating / Correctness
- **Severity:** High
- **Certainty:** High
- **Location:** apps/admin/src/pages/LiveOpsPage.tsx:44-61 (listRegions) and :35-38 (regionId derives only from the list); apps/admin/src/app/App.tsx (route `live-ops` gated by `rides:view` only); backend RegionsController.java:42-43 (`GET /admin/regions` = `regions:view`); backend V4__rbac.sql:108-113 (Support = users:view, rides:view, support:view, support:handle — no regions:view); test/live-ops-page.test.tsx:63-65 (every fixture adds `regions:view`, masking it)
- **Rationale:** The page picks its region exclusively from `GET /admin/regions`. A holder of `rides:view` without `regions:view` — the seeded Support role, i.e. the very people who handle SOS — gets 403 → `regionsFailed` banner, `regionId` undefined, `useLiveOps` never polls, so no map, no pins, no SOS banner (UC-A-19). The nav entry and route are shown/allowed by `rides:view`, so the user lands on a broken page. Tests never exercise rides:view-without-regions:view.
- **Fix Suggestion:** Owner decision: either let the live-ops surface obtain its region list under `rides:view` (e.g. a lightweight region id/name list allowed for rides:view, or regions inside the live-ops contract), or gate the nav/route on both codes and grant Support `regions:view`. Add a test with `['rides:view','support:view','support:handle']`.

### A-H2 — SOS alert panel never refreshes: new alerts can't be acknowledged from the live map; 409 is a dead end (Admin app)
- **Category:** Correctness (UC-A-20)
- **Severity:** High
- **Certainty:** High
- **Location:** apps/admin/src/pages/liveops/SosAlertPanel.tsx:49-67 (loads only on status/region/attempt change), :146-150 (any failure incl. 409 `already_acknowledged` → generic error, item stays open with an active button), :186-190; i18n en.json:1079 ("…refresh the list" — no refresh control exists outside the load-failure banner)
- **Rationale:** The banner and pins update every 5 s from live-ops, and the provider toasts a new SOS, but the panel — the only place with the Acknowledge control — keeps its first list. An admin already on the live map sees the new red pin/banner/toast yet the alert isn't in the panel; the toast's "Open live map" action navigates to the same route (no remount). Likewise when another admin acknowledges, the panel still shows OPEN; pressing Acknowledge yields 409 and the copy asks to refresh a list that has no refresh button (only switching filter chips reloads it). No test covers 409 or an arrival while the panel is open.
- **Fix Suggestion:** Re-read the panel list whenever the live-ops snapshot's open SOS ids change (or on the SosAlertsProvider's openEvents change / its poll); on 409 `already_acknowledged`, re-fetch the list (or replace the item with the server state) instead of a generic error. Add tests for both.

### A-H3 — SOS click-throughs to the live map ignore the alert's region (Admin app)
- **Category:** Correctness (UC-A-20, SAFE-01)
- **Severity:** High
- **Certainty:** High
- **Location:** apps/admin/src/sos/SosAlertsProvider.tsx:91 (`navigate('/live-ops')`); apps/admin/src/pages/RideDetailPage.tsx:295 (`<Link to="/live-ops">`); LiveOpsPage.tsx:35-38 (falls back to `regions[0]`)
- **Rationale:** Both the sticky toast and the ride-detail SOS banner open `/live-ops` without `?region=`, so the page shows the first region. With more than one region, an SOS in region B lands the admin on region A: no banner, no pin, and the panel is also filtered to region A — the alert they were sent to handle is not on screen. `event.regionId` / `ride.regionId` are available at both call sites.
- **Fix Suggestion:** Navigate to `/live-ops?region=${event.regionId}` (toast) and `/live-ops?region=${ride.regionId}` (ride detail); optionally carry a focus point so the map flies to the pin.

## Warning

### B-W1 — Concurrent duplicate sends still push twice and send two frames (Backend)
- **Category:** Correctness (dedup)
- **Severity:** Warning
- **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/service/ChatServiceImpl.java:226-247`
- **Rationale:** The `insertIfAbsent` row is race-safe: `ON CONFLICT … DO NOTHING`, and the loser re-reads the committed winner under READ COMMITTED. The problem is that its `int` result (1 = inserted, 0 = deduplicated) is thrown away, and `fanOut()` runs on both paths once the pre-check has missed. If two sends with the same `clientMsgId` overlap, the loser queues a second `CHAT_MESSAGE` push to the recipient and sends a second `chat.message` frame. This can happen when a reconnecting app resends on a new socket while the old socket's frame is still being processed. The contract says "A dedup resend queues nothing new" (comms-v1.yaml:62). The UC-S-13 test (`ChatIntegrationTest.java:313`) only covers the sequential resend.
- **Fix Suggestion:** `int inserted = insertIfAbsent(...)`. Call `fanOut` only when `inserted == 1`. Otherwise take the existing echo-only branch (`publish(List.of(userId), messageFrame(..., true))`).

### B-W2 — Two admins acknowledging the same SOS at once: the second overwrites the first (Backend)
- **Category:** Correctness / audit integrity
- **Severity:** Warning
- **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/service/SosServiceImpl.java:136-157`; `SosEvent` has no `@Version`
- **Rationale:** `acknowledge` reads the row, checks `acknowledgedAt == null`, then sets it, with no lock or version. The V15 trigger allows the handling fields to change. When two `support:handle` admins act on the sticky toast at the same moment, both get 200 and the later write replaces `acknowledged_by`/`acknowledged_at`/`note`, so the first handler's note is lost. Both are audited, so the trail survives, but the contract's `409 already_acknowledged` is not guaranteed.
- **Fix Suggestion:** Use a conditional update: `UPDATE sos_events SET … WHERE sos_event_id = :id AND acknowledged_at IS NULL`, and treat 0 rows (when the event exists) as `409 already_acknowledged`. `findById` with `PESSIMISTIC_WRITE` also works.

### B-W3 — Non-party share-link creation returns 404, the contract says 403 (Backend)
- **Category:** Contract conformance
- **Severity:** Warning
- **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/service/ShareServiceImpl.java:61-68` vs `backend/docs/api/comms-v1.yaml:212`; the test pins 404 at `ShareIntegrationTest.java:88`
- **Rationale:** `create` filters the ride by party and throws `ResourceNotFoundException`, so a stranger gets 404. The contract (and the controller Javadoc, `ShareController.java:353`, "403 not a party") says 403. Chat and SOS do return 403. 404 is arguably the safer answer (it does not reveal the ride exists), but contract, Javadoc and behaviour disagree.
- **Fix Suggestion:** Choose one. Either return `ForbiddenException` like chat/SOS, or change the contract and Javadoc to 404. Keep the test in step.

### B-W4 — SOS push waits in the same FIFO outbox as chat pushes, with no priority (Backend)
- **Category:** Performance / safety latency
- **Severity:** Warning
- **Certainty:** Medium
- **Location:** `backend/src/main/java/com/labby/backend/repository/NotificationOutboxRepository.java:33` (`ORDER BY created_at`); `NotificationDispatchServiceImpl.java:27,35-44`; `FcmPushSender.java:80`
- **Rationale:** The dispatcher sends one entry at a time in FIFO order, 200 per pass, with a synchronous FCM `sendEachForMulticast` call for each. M10 now queues a push for every chat message, so outbox volume grows with chat traffic, and a `safety` entry waits behind every older entry. At demo scale this adds nothing. When a backlog builds (an FCM slowdown, or a chat burst across many rides), the SOS push is delayed by the whole backlog. A pass is also a single run on Spring's default one-thread scheduler (no `spring.task.scheduling.pool.size` override) that it shares with the 1 s ride-dispatch job. The ticket's intent is "SOS is instant to admins".
- **Fix Suggestion:** Order safety first in `findPendingIds`, e.g. `ORDER BY (event = 'sos.triggered') DESC, created_at`. Optionally also start a dispatch pass after the SOS commit (`@TransactionalEventListener(AFTER_COMMIT)` → async `dispatchPending`), and set a scheduler pool size larger than 1.

### R-W1 — Initial load / reload replaces the message list, dropping live frames that arrived in flight (Rider app)
- **Category:** Correctness (race)
- **Severity:** Warning
- **Certainty:** Medium
- **Location:** apps/rider/src/chat/use-chat-thread.ts:197 (`setMessagesSynced(page.items)`), also reached via `reload` (:420-423)
- **Rationale:** the live subscription (:285) is active from mount, so a counterpart `chat.message` that
  arrives while `getChatMessages` is in flight is appended to `messagesRef`, then overwritten when the page
  resolves. If the page was read before the message was committed, the message disappears until the next
  reconnect (and even then only if it is newer than the anchor — it is, so H1's fix alone does not help
  without a reconnect).
- **Fix Suggestion:** merge `page.items` with what is already in `messagesRef` (dedup by messageId, keep
  sentAt order) instead of replacing.

### R-W2 — A pending (unacked) quick reply renders as an empty bubble (Rider app)
- **Category:** Correctness / UX
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/rider/src/screens/chat/chat-screen.tsx:500-508 (`text={item.body ?? ""}`); PendingMessage for a quick reply has only `quickReplyCode` (use-chat-thread.ts:384)
- **Rationale:** tapping a quick-reply chip shows a blank purple bubble with "Sending…" until the echo
  arrives — and indefinitely while offline (it stays queued until the next `ready`). The test "sends a
  quick reply as kind quick_reply with its code" checks only the frame, not the rendering.
- **Fix Suggestion:** render pending quick replies from the catalog (`chat.quickReplies.find(code)` →
  `quickReplyText(…, locale)`); assert the chip text in the pending bubble in the test.

### R-W3 — "Load earlier messages" immediately scrolls the thread back to the bottom (Rider app)
- **Category:** Correctness / UX
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/rider/src/screens/chat/chat-screen.tsx:83-93 (effect keyed on `messageCount`), together with use-chat-thread.ts:397 (prepend)
- **Rationale:** prepending an earlier page increases `messages.length`, so the effect calls
  `scrollToEnd()` — the rider never sees the earlier messages they asked for without scrolling back up
  past them. Load-earlier has no test.
- **Fix Suggestion:** key the auto-scroll on the newest message id (`messages.at(-1)?.messageId` + pending
  length), not the total count; add a load-earlier test.

### R-W4 — Quick-reply chips are 44 px tall (below the 48 px touch-target rule) (Rider app)
- **Category:** Design language / accessibility (CLAUDE.md "touch targets ≥ 48 px", NFR-U2 one-tap)
- **Severity:** Warning
- **Certainty:** Medium (the approved RiderChat artboard could not be opened from this audit; if the artboard itself specifies 44, this becomes a canvas question)
- **Location:** apps/rider/src/screens/chat/chat-screen.tsx:694-703 (`chip: { height: 44 … }`)
- **Rationale:** every other new control here uses `touchTarget` (48): send, call, back, SOS pill. The
  chips are the one-tap path of CHAT-02.
- **Fix Suggestion:** `height: touchTarget` (or `minHeight: touchTarget` with `hitSlop`), borderRadius 24.

### R-W5 — SOS POST waits up to 4 s for a fresh GPS fix before it is even sent (Rider app)
- **Category:** Correctness / safety latency (SAFE-01, milestone AC "SOS is … instant to admins"; T6 asks for an SOS path latency check)
- **Severity:** Warning
- **Certainty:** Medium
- **Location:** apps/rider/src/screens/ride/safety-actions.tsx:58 (`SOS_GPS_TIMEOUT_MS = 4000`), :80-104, :111-112
- **Rationale:** the dialer correctly opens first (synchronous `Linking.openURL`), but `fireSosEvent`
  then awaits `getCurrentPositionAsync({accuracy: Balanced})` for up to 4 s before calling `sendSos` —
  while the app has just been backgrounded by the dialer. The last-known position (usually seconds old on
  an active ride) is consulted only after the timeout. The pickup fallback is an approved deviation; the
  4 s pre-send wait is not recorded as a ruling.
- **Fix Suggestion:** read `getLastKnownPositionAsync` first (or race it with a much shorter fresh-fix
  timeout, ~1 s) and send immediately; keep pickup as the last resort. Assert in a test that the POST is
  issued without waiting for a hung `getCurrentPositionAsync`.

### R-W6 — Exception/alternate paths of UC-S-13/16 are untested on the rider (Rider app)
- **Category:** Tests
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/rider/src/screens/chat/__tests__/chat-screen.test.tsx, apps/rider/src/screens/ride/__tests__/safety-actions.test.tsx (grep for `reopened`, `invalid_message`, `chat-load-earlier`, `getLastKnownPositionAsync`, `chat_not_open` in tests returns nothing)
- **Rationale:** T3 AC is "UC-S-13…16 flows + exceptions against mocks". Missing: `reopened` window
  (UC-S-13 A2 — writable + call shown), `invalid_message` → send-failed banner, `chat_not_open`,
  load-earlier, empty-history reconnect (H1), SOS GPS fallback chain (timeout → last known → pickup — the
  accepted deviation's own behaviour), SOS with no region emergency number (`tel:` + no-number copy).
  Every SOS test grants a resolving GPS fix (safety-actions.test.tsx:92).
- **Fix Suggestion:** add one focused test per path above.

---

### D-W1 — A chat push for another ride opens the active ride's thread, and banners are hidden for the wrong ride (Driver app)
- **Category:** Correctness
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/driver/src/chat/ChatProvider.tsx:149; apps/driver/src/components/chat/chat-screen.tsx:132-148
- **Rationale:** `rideId = activeRideId ?? focusedRideId`, so the active ride always wins. Take this case: the rider of ride A (ended, still in its 24 h tail, e.g. a lost item) messages the driver while the driver is on ride B. The driver taps the push and lands on `/chat?rideId=A`. `focusThread(A)` runs, but the screen still renders B's thread: B's rider name, B's messages and B's composer. At the same time `shownRideId = paramRideId ?? chatRideId` registers A in `setOpenChatRideId`. The result is that A's later pushes are silenced as "already on screen" while A's chat is not visible, and B's pushes still show banners although B's chat is the one on screen. A's message is never shown, and a reply typed there goes to B's rider. The ChatProvider header comment says a deep link "can focus another ride's thread". That only works when no ride is active.
- **Fix Suggestion:** When the screen has an explicit `rideId` param, the param should win: either let the provider prefer `focusedRideId` while the chat screen holds a focus, or load a param thread separately. Derive `setOpenChatRideId` from the thread that is actually rendered (`chat.rideId`), not from the param. Add a test for a deep link to ride A while ride B is active.

### D-W2 — The chat screen spins forever when the ride leaves the active set while the chat is open (rider cancels) (Driver app)
- **Category:** Correctness
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/driver/src/chat/ChatProvider.tsx:304-317; apps/driver/src/components/chat/chat-screen.tsx:199-201; apps/driver/src/rides/DriverRideProvider.tsx:277-281
- **Rationale:** `applyRide` sets `ride` to null as soon as a ride stops being active for the driver: `cancelled_by_rider`, or a settled completion. When the chat was opened from the ride sheet (`router.push("/chat")` with no param), `focusedRideId` is null. The ride-change effect then resets the thread and sets `status: "idle"`, and the screen maps `idle` to `LoadingState` with nothing that ever leaves it. A very common moment to be in the chat is when the rider writes "sorry, cancelling" and cancels. The driver then sees an endless spinner instead of the thread. Under the owner ruling of 2026-10-13, that thread stays writable for 24 h after the cancellation.
- **Fix Suggestion:** When the active ride ends, keep the ended ride's id as the focused thread (for example, set `focusedRideId` to the previous `activeRideId` on that transition), so the chat stays on screen and moves through the server's `windowState`. Add a test: chat open, then `ride.cancelled` arrives, and the thread is still rendered.

### D-W3 — Messages sent while the driver is offline (no socket) stay on "Sending…" forever with no feedback (Driver app)
- **Category:** Correctness / UX
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/driver/src/realtime/AvailabilityProvider.tsx:296 (`shouldStream = active && online && gps === "granted"`); apps/driver/src/chat/ChatProvider.tsx:363-378; apps/driver/src/components/chat/chat-screen.tsx:98-100
- **Rationale:** The driver's only realtime socket is the location streamer, and it runs only while the driver is online with GPS granted. `chat.send` is WS-only in comms-v1, and there is no REST send. The window stays open for 24 h after the ride, and a chat push deep-links the driver into a writable composer even when they have gone offline. Every send there queues with `pending: true` and waits for a `connected` event that only comes when the driver goes online again. The screen shows "Sending…" indefinitely with no hint of why. This touches the UC-S-13 24 h-tail path; for the counterpart, UC-S-13 E1 is fine because the message is just never sent. The contract text says "both apps keep their socket open in the background", which does not hold for an offline driver.
- **Fix Suggestion:** Owner decision needed. Options: (a) show a "Go online to send" notice and disable the composer while `availability.stream === "idle"`; (b) open a chat-only socket while a writable thread is focused; or (c) add a REST send to comms-v1. At minimum, do not show a writable composer that cannot deliver.

### D-W4 — One failed `GET /chat` at ride start hides Chat and Call for the rest of the ride (Driver app)
- **Category:** Correctness / Resilience
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/driver/src/chat/ChatProvider.tsx:230-241 (non-404 failure sets `status: "error"`, with no retry); apps/driver/src/components/ride/safety-actions.tsx:101-103,125,135
- **Rationale:** `SafetyRow` renders Chat only when `thread !== null` and Call only from `thread.counterpart.phone`. A transient failure of the first `loadThread` (5xx, timeout, flaky mobile data right at acceptance) leaves `thread = null` with no retry. The only recovery is a socket reconnect (`connected` resync) or a background-to-foreground cycle. Live `chat.message` frames from the rider still append and increment `unread` (lines 439-466), but there is no entry point to read them. Losing CALL-01 for the whole ride is the most serious part, since the driver relies on it to find the rider at pickup.
- **Fix Suggestion:** Retry `loadThread` with a short backoff while `status === "error"` and a ride is active, and/or when a `chat.message` frame arrives for the current ride while `thread` is null.

### D-W5 — The quick-reply catalog is fetched once per session and never retried, so NFR-U2 is lost after one failure (Driver app)
- **Category:** Correctness (T3 AC: NFR-U2)
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/driver/src/chat/ChatProvider.tsx:324-341
- **Rationale:** `getQuickReplies()` runs only when `active` flips to true, which is normally once, at app start. If that one request fails (the app is started with no signal, or the backend is briefly down), `catch(() => {})` leaves the grid empty until the app restarts or the driver signs out and back in. The composer survives, but the T3 acceptance criterion is "quick replies one-tap while driving (NFR-U2)", and typing while driving is exactly what NFR-U2 is meant to avoid.
- **Fix Suggestion:** Re-fetch when a thread loads and the catalog is still empty (or on `connected` / foreground), and keep the session cache once it succeeds.

### D-W6 — Several T3 exception paths and the shared-socket changes have no tests (Driver app)
- **Category:** Tests
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/driver/src/__tests__/chat-screen.test.tsx, safety-actions.test.tsx, location-streaming.test.ts (no hits for `chat_closed`, `chat_not_open`, `invalid_message`, `sosBodyNoNumber`, `sendFrame`)
- **Rationale:** None of these is covered:
  - the WS error handling in ChatProvider.tsx:482-507 (`chat_closed` flips to read_only and hides the phone; `chat_not_open` / `not_in_ride` reload; `invalid_message` drops pending sends);
  - the SOS fallback to the pickup point without a GPS fix (sos.ts:447-458), which is an owner-accepted behaviour;
  - the alert-only SOS sheet when the region has no number;
  - the new `LocationStreamer.sendFrame` gate (`authenticated` only) and the pass-through of unowned `error` codes (location-streamer.ts:157-160, 300-309). Here the M6 suite still asserts only `invalid_sample` drop and `not_online` / `not_driver`, with nothing pinning that chat codes are forwarded and not reported as rejections;
  - the RTL layout of the chat (the AR test checks text only, not the mirrored bubble sides, row order or input alignment), although the T3 AC lists "RTL verified".
- **Fix Suggestion:** Add focused tests for each path: three WS-error cases, the no-GPS and no-number SOS cases, two streamer unit cases (sendFrame before/after `ready`; a `chat_closed` error goes to `onEvent`, not `onRejected`), and one AR layout assertion (own bubble aligned start / flipped rows).

---

### A-W1 — Live-ops polling does not pause in a hidden tab (contradicts its own docstring) (Admin app)
- **Category:** Correctness / efficiency
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/admin/src/pages/liveops/use-live-ops.ts:69-76 (hidden branch schedules `load()` after 15 s unconditionally); docstring :29-34 ("pausing while the tab is hidden")
- **Rationale:** When the tick finds the tab hidden it schedules `load()` 15 s later without re-checking visibility; that load fetches, schedules the next 5 s tick, which again defers 15 s — a hidden tab keeps polling every ~20 s indefinitely. The visibility listener already resumes on return, so the deferred load is unnecessary. (Distinct from the M9 surge backlog item; this is a new hook.) No test covers the timer lifecycle.
- **Fix Suggestion:** In the hidden branch, just return (leave `timer` cleared) and rely on the `visibilitychange` listener; add a fake-timer test for hidden/visible/unmount.

### A-W2 — SosAlertsProvider re-polls and resets its 30 s timer on every route change (Admin app)
- **Category:** Correctness / efficiency
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/admin/src/sos/SosAlertsProvider.tsx:100 (`refresh` deps include `navigate`), :102-129 (effect deps `[enabled, refresh]`)
- **Rationale:** With `<BrowserRouter>` (App.tsx:38), react-router 6.30's `useNavigate` returns a new function whenever `location.pathname` changes (node_modules/react-router/dist/index.js:242). The provider sits in the layout above `<Outlet>`, so every in-app navigation (and language switch, via `t`/`i18n.language`) tears down and re-creates the interval and fires an immediate `GET /admin/sos-events`. Combined with focus + visibilitychange both firing on tab return, requests overlap with no ordering guard; a late older response can overwrite `seen`/`openEvents` (stale badge after an acknowledgement until the next poll, or a re-toast of an already-seen alert).
- **Fix Suggestion:** Keep `navigate`/`t`/`show` in refs (or build the toast in a stable callback) so the polling effect depends only on `enabled`/`apiClient`; add a request generation counter like `useLiveOps` has.

### A-W3 — Grouped-chip pagination is not newest-first across pages and page size varies up to 5× (Admin app)
- **Category:** Correctness (UC-A-18)
- **Severity:** Warning
- **Certainty:** High
- **Location:** apps/admin/src/pages/rides/rides-search.ts:9-15 (claim), :50-60 (`mergePages`); RidesPage.tsx:156-161
- **Rationale:** Page n of a grouped chip = union of each member state's page n. If `in_progress` has 100 recent rides and `requested` has 30 old ones, page 1 shows 25 recent + 25 old rows, while newer `in_progress` rides appear only on pages 2–4: the list is not chronological across pages, and a page holds up to 25 × members rows (125 for Active). No rows are lost and totals are right, but the ordering the comment promises does not hold. Also the `totalPages` doc says "Zero-based count of pages" (:45) — it is a plain count.
- **Fix Suggestion:** Accept and document (the backend single-state filter is the root cause — a multi-value `state` filter on /admin/rides is the real fix, candidate for the T6 backlog), or fix the comment so it does not claim a correct newest-first order.

### A-W4 — Route label arrow points the wrong way in Arabic (RTL) (Admin app)
- **Category:** i18n/RTL
- **Severity:** Warning
- **Certainty:** Medium
- **Location:** apps/admin/src/pages/rides/ride-format.ts:34-41 (used RidesPage.tsx:336)
- **Rationale:** `routeLabel` emits a fixed `"A → B"` string; the comment says "RTL-safe arrow via CSS order" but no CSS reorders it (it's one text node in `.table__muted`). In an RTL row, pickup renders on the right and `→` points back at it, reading destination→pickup. The existing pattern flips the glyph (DriverApplicationDetailPage.tsx:268 uses `i18n.dir() === 'rtl' ? '←' : '→'`).
- **Fix Suggestion:** Pass the direction (or `i18n.dir()`) and use `←` in RTL, matching the existing pattern; fix the misleading comment.

## Info (max 5)

### B-I1 — Share page hardening: no Referrer-Policy or CSP, and the timing claim is overstated (Backend)
- **Category:** Security hardening / docs
- **Severity:** Info
- **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/controller/ShareController.java:187-195,380-384`; `ShareServiceImpl.java:35-37`; `comms-v1.yaml:75-76`
- **Rationale:** The page loads Google Fonts, unpkg and OSM tiles while the capability token sits in its path. Modern browsers default to `strict-origin-when-cross-origin`, so the token does not leak today, but nothing enforces that. The contract and Javadoc say unknown and dead tokens are "indistinguishable in timing … without revealing which". The status codes differ by design (404 vs 410), and the 410 path does an extra ride lookup. This does no harm with 256-bit tokens, but the claim is wrong.
- **Fix Suggestion:** Add `<meta name="referrer" content="no-referrer">` (or a `Referrer-Policy: no-referrer` header) and a tight CSP on `/share/*`. Remove the timing sentence.

### B-I3 — Two concurrent share-link creates produce a 500 (Backend)
- **Category:** Robustness
- **Severity:** Info
- **Certainty:** High
- **Location:** `backend/src/main/java/com/labby/backend/service/ShareServiceImpl.java:75-90`
- **Rationale:** The `exists…` check runs before `save`, so a double tap hits `uq_trip_share_links_ride_user`. `GlobalExceptionHandler` has no `DataIntegrityViolationException` mapping, so the generic handler logs "Unhandled exception" and returns 500 where the contract says `409 already_shared`.
- **Fix Suggestion:** Catch `DataIntegrityViolationException` on save and rethrow the `already_shared` `ConflictException`.

### B-I4 — Public share page is English-only (owner question) (Backend)
- **Category:** i18n
- **Severity:** Info
- **Certainty:** Medium
- **Location:** `backend/src/main/java/com/labby/backend/controller/ShareController.java:190,195,245-265,272-273,329-330`
- **Rationale:** CLAUDE.md asks for full EN + AR with RTL on every screen. The no-login page is hard-coded `lang="en"` with English strings only, and the people opening a shared trip in Syria are likely to read Arabic. The approved artboard may have been EN-only, so this is a question for the owner, not a defect.
- **Fix Suggestion:** Ask the owner. If AR is wanted, choose the language from `Accept-Language` (or `?lang=`) and set `dir="rtl"`.

### R-I1 — `invalid_message` drops the newest pending message, not necessarily the refused one (Rider app)
- **Category:** Correctness (contract limitation)
- **Severity:** Info
- **Certainty:** Medium
- **Location:** apps/rider/src/chat/use-chat-thread.ts:328-331
- **Rationale:** error frames carry no clientMsgId (comms-v1 `{"type":"error","code","message"}`), so with
  several queued resends after a reconnect the wrong item can be dropped while the refused one keeps
  showing "Sending…". Text is pre-capped at 1000 chars client-side, so this is rare (inactive quick-reply
  code). Worth a contract note (echo clientMsgId on chat errors) rather than client guessing.

### D-I3 — The SOS `recordedAt` is the GPS fix time, not the moment of the tap (Driver app)
- **Category:** Contract fidelity
- **Severity:** Info
- **Certainty:** Medium
- **Location:** apps/driver/src/safety/sos.ts:447-452
- **Rationale:** comms-v1 defines `recordedAt` as "the device moment" and serves it as `triggeredAt`. With a stalled fix (tunnel, GPS gap), admins would see the SOS time as minutes earlier than the tap.
- **Fix Suggestion:** Send `new Date().toISOString()` as `recordedAt` and keep the fix's coordinates.

+13 more nitpicks — ask to see them.

## Share-token security review

**Conclusion: sound.** No Critical or High issue. Hardening notes are I1, I2 and I3.

- **Entropy and generation:** 32 bytes from a static `SecureRandom`, URL-safe base64 without padding, 43 chars (`ShareServiceImpl.java:45-47,80-82`). Tested (`ShareIntegrationTest:64-66`).
- **Storage:** only the SHA-256 hex is stored (`token_hash CHAR(64)`, unique, V15). The raw token exists only in the 201 response. A database leak does not reveal live links. Unsalted SHA-256 is fine for a 256-bit random secret. Tested (`ShareIntegrationTest:68-78`).
- **Lookup:** an equality lookup on the hash through a unique index. Comparing a hash of the input, not the input itself, makes timing attacks pointless. 404 and 410 are different by design (I1).
- **Dead link stays dead:** liveness comes only from `ride.isAssigned()` (`ShareServiceImpl.java:103-106`). Terminal states (completed / cancelled_by_* / no_driver_found) are final, and a redispatch is a new ride id, so a dead link can never come back. No clock is involved.
- **JSON leakage:** `SharePageDto` returns status, driver first name, photo url, vehicle model/color/plate, position (null when stale), ETA, refreshSeconds. No phones, rider identity, fare or ride id; the url does not contain the ride id (tested). The one leftover is the driver UUID inside the signed photo token (I2).
- **HTML page / XSS:** a constant string. The token is never interpolated (the page reads `location.pathname`, and the test asserts the body does not contain the token). Every server value is set with `textContent` or `img.src`. The Leaflet `divIcon` html is a fixed literal. Leaflet JS/CSS are SRI-pinned. No XSS path found. No CSP or Referrer-Policy (I1).
- **Caching:** the default Spring Security header writer is still on (not disabled in `SecurityConfig`), so `/api/v1/share/*` and `/share/*` get `Cache-Control: no-cache, no-store, max-age=0, must-revalidate`, `X-Content-Type-Options` and `X-Frame-Options: DENY`. `noindex` meta is set.
- **Logs:** no request-URI logging anywhere. `GoneException` and `ResourceNotFoundException` messages carry no token. The generic 500 handler logs the stack, not the path. Tokens are not logged.
- **AuthZ on create:** party-only and active-accepted-only, one link per user per ride. Non-party gets 404 vs the contract's 403 (W3). A double tap returns 500 (I3).
- **Public surface:** `permitAll` covers only `/api/v1/share/*` and `/share/*`, one path segment each.


## SOS latency

Path traced: `POST /rides/{id}/sos` (`SosController.java:261-266`) → `SosServiceImpl.trigger` (`:59-101`), one transaction:
1. `rideRepository.findById` (PK).
2. `sosEventRepository.saveAndFlush` (one insert).
3. `findActiveAdminIdsWithPermission('support:handle')` (one join query, `RbacPermissionRepository`).
4. One `notification_outbox` insert per support:handle admin (`NotificationServiceImpl.java:22-29`, no external call).
Then commit. **No N+1, no external or network call inside the transaction.** Response time is a few milliseconds of database work.

Getting to admins:
- **Push:** `NotificationDispatchJob` cron `*/5 * * * * *` (`application.yml:97`). An entry waits **0–5 s** for the next pass, then `prepare` (its own transaction) plus a **synchronous FCM** `sendEachForMulticast` (`FcmPushSender.java:80`). **Typical push latency is about 1–6 s.** Worst case has no bound: FIFO `ORDER BY created_at` (`NotificationOutboxRepository.java:33`), serial 200-entry passes (`NotificationDispatchServiceImpl.java:27,35`), and the default single scheduler thread shared with the 1 s ride-dispatch job (`application.yml:126`) and the 5 s ride monitor (`:127`). See W4. Only admins with a live session and a registered admin web token receive it (M6 rule).
- **Live map red pin and ride `sosOpen`:** visible on the next live-ops poll, **≤ 5 s** (`refreshSeconds`, `LIVEOPS_REFRESH_SECONDS`; admin `use-live-ops.ts` pauses while the tab is hidden). The snapshot runs a fixed number of queries: region exists, active rides, open SOS ride ids (one IN query), fresh drivers (one join), surge state (stored zones), open SOS by region plus a batched `adminViews` (2 `findAllById`). No N+1.
- **Alert list badge and toast on other admin pages:** `SosAlertsProvider.tsx:25` polls every **30 s**, skips while hidden, and refreshes at once on focus. Push is what makes it fast here.
- **Bottom line:** an admin looking at the live map sees the pin within 5 s. A support:handle admin with web push gets the alert in about 1–6 s at demo scale. An admin on another page without push could wait up to 30 s.


## What's good
- **Backend:** the chat window is derived (never stored) and closed on every terminal path; the dedup insert is race-safe; frames go out only on commit via `pg_notify`; the ride-critical mute bypass is narrow; SOS permanence is enforced in the database; the alert fan-out targets exactly `support:handle` and is tested against negative admins; the share JSON is exactly SHARE-02 and the HTML never interpolates data.
- **Rider:** frames match comms-v1; ride/chat facades are cleanly split; dialer opens before the SOS POST; share URL persisted and reused; cold-start deep link proven with a real-router test; EN/AR parity and a11y labels on icon buttons.
- **Driver:** the shared location socket did not regress M6/M7 behaviour; dedup + resend matches the backend; SOS never blocks the dialer with exactly one retry; red used for SOS only.
- **Admin:** no XSS path through Leaflet (user text only via React tooltip children); no data fetched without the matching permission; API types match comms-v1/rides-v1; the live-ops hook drops out-of-order responses; EN/AR key parity with Western digits.

## Pre-existing (out of scope, non-blocking)
- Known backlog carried in the tracker: admin SOS-filter workarounds (server filters missing), share-page Arriving tile minutes only, rider ride-card driver photo URL (`ride-parts.tsx:152-155`, M7), SYP estimates showing decimals.
- B-I5 duplicated keyset paging predates M10 in `NotificationCenterServiceImpl`.

## Test run results
- Backend `make check` on 92933f8 (2026-10-15, sequential, laptop idle): **447 tests, 0 failures, 0 errors** — BUILD SUCCESS.
- Rider `npm run check`: lint + tsc clean, **335 passed**.
- Driver `npm run check`: 0 lint errors (3 pre-existing warnings in `heatmap-units.test.tsx`), tsc clean, **379 passed**.
- Admin `npm run check`: **291 passed** (last run on 3e6bb01; `apps/admin` unchanged since).
- CI on 92933f8: run 38743887304 — **success** (all four jobs).
- Reviewers ran no additional suites; every High was re-checked by reading the cited lines.

---

## Resolution — /labby-fix round 1 (2026-10-15)
Owner rulings 2026-10-15 (all as recommended): A-H1 Support gets `regions:view` (V16); B-H1 the SOS caller phone on `/admin/sos-events` and the live-ops feed only with `support:handle`; B-H2 quick replies requested with `?as=rider|driver` (that side + `both`), cross-side codes refused; D-W3 offline driver in the 24 h tail sees "Go online to chat" instead of the composer; B-I4 public share page in Arabic from Accept-Language. Every finding was re-validated against the live code first — no false positives.

| Finding | Resolution |
|---|---|
| B-H1, B-H2, B-W1, B-W2, B-W4, B-I1, B-I3, B-I4, A-H1 (V16) | fixed in the backend (contract comms-v1 amended: required `as`, nullable caller phone, 404 share create, SOS-first dispatch + post-commit pass, share-page CSP/no-referrer/Arabic) |
| B-W3 | resolved by aligning contract + Javadoc to the existing, safer 404 (no behaviour change) |
| R-H1, R-W1..R-W6, R-I1 | fixed in the rider app (+ `?as=rider`) |
| D-W1..D-W6, D-I3 | fixed in the driver app (+ `?as=driver`) |
| A-H1 (client), A-H2, A-H3, A-W1..A-W4 | fixed in the admin app (+ nullable caller phone) |
| 13 unlisted nitpicks | backlog (unchanged) |

New follow-up noted (backlog, contract change): chat WS error frames should echo the refused `clientMsgId` so clients need not infer which send was refused. Scheduler pool is now 4 threads (`SCHEDULER_POOL_SIZE`) — different scheduled jobs may run concurrently (each job still never overlaps itself); flagged for the re-audit.

Gates after the fixes (sequential, 2026-10-15): backend `make check` 457 · rider 349 · driver 394 (3 pre-existing lint warnings) · admin 305 — all green. Next: re-audit of the fix range.

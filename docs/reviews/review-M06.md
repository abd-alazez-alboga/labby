# Review — M6 Realtime infrastructure (`6f979ee..f7b6b67`)
_14 commits (`5d4de62` M5 closure, then `a6397dd` T1, `2ec67d5` T4, `3a8f413` M5 race fix, `5d3fe1e` T2, `e4d4d99` T3, `e6df4c8` EAS build, then T5 device-run fixes `f9e652d`, `fe006b5`, `a5b0e6e`, `bd5808d`, `41f977d`, `dfeecf9`, `f7b6b67`) · 245 files · reviewed 2026-10-07_

## Summary

M6 adds a contract-first realtime layer (`realtime-v1.yaml`, migration V7). The backend gets an outbox-driven notification dispatcher that stores the center row before any push, an FCM sender with dead-token pruning, a WebSocket GPS channel with in-protocol auth, availability gates, and an OSRM routing provider with a straight-line fallback. All three clients get maps, a notification center and preferences, and push registration. The driver app also gets a well-built reconnecting location streamer. The backend design and its tests are strong: real WebSocket tests for auth, re-auth, revocation, expiry and malformed frames; a 100-driver load test; stale detection on a controlled clock; and an OSRM-blocked fallback test. All four gates are green and the history in the range contains no secrets.

Two High findings block a pass. First, push delivery is never tied to session revocation. A device token survives logout-by-revocation, a password reset, refresh-token-theft detection and account deletion, so a revoked or attacker's device keeps receiving the account's pushes. Second, the rider app has no FCM config, so a native rider build cannot register for push at all. There are six Warnings. The driver map sends no Referer to the OSM tile servers, which contradicts the recorded T4 decision. The owner-deferred items (iOS push, background location) have no landing ticket. The battery-conscious streaming choices are documented only as a one-line code comment. The dispatcher can double-push when more than one instance runs. The tracker has drifted. The FCM runtime-classpath fix has no regression test.

**Verdict:** Fail
**Findings:** Critical 0 · High 2 · Warning 6 · Info 5 · Praise 5

## Acceptance criteria

### M6-T1 — Realtime contract & migrations

| Criterion | Status | Evidence |
|---|---|---|
| Contracts reviewed against NTF/TRK SRS rows | met | `realtime-v1.yaml` header maps NTF-01..03, TRK-01/04, DRV-05, ES-03/04 and NFR-A3 to concrete rules. It follows UC-D-04 E2 rather than the looser ticket wording: online is allowed and `offersBlockedReason` explains why no offers come (M8). Locked categories return 400. The push data keys were amended after T2 and match `NotificationDeliveryWriter.pushMessage` |
| Migrations clean | met | `V7__realtime.sql` applies on the PostGIS Testcontainer. `RealtimeMigrationIntegrationTest` has 6 tests: one center row per outbox row (`uq_notifications_outbox`), ride/safety lock CHECK, unique token, `ck_driver_profiles_online_approved`, sample sanity CHECKs, entity round-trip including the SRID-4326 point |

### M6-T2 — Notifications backend

| Criterion | Status | Evidence |
|---|---|---|
| Pref filtering | met | `NotificationsIntegrationTest.shouldHonourPreferencesAndLockCriticalCategories` (muted → `muted`, still in the center); `NotificationDeliveryWriterTest.shouldMuteMutableCategory` |
| Critical override | met | `NotificationDeliveryWriterTest.shouldNeverMuteCriticalCategories`; DB CHECK `ck_notification_preferences_locked`; API 400. No ride/safety event exists yet, so this is proven at unit and DB level only |
| Localization | met | `shouldLocalizePushAndCenterByUserLanguage`; `NotificationRendererTest` (4 tests, Arabic day agreement, brand لبي) |
| Center pagination | met | `shouldPaginateNewestFirst` (keyset cursor, category filter); `shouldIsolateAudiences`; `shouldHideOtherUsersNotifications` (404) |
| FCM failure leaves the center record intact (NFR-A3) | met | `shouldKeepCenterRowWhenPushFails`; `prepare` and `complete` are separate `REQUIRES_NEW` transactions with the push between them (`NotificationDeliveryWriter.java:91-160`) |

### M6-T3 — Tracking & routing backend

| Criterion | Status | Evidence |
|---|---|---|
| Load-shaped test: 100 simulated drivers streaming without backlog | met | `RealtimeSocketIntegrationTest.shouldIngestHundredConcurrentStreamsWithoutBacklog`: 100 sockets × 3 samples, every latest fix stored in under 5 s, no error frames |
| Stale detection proven on a controlled clock | met | `DriverAvailabilityIntegrationTest.shouldDetectStaleStreams` (`@TestBean Clock`): still healthy exactly at 30 s, flagged at 31 s, recovers when samples resume, offline is never streaming |
| Fallback activates when OSRM is blocked in test | met | `RoutingIntegrationTest.shouldFallBackWhenOsrmIsBlocked` (OSRM URL set to the discard port); `OsrmRoutingProviderTest` (6) |

### M6-T4 — Clients: maps, streaming, notification center

| Criterion | Status | Evidence |
|---|---|---|
| Toggle online → position visibly updates on a dev map | met | T5 record (owner's phone, samples about every 5 s); `availability-toggle.test.tsx`, `location-streaming.test.ts`, `osm-map.test.tsx` |
| Center shows history after reinstall | met | The centers read only from `GET /notifications?app=…` (server-side store, no local cache) in all three clients |
| Push deep-links open the right screen | met | Device: `driver_documents` push → My documents (T5 record). Tests: `push-deep-links.test.tsx` (driver), `deep-links.test.ts` + `push-lifecycle.test.tsx` (rider), `deep-links.test.ts` (admin) |
| Component tests green | met | admin 29 files / 187, driver 21 / 181, rider 24 / 139 |
| (scope) "background-capable location per platform rules" | not delivered | Foreground-only by an owner-informed decision (tracker T4 record). The stated blocker, needing a dev build, no longer applies. No landing ticket (W2) |

### M6-T5 — Realtime integration (Firebase credentials)

| Criterion | Status | Evidence |
|---|---|---|
| Real push received on both platforms | partial | Android proven with the driver app (emulator dev build, Arabic push, deep link). iOS deferred by owner decision (no Apple account, APNs token question). The rider app cannot obtain an FCM token in a native build (H2). Admin web push was never exercised |
| Full UC-S-25 alternates verified | met (automated) | A1 muted → center only, A2 FCM failure or no device → center row (`NotificationsIntegrationTest`). No device-run evidence for the alternates is recorded |
| Secrets only in env | met | `git log -p 6f979ee..HEAD` contains no key or service-account material. Credentials come only from `FIREBASE_CREDENTIALS_PATH`/`_JSON` (`PushConfig`), `GOOGLE_SERVICES_JSON` (an EAS file secret), and `.gitignore` covers `google-services.json`, `firebase-service-account*.json` and `*firebase-adminsdk*.json`. `apps/admin/public/config.json` has no `firebaseWeb` block |

### M6-T6 — Review audit

| Criterion | Status | Evidence |
|---|---|---|
| Battery-conscious streaming choices documented | partial | A single code comment (`location-streamer.ts:42`); nothing in the driver README (W3) |
| Findings resolved; tracker `review_passed` | unmet | This audit: Fail |

### Milestone acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Push + center + prefs behave per NTF-01…03 on real devices | partial | Driver on Android: push, center and deep link proven. iOS deferred (owner). Rider push is not wired (H2). Push keeps flowing to revoked sessions (H1) |
| Live movement visible server-side at a 5 s cadence; silence > 30 s flags | met | T5 device run; `shouldDetectStaleStreams`; `DriverLocationService.streamingDriverIds()` is the seam M7 dispatch will read |
| Routing works through the provider seam with a working fallback | met | `RoutingProvider` → `OsrmRoutingProvider` (HTTP/1.1 pinned after `a5b0e6e`), fallback flagged `approximate`; real OSRM on Damascus in the T5 record |
| Tracker updated; review audit passed | unmet | Audit Fail; tracker drift (W5) |

## Critical

None.

## High

**H1 — Push delivery outlives session revocation and account deletion: a revoked device, including an attacker's, keeps receiving the account's pushes**
- Category: security · Severity: High · Certainty: High
- Location: `backend/src/main/resources/db/migration/V7__realtime.sql:56-69` (`device_tokens` has no session link); `backend/src/main/java/com/labby/backend/service/NotificationDeliveryWriter.java:116-121` (tokens chosen by user and app only); revocation paths that never touch tokens: `AuthServiceImpl.java:165` (refresh-token reuse, i.e. theft, revokes all sessions), `:180` (deleted account), `:238` (password reset), `MeServiceImpl.java:95-97` (password change and sign out of other devices), `MeServiceImpl.java:176` (account deletion)
- Rationale: A token leaves `device_tokens` only through the client's best-effort `DELETE /devices/{token}` on a voluntary logout, through FCM dead-token pruning, or when another account logs in on the same device. Nothing removes tokens when sessions are revoked server-side. Example: an attacker with a stolen refresh token registers their own FCM token on the victim's account. The victim resets their password, or reuse detection fires. The attacker loses API access but keeps receiving every push for that account indefinitely. The same applies to a lost phone the user signed out remotely, and to a deleted account's devices. The tracker's T4 note already said "backend should prune on revocation", but nothing was implemented or ticketed. Today the only pushes are driver account notices. From M7 on they carry ride, chat and later SOS content (NTF-01, NFR-S3 ownership).
- Fix Suggestion: Bind tokens to the session family. Store the access token's `sid` in `device_tokens.session_id` on `PUT /devices`. Carry it across rotation in `AuthServiceImpl.refresh`: `UPDATE device_tokens SET session_id = :new WHERE session_id = :old`, in the same transaction. Then either delete tokens in every revoke path or, more robustly, have the dispatcher's token query join `refresh_tokens … revoked_at IS NULL`. At a minimum, delete all of the user's tokens in the revoke-all paths (reuse detection, password reset, deletion). Add an integration test: register a token, reset the password, dispatch → `no_device`; repeat for account deletion.

**H2 — The rider app has no FCM config: a native rider build cannot get a push token, so rider push (NTF-01) cannot work on Android**
- Category: integration · Severity: High (trivially fixable in code; device proof pending) · Certainty: High
- Location: `apps/rider/app.config.ts:40-46` (no `googleServicesFile`; compare `apps/driver/app.config.ts`, which sets `googleServicesFile: process.env.GOOGLE_SERVICES_JSON`); `apps/rider/src/notifications/push-registration.ts:80-92`; `apps/rider/src/notifications/notifications-context.tsx:116-121`
- Rationale: On Android, `getDevicePushTokenAsync` needs the Firebase app that `google-services.json` initialises. Without it the call throws, `registerForPush` returns `'failed'`, and nothing is logged or retried. The owner supplied `google-services-rider.json` (tracker), but it was never wired. T5 proved push with the driver app only, and the rider is the main audience for ride pushes in M7. Also, the rider registers once per mount. Unlike the driver's `PushBridge`, it never retries on foreground, so a permission granted later in Settings is only picked up after an app restart.
- Fix Suggestion: Mirror the driver: `android: { …, googleServicesFile: process.env.GOOGLE_SERVICES_JSON }` in `apps/rider/app.config.ts`, document it in the rider README, and set the EAS/local env var. Retry `registerForPush` on foreground without prompting (the driver's `prompt: false` pattern). Prove one rider push on the emulator with a rider- or `all`-audience event, either now with a test outbox row or as an explicit M7-T* acceptance criterion.

## Warning

**W1 — The driver map WebView has no base URL, so OSM tile requests carry no Referer; this contradicts the recorded T4 shared choice**
- Category: integration · Severity: Warning · Certainty: High (contradiction); Medium (the tile servers may refuse)
- Location: `apps/driver/src/components/map/osm-map.tsx:202` (`source={{ html }}`); compare `apps/rider/src/map/labby-map.tsx:138` (`baseUrl: \`${config.apiBaseUrl}/\``)
- Rationale: The tracker's T4 record says "the WebView page uses the API base URL as origin so OSM gets a Referer". Only the rider app does this. OSM's tile usage policy requires a Referer from browser-based clients, and a WebView page with no origin sends none. That risks 403s or blocking, which would show the driver the "tiles unavailable" banner.
- Fix Suggestion: `source={{ html, baseUrl: \`${getConfig().apiBaseUrl}/\` }}` in `osm-map.tsx`, and add a test asserting the base URL (like the rider's `labby-map.test.tsx`).

**W2 — Owner-deferred items have no landing ticket: iOS push (T5 AC) and background location (T4 scope; TRK-01 "whenever online")**
- Category: srs-conformance · Severity: Warning · Certainty: High
- Location: `docs/milestones/README.md:30,33`; `apps/driver/src/realtime/location-source.ts:5-17`; no `docs/milestones/M*.md` mentions APNs, iOS push or background location
- Rationale: Both deferrals are recorded as owner decisions, so this is not a conformance violation. But TRK-01 requires streaming "whenever online". Today a driver who locks the phone or switches apps goes stale after 30 s, and M7 dispatch (TRK-04) will drop them from offers. The foreground-only decision was justified by needing a native dev build. That build now exists (`e6df4c8`, local `expo run:android`), so the blocker is gone. With no ticket, both items can slip past M7 silently.
- Fix Suggestion: Add explicit tickets, for example M7-T0 (background `LocationSource`: `startLocationUpdatesAsync` + task manager + Android foreground service, behind the existing seam) and an iOS push ticket in the milestone where iOS ships (`@react-native-firebase/messaging` vs backend APNs). Reference both from the T5 row in the tracker.

**W3 — Battery-conscious streaming choices are documented only as a one-line code comment (T6 scope)**
- Category: structure · Severity: Warning · Certainty: High
- Location: `apps/driver/src/realtime/location-streamer.ts:42-43`; `apps/driver/README.md` "Realtime (M6-T4)" section (no battery discussion)
- Rationale: The comment lists one socket, small frames and 25 s pings. It does not mention the dominant cost, `Accuracy.High` at a 5 s `timeInterval` with `distanceInterval: 0` (`location-source.ts:32-37`). It also skips why the streamer suppresses fixes older than the stale window, the 15–30 s availability poll, and what the background source will need (foreground-service notice, OS batching). T6 asks for these choices to be documented, and they matter when the background source lands.
- Fix Suggestion: Add a short "Battery" subsection to the driver README covering GPS accuracy and interval, the absent distance filter (needed so a stationary driver stays fresh), the ping and poll cadences, stop-when-offline, and the trade-offs planned for the background source.

**W4 — The dispatcher pushes twice when more than one backend instance runs (NFR-P4)**
- Category: correctness · Severity: Warning · Certainty: High (from the code; a recorded single-instance assumption)
- Location: `backend/src/main/java/com/labby/backend/service/NotificationDeliveryWriter.java:91-134` (`lockPending … SKIP LOCKED` is released when `prepare` commits; a later `prepare` re-pushes a row still `pending`); `NotificationDispatchServiceImpl.java:46-67`
- Rationale: Instance A commits `prepare`, which releases the outbox row lock, and starts the FCM call. Instance B's run then locks the same undelivered entry, finds the center row still `pending`, and pushes again. The tracker records "single-instance assumption" for T2, so this is not unapproved. It is flagged because NFR-P4 says scaling must be "deployment work, not redesign", and the fix is cheap now.
- Fix Suggestion: Claim the row inside `prepare`: set `push_status = 'sending'` (add it to the CHECK) together with a claim timestamp, and treat a stale claim (for example older than 2 minutes) as retryable. Alternatively, mark the outbox entry delivered in `prepare` and have `complete` record only the outcome. Owner call whether to do it now or in the scaling work.

**W5 — Tracker drift**
- Category: structure · Severity: Warning · Certainty: High
- Location: `docs/milestones/README.md:21` (Firebase inputs still `pending`, though received 2026-10-06); `:28` ("Current milestone: M5 … Next up: M6 … starting with M6-T1"); `:30` (says the simultaneous-permission-prompt fix is "in progress" and the safe-area bug is "being fixed now", but both landed in `dfeecf9` / `f7b6b67`)
- Rationale: CLAUDE.md makes the tracker the cold-resume source of truth. A new session would believe the Firebase inputs are missing and that work is unfinished.
- Fix Suggestion: Mark the owner-inputs row received (env-only, location noted), rewrite "Current milestone" to M6 with T6 in progress or failed, and update the T5 record with the two fix commits.

**W6 — No regression test for the FCM runtime-classpath fix (`f9e652d`)**
- Category: tests · Severity: Warning · Certainty: High
- Location: `backend/src/main/java/com/labby/backend/config/PushConfig.java:39-72`; `backend/pom.xml` (explicit `httpclient5` compile scope and `google-http-client-jackson2`); tests only ever build `LoggingPushSender` (no credentials) or a mocked `FirebaseMessaging` (`FcmPushSenderTest`)
- Rationale: The missing `JacksonFactory` and httpclient5 runtime classes surfaced only on the live device run. A future dependency bump or mediation change would bring the failure back silently, and every push would then fail at boot or at first send.
- Fix Suggestion: Add a unit test that calls `new PushConfig().pushSender(new NotificationProperties("-", null, <fake service-account JSON with a test-generated RSA key>))` and asserts an `FcmPushSender` is returned. `FirebaseApp` initialisation is offline. Delete the named app in `@AfterEach`.

## Info (max 5)

1. **Stale comments and a dead branch in both `parsePushPayload` functions.** `apps/driver/src/notifications/deep-links.ts:77-79` and `apps/rider/src/notifications/deep-links.ts:76-78` say "the contract does not fix the FCM data keys (reported as a gap)" and also accept a nested `link` that the backend never sends. The contract now fixes `notificationId, category, event, screen, params` (`realtime-v1.yaml:20-23`). Update the comments and drop the `link` shape.
2. **The driver app creates no Android notification channel.** The rider creates `default` with HIGH importance (`apps/rider/src/notifications/push-registration.ts:55-61`), and the FCM message carries no `android.notification.channelId` (`FcmPushSender.java:56-63`). Driver pushes therefore land in the fallback channel, where heads-up banners may not show. The tracker already noted "channel id unspecified". Pick one channel id and set it on both clients and the server message.
3. **`POST /routing/route` is an unthrottled proxy to the public OSRM demo server** (`RoutingController.java:31`). Any authenticated account can use up the shared quota, after which every user gets `approximate` routes, and ES-04 notes the demo server's usage policy. Consider a per-user rate limit or a short cache before M7 fare estimates multiply the calls.
4. **A non-document suspension push deep-links to `driver_documents` while its body says "contact support"** (`NotificationRenderer.java:214-229`). `driver_application`, or no link, would fit better.
5. **Each authenticated socket queries session liveness every 5 s** (`RealtimeSocketController.java:260-261`), about 0.2 queries per second per online driver. That is fine at V1 scale. Note it for V2: cache it, or close sockets from the revocation path.

+2 more nitpicks — ask to see them.

## What's good

- **The NFR-A3 delivery split is the right shape.** The center row commits in its own transaction before any network I/O, the push runs outside any transaction, and the outcome plus delivery mark commit separately. Idempotency is enforced by a unique FK (`uq_notifications_outbox`) and a `SKIP LOCKED` claim, and the backfill of M5's queued rows came free.
- **The WebSocket protocol is specified and tested end to end.** Auth arrives in the first frame with nothing in the URL, re-auth to another account closes with 4401, revocation and expiry are detected within the check interval, a malformed frame closes with 4400 while a bad sample only gets an error frame, there is an idle close, and unknown types are ignored. Tests use real sockets against the full stack, including a short-lived signed JWT for expiry. A per-socket send decorator bounds slow consumers.
- **The client streamer is careful.** It refreshes the token about 60 s before `exp`, refreshes and reconnects on 4401 (and backs off if a fresh token is still rejected), uses jittered exponential backoff, replaces half-open sockets with a 25 s ping and 10 s pong watchdog, buffers the newest 20 fixes and flushes them over REST after `ready`, and never sends a fix older than the stale window so the server sees silence rather than fake freshness. Only the `LocationSource` seam needs replacing for background tracking.
- **The WebView bridge is hardened.** Leaflet is SRI-pinned, embedded JSON escapes `<` and U+2028/2029, the attribution is HTML-escaped, the driver blocks top-frame navigation, and tile and library failures surface as UI states (NFR-A3).
- **Secrets and i18n hygiene.** Firebase credentials are env-only, credentials that are set but unreadable fail the boot instead of silently dropping pushes, and the history in the range is clean. EN and AR are in exact key parity (admin 585/585, driver 379/379, rider covered by its parity test), the brand rename لبي is complete with no `لابي` left in sources, and the scans found no hard-coded UI strings in the new screens.

## Pre-existing (out of scope, non-blocking)

- The "expiry job per-item transactions" fix is the review baseline `6f979ee` itself. It was audited in the M5 resolution and is not in this range.
- The Jest suites are still load-sensitive (see Test run results). This is the M4/M5 backlog item "consider raising testTimeout".
- The rider `apiFetch` has no request timeout, so the new pre-revocation `unregisterPushToken` call (`auth-context.tsx`) can stall sign-out on a hanging network. The driver caps each sign-out task at 4 s. The missing timeout predates this range.
- The working tree has two uncommitted changes outside the range. `.claude/launch.json` has local `backend`/`driver-metro` entries with a LAN IP. `apps/driver/tsconfig.json` was rewritten, apparently by Expo, and drops `.expo/types/**/*.ts` and `expo-env.d.ts` from `include`. Review both before committing anything; don't sweep them in.

## Test run results

All four gates were run. The backend ran on a `git archive HEAD` export in a scratch directory so the owner's running dev backend (`spring-boot:run` on `target/classes`) was not disturbed. The apps ran in place with the dev backend, Metro and the Android emulator still running (load average about 15–19).

| Command | Result |
|---|---|
| `backend: make check` | **PASS**: `./mvnw -B verify` BUILD SUCCESS, 253 tests, 0 failures/errors; spotless clean, 0 Checkstyle violations; `LayeredArchitectureTest` 7/7. M6 suites: RealtimeSocket 7, Notifications 9, DriverAvailability 4, RealtimeMigration 6, Routing 2, OsrmRoutingProvider 6, NotificationRenderer 4, NotificationDeliveryWriter 3, FcmPushSender 2 |
| `apps/admin: npm run check` | **PASS**: lint, format, typecheck; 29 files / 187 tests, exit 0 |
| `apps/driver: npm run check` | **PASS**: lint, typecheck; 21 suites / 181 tests, exit 0. Ran against the working tree, whose uncommitted `tsconfig.json` differs from HEAD; CI on HEAD is green |
| `apps/rider: npm run check` | **PASS** (with caveat): lint and typecheck clean. The first test run failed 13/24 suites, each on its first test with a 5 s Jest timeout and suite times around 35 s, under emulator load. An immediate `npx jest --ci` re-run gave 24 suites / 139 tests green, exit 0 |

GitHub CI (`gh run list`, read-only) is green on HEAD `f7b6b67` and on every push in the range except `bd5808d`, whose run was cancelled when the next push superseded it.

## Re-audit (2026-10-07, range f7b6b67..HEAD)
_3 commits (`ce005c2` apps, `7821306` backend, `5883131` password-change re-register) · 41 files · HEAD `5883131` · independent re-audit_

### Summary

The fixes are correct and well tested. Push tokens are deleted on every revoke-all path, including the deleted-account refresh path. The dispatcher also refuses to push to an account with no live session. Five integration tests prove this over HTTP. The dispatcher claim (V8 `claimed_at`, 2-minute stale takeover) is race-free under READ COMMITTED with `SKIP LOCKED`, and a two-pass concurrent test proves each entry is pushed exactly once. The rider now has FCM config and retries registration on foreground without prompting. The driver map sends a Referer, the battery choices are documented, and the classpath regression test does its job (verified below). All original findings are resolved or accepted.

The re-audit cannot pass yet for one reason: **CI is red on `main` HEAD**. The last fix commit (`5883131`) added two test mocks that do not typecheck, so `npm run check` fails in both mobile apps, locally and in GitHub CI. The fix is two lines, but CLAUDE.md requires red CI on `main` to be fixed first, and a passing audit records HEAD as the next review baseline.

**Verdict:** Fail (gate only). Fix R1, confirm CI is green on the new HEAD, and the milestone can pass without another full audit.
**New findings:** Critical 0 · High 1 · Warning 1 · Info 3

### Status of the original findings

| Finding | Status | Evidence |
|---|---|---|
| **H1** push outlives revocation | **Resolved** (account-level design, as approved) | Every revoke-all path deletes all of the account's tokens: `AuthServiceImpl.java:167` (reuse), `:182` (deleted account on refresh), `:240` (reset) via `revokeAllSessions` (`:244-247`, same transaction, `noRollbackFor` keeps it on the 401 path); `MeServiceImpl.java:100-103` (password change) and `:182` (deletion). Defense in depth: `DeviceTokenRepository.findPushable` (`:80-87`) requires a non-revoked, unexpired refresh token for the account, and `NotificationDeliveryWriter.java:131-135` uses it. A revoked device cannot re-register, because `JwtAuthFilter` checks `sid` liveness on every request (`JwtAuthFilter.java:50`). Tests: `PushRevocationIntegrationTest` (5): reuse, reset, change (plus re-register → push), deletion (center row kept), logged out or expired → no push; `AuthServiceImplTest`, `MeServiceImplTest` verify `removeAllForUser`. Tokens are not bound to sessions, per the approved plan; the remaining exposure is in Info N2 |
| **H2** rider has no FCM config / no retry | **Resolved in code**; device proof still open (R2) | `apps/rider/app.config.ts:42` `googleServicesFile: process.env.GOOGLE_SERVICES_JSON`; README documents it. Foreground retry with `prompt: false` (`notifications-context.tsx:118-151`, `push-registration.ts:96-109`), and Android 13 "denied but askable" handled (`push-registration.ts:72-79`). Tests: `push-lifecycle.test.tsx`: retry after Settings grant, no dialog loop, A13 first prompt |
| **W1** driver map has no Referer | **Resolved** | `osm-map.tsx:96,207` `source={{ html, baseUrl }}` = `${apiBaseUrl}/`, same as the rider. The navigation guard allows only the exact base URL (iOS reports the initial load as a navigation to it) and still sends every other top-frame URL to `Linking` (`osm-map.tsx:215`). `osm-map.test.tsx` asserts both |
| **W2** deferred items without a ticket | **Resolved** (tracker tickets) | `docs/milestones/README.md:134-135`: M6-X1 iOS push (blocked on the owner's Apple account; owner input row `:22`) and M6-X2 background location ("must land before M7-T4 dispatch testing") |
| **W3** battery choices undocumented | **Resolved** | `apps/driver/README.md` "Battery": GPS accuracy/interval, deliberate `distanceInterval: 0`, stale suppression, ping/backoff/buffer, poll cadence, stop-when-offline, foreground-only limit, plan for the background source. `location-streamer.ts:43-44` points to it |
| **W4** dispatcher double-push across instances | **Resolved** (at-least-once with a 2-minute stale claim, as approved) | `V8__notification_dispatch_claim.sql`; `NotificationOutboxRepository.findPendingIds`/`lockClaimable` skip fresh claims (`claimed_at IS NULL OR claimed_at < :staleBefore` + `FOR UPDATE SKIP LOCKED`); `prepare` stamps `claimedAt` in the transaction that commits the center row (`NotificationDeliveryWriter.java:103-108`). Race walk-through: a second dispatcher either hits the row lock (skipped) or, after commit, sees the fresh claim (filtered). Tests: `NotificationDispatchClaimIntegrationTest`: two concurrent passes push 6 entries exactly once; a dead instance's claim blocks until stale, then delivers once. Re-push is possible only past `CLAIM_TIMEOUT` (documented at-least-once) |
| **W5** tracker drift | **Partially resolved** | Fixed: Firebase inputs row (`:21`), current milestone M6 (`:28`), safe-area and prompt fixes marked done (`:30`). Still stale: the M6-T5 record (`:31`) still says "(fix in progress)" and "being fixed now"; the T2 record (`:32`) still says "single-instance assumption", which V8 supersedes. The approved fix decisions are recorded only in the contract and code comments, not the tracker: password change drops all tokens and the staying device re-registers silently; at-least-once delivery with the 2-minute claim; tokens are account-level, not session-bound; Info 3 (routing throttle) is deferred. Fold these into the closure commit; not blocking on its own |
| **W6** no regression test for the FCM classpath | **Resolved** | `unit/config/PushConfigTest` builds `FcmPushSender` from a generated service-account key, offline. **Verified** on a scratch copy: with `google-http-client-jackson2` removed from `pom.xml`, the test fails with `NoClassDefFoundError: …jackson2/JacksonFactory`. With `httpclient5` set back to `test` scope, httpclient5, httpcore5 and httpcore5-h2 stay on the runtime classpath (`dependency:build-classpath -Dmdep.includeScope=runtime`), so that half of the original failure does not reproduce with the current tree |
| Info 1 stale `parsePushPayload` comments | **Resolved** (comment); nested `link` kept on purpose as "tolerated" | `apps/{driver,rider}/src/notifications/deep-links.ts:76-83` |
| Info 2 Android channel | **Resolved** | Server `FcmPushSender.java:71-75` sets `channel_id = "default"` (asserted on the wire format in `FcmPushSenderTest.shouldTargetTheDefaultAndroidChannel`). The driver now creates `default` HIGH before prompting (`push.ts:102-117`, tested); the rider already did (`push-registration.ts:28,58-63`). Contract `realtime-v1.yaml:23-25` matches |
| Info 3 unthrottled OSRM proxy | Open (not addressed, not tracked) | `RoutingController.java:31`. Track before M7 fare estimates (see W5 note) |
| Info 4 suspension deep link | **Resolved** | `NotificationRenderer.java:214-229`: only `document_expired` links to `driver_documents`, otherwise `link: null`. Contract `realtime-v1.yaml:44-46`; `NotificationRendererTest` covers `{}` and `manual` |
| Info 5 per-socket liveness query | Open (V2 note, no action expected) | Unchanged |

### New findings

#### High

**R1: CI is red on `main` HEAD. Two test mocks added in `5883131` fail `tsc` (TS2554), so `npm run check` fails in both mobile apps**
- Category: tests · Severity: High (trivially fixable) · Certainty: High
- Location: `apps/driver/src/__tests__/account-screens.test.tsx:20,23`; `apps/rider/src/screens/settings/__tests__/change-password-screen.test.tsx:14,17`
- Rationale: `jest.fn(() => Promise.resolve(true))` is typed with zero parameters, and the mock factory then calls it with `options`, which TypeScript rejects ("Expected 0 arguments, but got 1"). GitHub CI run 37605671812 on `5883131` fails the driver and rider jobs on exactly these lines; the backend and admin jobs pass. `ce005c2` was green. CLAUDE.md: "A red CI on `main` is fixed before any new work", and a passing audit records HEAD as the review baseline. The Jest suites themselves pass (driver 183, rider 142) because babel strips types; only the gate's `typecheck` step fails.
- Fix Suggestion: type the mock's parameter, e.g. `const mockRegisterThisDevice = jest.fn((_options?: { prompt?: boolean }) => Promise.resolve(true));`, and the same for `mockRegisterForPush` (returning `Promise.resolve('registered' as const)`). Run `npm run check` in both apps before pushing.

#### Warning

**R2: Rider push is still not device-proven, and no ticket or acceptance criterion owns the proof (H2 / T5 residual)**
- Category: integration · Severity: Warning · Certainty: High
- Location: `docs/milestones/README.md:31` (the T5 record proves push with the driver app only); `docs/milestones/M07-ride-loop.md` (no push acceptance criterion; the only end-to-end check is the scripted ride loop)
- Rationale: The H2 fix was code-only. Its suggestion asked for one rider push on the emulator now, or an explicit M7 acceptance criterion. Neither happened. The rider is the main audience for M7 ride pushes, so a missing or incorrect `GOOGLE_SERVICES_JSON` in the rider build would surface only during M7 device testing.
- Fix Suggestion: either run one rider-audience push on the emulator dev build now (a test outbox row is enough) and record it in the T5 record, or add an acceptance criterion to the M7 ticket that emits the first rider push ("rider receives the ride push on an Android dev build and the tap opens the ride").

#### Info

1. **N1: The re-registration after a password change is fire-and-forget and is never retried if it fails.** `apps/driver/src/components/account/change-password-screen.tsx:114` and `apps/rider/src/screens/settings/change-password-screen.tsx:104` call `registerThisDevice` / `registerForPush({ prompt: false })` and swallow errors. The lifecycle owners (`PushBridge.tsx:51`, `notifications-context.tsx:127`) already hold `registered = true` from sign-in, so a foreground re-entry never retries. One failed PUT (flaky network right after the change) leaves the device without push until the next sign-in or cold start. Suggestion: let the bridge/context expose a `reRegister()` that clears `registered` and attempts once, so a failure falls back to the existing foreground retry.
2. **N2: Residual exposure of the account-level design (accepted).** `findPushable` checks that *some* session of the account is live, not the device's own session. A device whose only session ended without the client's `DELETE /devices` therefore keeps receiving pushes while any other session of the account is live. Examples: a lost phone whose refresh token simply expired, an offline logout, or a `PUT /devices` already past the auth filter when a revoke-all commits (a millisecond window). The contract documents the single-logout case (`realtime-v1.yaml` PUT /devices). Revisit session binding (`device_tokens.session_id`, carried across rotation) before SOS or chat content goes out by push (M10).
3. **N3: `FcmPushSenderTest.shouldTargetTheDefaultAndroidChannel` reflects into the SDK's private `MulticastMessage.getMessageList`.** An SDK bump can break it as a test failure, not a product bug. Acceptable, since the wire-format assertion is valuable; note it for dependency upgrades.

### Diff review notes (no finding)

- The contract text matches the implementation. `realtime-v1.yaml` PUT /devices lists the four revoke-all paths that delete all tokens plus the live-session filter, and the deleted-account refresh path also deletes them. The Android channel paragraph and the "no link → center" rule match the code.
- V8 is additive (a nullable `claimed_at`, no backfill needed: existing undelivered rows are simply unclaimed). `findPushable` uses the existing `idx_refresh_tokens_user`.
- A supported event whose render fails would now leave a claim and retry every 2 minutes instead of every 5 seconds. Today that is unreachable, because `findPendingIds` already filters to renderable events.
- The driver map's `pageBaseUrl` is memoized once (`[]`). The runtime config is read at boot, so this is fine.

### Gate results (re-audit)

The backend gate ran on a `git archive HEAD` export in the scratch directory, so the running dev backend was not disturbed. The apps ran in place; the working tree equals HEAD apart from the unrelated `.claude/launch.json`. The load average was about 7.

| Command | Result |
|---|---|
| `backend: make check` | **PASS**: `./mvnw -B verify` BUILD SUCCESS, 263 tests, 0 failures/errors; spotless clean; 0 Checkstyle violations; `LayeredArchitectureTest` 7/7. New/changed: PushRevocationIntegration 5, NotificationDispatchClaimIntegration 2, PushConfig 2, FcmPushSender 3, NotificationDeliveryWriter 3, NotificationRenderer 4, AuthServiceImpl 12, MeServiceImpl 10, Notifications 9, RealtimeMigration 6 |
| `apps/admin: npm run check` | **PASS**: 29 files / 187 tests, exit 0 |
| `apps/driver: npm run check` | **FAIL** (R1): lint clean; `tsc` TS2554 at `account-screens.test.tsx:23`, exit 2. `npm run test` alone: 21 suites / 183 tests green |
| `apps/rider: npm run check` | **FAIL** (R1): lint clean; `tsc` TS2554 at `change-password-screen.test.tsx:17`, exit 2. `npm run test` alone: 24 suites / 142 tests green (no load timeouts this run) |
| W6 check (scratch copy, offline Maven) | `PushConfigTest` fails without `google-http-client-jackson2` (NoClassDefFoundError JacksonFactory). With `httpclient5` set to test scope, the runtime classpath still contains httpclient5/httpcore5/httpcore5-h2 |
| GitHub CI (`gh run list`, read-only) | `ce005c2` green; **`5883131` red** (driver and rider jobs, TS2554; backend and admin green) |

### Re-audit verdict

**Fail (gate only).** H1, H2 (code), W1–W4, W6 and Info 1/2/4 are resolved; W2 is handled as tracker tickets M6-X1/M6-X2. Remaining before M6 can be `review_passed`:
1. Fix R1 and confirm CI is green on the new HEAD. No other re-audit is needed for this.
2. In the closure commit: finish W5 (stale T5/T2 record phrases; record the approved decisions: account-level token deletion plus silent re-register, at-least-once with the 2-minute claim, Info 3 deferral) and resolve R2 (prove a rider push now, or add the M7 acceptance criterion).

## Closure (2026-10-07)
- R1 (red CI from the test mocks in `5883131`) fixed in `1bab319`; GitHub CI green on `1bab319` (all four jobs).
- R2 (rider push device proof) → added as an M7 milestone acceptance criterion (`docs/milestones/M07-ride-loop.md`).
- W5 completed in the closure commit: stale tracker phrases corrected and the accepted design decisions (account-scoped tokens, silent re-register after password change, at-least-once delivery with a 2-minute claim) recorded in `docs/milestones/README.md`.
- Info 3 (unthrottled OSRM proxy), N1–N3 and Info 5 recorded as backlog in the tracker. **M6 → review_passed; review baseline `1bab319`.**


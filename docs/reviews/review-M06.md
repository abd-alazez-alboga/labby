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

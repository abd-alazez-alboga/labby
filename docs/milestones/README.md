# Labby — Milestone Roadmap & Status Tracker

> **This file is the single source of truth for implementation progress.**
> It must be updated **immediately** on every ticket state change so a brand-new Claude session can resume cold.
> Resume order for a new session: `CLAUDE.md` → this file → the current milestone file.

## Rules (binding)

- Milestones run **strictly in order**: M(N+1) never starts before M(N) is `review_passed`.
- A milestone is `review_passed` only when all tickets are done, all acceptance criteria pass, and the **review-agent audit ticket** (always the last ticket) passed with findings resolved.
- Tickets follow each milestone's dependency plan; tickets in the same parallel group may be implemented simultaneously by separate agents.
- Ticket states: `todo` · `in_progress` · `blocked(reason)` · `done` · (milestone-level) `review_passed`.
- Every ticket ships its own tests (backend: unit + integration; frontend: component tests). No green tests → not `done`.
- Work happens on `main` only. Commit per CLAUDE.md rules (short, exact, **no attribution**).

## Owner inputs needed (ask when the ticket starts, not before)

| Input | Needed for | Status |
|---|---|---|
| SMS gateway app token + endpoint | M2-T6 (auth integration) | received (Traccar cloud; values in backend/.env, never committed) |
| Firebase service-account JSON + RN app configs | M6-T5 (realtime integration) | pending |
| Ruling: should shrinking a region boundary re-validate (409) existing surge zones, or may zones outlive a shrink? | M9 (surge computes from zones; code currently leaves escaping zones untouched — documented in RegionServiceImpl.updateRegion + regions-v1.yaml) | pending |

---

## Current state

- **Current milestone:** M5 — Driver onboarding: **review_passed** (closed 2026-10-06). Next up: **M6 — Realtime infrastructure** (`M06-realtime.md`), starting with M6-T1. CI is live in `.github/workflows/ci.yml` (backend `make check` + three `npm run check` jobs on every push/PR); cloud-session git rules are in CLAUDE.md.
- **In progress now:** M6-T1..T4 done. **Next: M6-T5 (real push + device run)** — owner inputs RECEIVED 2026-10-06: Firebase project `labby-5cadf` (FCM V1 enabled); service-account key at `~/.config/labby/firebase-service-account.json` (wired via `FIREBASE_CREDENTIALS_PATH` in gitignored `backend/.env`); Android configs `~/.config/labby/google-services-{rider,driver}.json` (packages `com.labby.rider` / `com.labby.driver`); admin web config + VAPID key in `~/.config/labby/firebase-web-config.json`; phone builds via **EAS** (owner logged in on this machine as `azez28.5`). Plan: EAS Android development builds (google-services via EAS file env vars, never committed) → install on owner's phone → real push + GPS streaming + OSRM route on Damascus; iOS deferred (no Apple dev account; iOS token is APNs, needs a decision). Then M6-T6 audit, then M7 (owner directive: continue through M7).
- **M6-T2/T3 record (one backend agent, sequential; committed separately):** backend 253 tests. T2: outbox dispatcher (every 5 s, 200 rows/run, `NOTIFICATIONS_DISPATCH_CRON`, single-instance assumption), EN/AR templates for all M5 events (category account, audience driver), `PushSender` = FCM (firebase-admin 9.9.0, env creds) or log-only (records `failed`), dead tokens pruned on UNREGISTERED/INVALID_ARGUMENT/SENDER_ID_MISMATCH, center rows keep the outbox event time, push data map = `notificationId, category, event, screen, params(JSON string)` (contract amended). T3: WebSocket `/api/v1/realtime` (raw handler, in-protocol auth, re-auth answered with `ready`, revocation/expiry noticed within 5 s check interval, idle close 1000, any origin — no ambient credentials), REST fallback, availability gates (`CannotGoOnlineReason`), `DriverDutyGates` seams for M7/M8, stream health (fresh ≤ 30 s), `OsrmRoutingProvider` + straight-line fallback (also on NoRoute). New env: `REALTIME_AUTH_TIMEOUT_SECONDS`, `REALTIME_IDLE_TIMEOUT_SECONDS`, `REALTIME_CHECK_INTERVAL_SECONDS`, `ROUTING_OSRM_TIMEOUT_SECONDS`. Also fixed an M5 race (`3a8f413`): concurrent renewal decisions now lock the renewal row (loser gets 409, never 404). **Owner calls pending:** (a) a driver suspended while online stays `online=true` — plan: M7 dispatch re-checks gates on every candidate AND suspension forces offline (implement in M7 unless owner objects); (b) future `recordedAt` samples are accepted (wrong device clock could pin a stale position) — plan: clamp to server time in M7 trace work; (c) Arabic/English notification copy needs an owner proofread; (d) preferences are per account (muting in one app mutes in all).
- **M6-T1 decisions (made autonomously under the owner's 2026-10-06 directive — owner to confirm on return):** contract `backend/docs/api/realtime-v1.yaml`, migration V7. Notification categories `ride, chat, scheduled, promotions, account, safety`; `ride` + `safety` locked (never mutable, DB CHECK); muting stops PUSH only, the center always records (UC-S-25 A1); M5 onboarding/document/suspension events are category `account`, audience `driver`. Center rows store EN + AR text rendered at creation (language switch re-renders instantly); audience `rider|driver|admin|all` decides which client's center lists it and which devices get the push; deep links are `{screen, params}` from a fixed catalog (`driver_application`, `driver_documents`, `driver_vehicles`, `notifications`; M7 adds `ride`). Delivery: the M5 `notification_outbox` stays the single queue — a dispatcher renders → one center row per outbox row (unique FK) → FCM push per prefs; push failure/no device never loses the row (`push_status`). FCM tokens in `device_tokens` (unique token, re-assigned on another login). Online state on `driver_profiles.is_online` (+ CHECK: only approved); gates = role active + approved + active vehicle; balance floor (M8) and active-ride offline block (M7) are seams. Latest position only in `driver_locations` (Point 4326 + received_at), ride traces in M7; stream every 5 s (`LOCATION_INTERVAL_SECONDS`), stale after 30 s (`LOCATION_STALE_SECONDS`). WebSocket `/api/v1/realtime`: first-frame `auth` with the access token (never in the URL), re-auth before expiry, close 4401 on expiry/revocation; REST fallback `POST /driver/locations`. Routing seam `service/RoutingProvider` (public OSRM, 3 s timeout) with straight-line fallback (×1.3 detour at 25 km/h, configurable) flagged `approximate`. Weekly availability windows (UC-D-05) deferred to M12 where the board consumes them. JPA note: converters never apply to `@Id` columns — `NotificationPreference.category` is a String id with a typed accessor. Suites after T1: backend 216.
- **M6-T4 record (2026-10-06, clients, three parallel agents, verified + committed together):** rider (132 tests), driver (170), admin (187) all green. Shared choices (owner to confirm): maps = `react-native-webview` + Leaflet 1.9.4 from unpkg (SRI-pinned) on OSM tiles from runtime config (`mapTileUrl` + attribution; admin's polygon editor now reads it too), the WebView page uses the API base URL as origin so OSM gets a Referer; push via `expo-notifications` native device token → `PUT /devices` after sign-in, `DELETE` before logout (best-effort sign-out tasks), permission asked right after sign-in on mobile, admin web push is OPT-IN via a button (Firebase SDK `@firebase/app`+`@firebase/messaging` lazy-loaded into its own chunk only when `firebaseWeb` runtime config exists; SW `public/firebase-messaging-sw.js` loads gstatic scripts — CSP must allow it); foreground pushes show as banners (admin: toasts, `safety` = sticky critical toast); unread badge polled (admin 60 s); deep links: unknown/foreign screens → center, `driver_documents` highlights the slot. Driver: foreground-only location (background needs a dev build — `LocationSource` seam ready), WS streamer (auth first frame, proactive refresh 60 s before JWT exp, 4401 → refresh → reconnect, ping 25 s / pong 10 s, backoff 1–30 s ±20%, newest-20 sample buffer flushed via REST), going offline before sign-out, availability card with every gate reason. Dev-only rider route preview behind `__DEV__`. **T5 notes:** iOS `getDevicePushTokenAsync` returns an APNs token, not FCM — iOS push needs `@react-native-firebase/messaging` or backend APNs (decide when iOS is in scope); tokens can't be unregistered after forced sign-out/session revocation (backend should prune on revocation; re-assign on next login already works); Android notification channel id unspecified; old Arabic brand strings (لابي) remain in rider/driver (rename backlog). Driver jest suites can hit 5 s timeouts only under heavy parallel load (passes at normal load).
- **M5 closure record:** T6 audit (report `docs/reviews/review-M05.md`, range `eae6dd3..a521cd2`) returned **Pass with comments** — 0 Critical, 0 High, 1 Warning, 5 Info; every ticket + milestone AC met. W1 (expiry job one-transaction + stale-read suspension race) fixed in `6f979ee` (per-item transactions, role-row PESSIMISTIC_WRITE lock + re-check, new stale-read test). **M5 backlog (non-blocking):** pending renewal of a switched-away vehicle lingers in the renewal queue (approving it is a no-op); `STORAGE_DRIVER_FILE_MAX_BYTES` can't exceed the fixed 10MB multipart limit; **owner ruling wanted:** per-user upload quota + orphan-upload cleanup for `/driver/files`; **owner ruling wanted:** should applications of DELETED accounts stay approvable/in the queue; driver README lacks the M5 screens; driver `resolveFileUrl` drops an API-base path prefix (admin handles it); expiry dashboard/app queue have N+1 query patterns; optional: job could lift document_expired suspensions itself (contract extension, owner call). Suites at close: backend 210, admin 138, driver 99, rider 60.
- **M5-T5 record (2026-10-06):** live walkthrough PASSED on the real stack (Postgres + backend dev profile + admin app in a real browser; driver flow driven against the API per owner instruction): no-application 404 → submit E1/E2 per-item errors (`profilePhoto`, `documents[insurance].expiresOn`) → valid submit (one PDF) → admin start-review (photos/PDF load via expiring URLs) → request-changes on insurance + vehicle with notes → applicant sees exactly those flags → unflagged-item resubmit 400 → flagged-only resubmit → admin approve (Economy+Comfort) → driver role active, vehicle active; expiry simulation (insurance moved to yesterday, job cron overridden to every minute at runtime) → driver role `suspended/document_expired` + `driver.suspended` queued → renewal 201, duplicate renewal 409 → expiry dashboard showed pending renewal / Layla's 20-day insurance with 30-day reminder / expired doc → admin approved renewal → suspension lifted, old doc superseded, `driver.reinstated` queued; all 8 stage events in the outbox, all admin decisions audit-logged. `DevDriverSeeder` (dev, idempotent per driver) seeds approved demo drivers +963900000005..7 and backfills +963900000002 (see SEEDING.md); seeders ordered (account/region before drivers); `backend/data/` (dev uploads) now gitignored. **Local env gotcha:** another project's Postgres holds host port 5432 on the owner's machine — labby-postgres was recreated on **5433** (`DB_PORT=5433`, `DB_URL=jdbc:postgresql://localhost:5433/labby` at runtime); the owner's local DB now has +963900000003 as an approved driver (walkthrough data). Audit note candidate: admin tables render mixed Arabic+digit plates in bidi-reordered form (e.g. "509876دمشق") — cosmetic. Suites: backend 209, admin 138, driver 99, rider 60.
- **M5-T2..T4 decisions a cold session needs (owner-approved 2026-10-06):** backend config `ONBOARDING_TIMEZONE` (default Asia/Damascus) + `ONBOARDING_EXPIRY_JOB_CRON` (default `0 5 0 * * *`, `-` disables; tests use `-`); optimistic-lock failures → 409 globally; oversized uploads → 413 on `/driver/files` only; each 409 carries a distinct plain message (no error-code field — admin infers the cause by refetching); decided vehicle switch → GET detail 404, re-decide 409; decided renewal → 409; profile photo appears as `personal.photo` with fileId = account id and may be `image/webp` (contract FileRef amended); own fileIds may be REUSED on resubmit/reapply/switch/renewal; fieldErrors keyed by document type (`documents[<type>].<field>`), never by index; approving a vehicle switch also lifts a `document_expired` suspension once nothing current is expired; rejecting an application rejects its vehicle + open documents; a doc first seen inside 7 days only gets the 7-day reminder, missed job days catch up; expiry dashboard `driverSuspended` = any reason, renewal rows = document_expired only; admin queue clamps page/size. Driver app: 8-step wizard, flagged items prefilled on resubmit (reapply starts blank), flagged personal item needs a "reviewed name & photo" tick, wizard state in memory only (no drafts), device-local "today" (server authoritative), new deps `expo-document-picker` + `@react-native-community/datetimepicker`, new theme tokens `warning`/`warningBg`; driver README not yet updated for the new screens. Admin: browser-local "today" for chips, no preselected service types, PDFs open in a new tab, file URLs re-minted 30 s before expiry (≥15 s floor), 3 sidenav entries (applications, vehicle switches, document expiry incl. renewals). Contract gaps noted for later (non-blocking): no machine-readable 409 reason, no per-status queue counts, expiry row doesn't link its renewal id. Suites after T4: backend 208, admin 138, driver 99, rider 60.
- **M5-T1 decisions a cold session needs:** owner rulings 2026-10-06: "personal details" = account name + profile photo (photo REQUIRED to submit; reviewed as the `personal` item via `driver_profiles.personal_review_*`); each document = ONE file, JPEG/PNG/**PDF**, ≤10 MiB (`STORAGE_DRIVER_FILE_MAX_BYTES`); vehicle photos 1..4 JPEG/PNG (first shown to riders); a plate on ANOTHER driver's active vehicle is flagged `duplicatePlate` and **blocks approval (409)**. Contract defaults approved with the ticket: approval also 409s if a document expired during review; documents valid THROUGH `expiresOn`, "today" = Asia/Damascus date (T2 makes the zone configurable), entry requires expiry after today; `GET /admin/assignable-service-types` (enabled types of active regions, `driver-review:view`) so reviewers need no `pricing:view`; flagged vehicles corrected in place, documents versioned (renewal = new pending row beside the approved one → old becomes `superseded`); reapply after rejection = full new submission on the same `driver_profiles` row. Schema (V6): `stored_files`, `driver_profiles` (@Version), `driver_application_events`, `vehicles` (@Version; **partial unique index = one active per driver**, CHECK active⇒approved, one open review per driver), `vehicle_photos` (position 1..4), `vehicle_service_types`, `documents` (vehicle-binding CHECK; one approved + one open per slot, NULLS NOT DISTINCT), `notification_outbox` (M5 queues stage-change events here; M6-T2 backfills them — event keys listed in the contract), `role_assignments.suspension_reason` (`document_expired` only; only that reason auto-lifts). Permissions reuse the existing `driver-review:view/decide` — no catalog change. **Storage (NFR-S2):** `StorageProvider.accessUrl(key, contentType)` mints expiring URLs (TTL `STORAGE_URL_TTL_SECONDS`, default 300); local provider → `/api/v1/files/{token}`, HMAC token by `security/FileUrlSigner` (key derived from JWT_SECRET under its own label), endpoint is whitelisted (token = capability, `<img src>` can't send Bearer), invalid/expired → plain 404, `no-store` + `nosniff`. Callers MUST permission-check before minting. A `Clock` bean exists (`config/ClockConfig`) for T2's clock-controlled expiry tests. Vehicle collections are LAZY — read them inside the service transaction. Integration tests write uploads to `$TMPDIR/labby-it-uploads`. Suites after T1: backend 177.
- **M4 closure record:** T6 audit (report `docs/reviews/review-M04.md`, range `a3ce6a9..eae6dd3`) returned **Pass with comments** — 0 Critical, 0 High, 2 Warning (both repo-documentation gaps, resolved doc-only in the closure commit: tracker brought current, the boundary-shrink decision documented in `RegionServiceImpl.updateRegion` + the contract and tracked above as a pending owner ruling). All ticket + milestone ACs met with evidence. **Facts a cold session needs:** geometry decision = **PostGIS** (`postgis/postgis:16-3.4-alpine` in docker-compose AND the shared Testcontainer; local dev DB needed a one-time volume recreate, done 2026-10-05); point-in-polygon uses **ST_Covers** (a point ON a boundary/zone edge counts as inside; shared-border resolve ties break by name); region overlap guard = interiors-intersect (adjacent shared borders legal), enforced on create and update; zones must lie within their region (strict, create and update); polygons travel as GeoJSON **[lng,lat]** — the only Leaflet↔contract conversion lives in `apps/admin/src/pages/regions/leaflet-geojson.ts`, and `PolygonMapEditor.tsx` is the only Leaflet-touching module (deps: leaflet + react-leaflet@4 + leaflet-draw; react-leaflet@5 needs React 19, don't bump casually); backend GeoJSON edge is `util/GeoJson.java` (rejects holes/open/self-intersecting rings → 400); client endpoints `/api/v1/regions/resolve` + `/{id}/config` are authenticated-but-unprivileged (rider gets 404s not 403s; drafts never served; 404 = outside operating area); apps (rider+driver) resolve on boot/foreground/≥1.5 km movement via expo-location, cache config per app, and treat server-404 as authoritative (drops cache) vs network failure (keeps cache) — distinct UI states; **Damascus demo region** seeded by `DevRegionSeeder` (dev profile, idempotent by name, per `SEEDING.md`: SYP, emergency 112, 3 AR-named service types, Sun–Thu morning rush +25%, 3 zones); T5 live walkthrough passed (UI edit → `/regions/resolve` reflected immediately, audit complete, Aleppo point 404). **Info backlog from the audit (non-blocking):** seeder re-seeds if the region is renamed (dev-only); seeder test doesn't assert zone containment; surcharge-window start/end semantics (overnight? overlaps?) need a documented rule before M7's fare engine; admin vitest suites time out under heavy parallel load (consider raising testTimeout); disabling the LAST enabled service type of an active region is currently legal — owner glance wanted. Suites at close: backend 156, admin 88, rider 60, driver 60.
- **M3 closure record:** T5 audit (report `docs/reviews/review-M03.md`, range `26d780f..ff1740f`) returned Pass with comments — 0 Critical, 0 High, 2 Warning; every ticket + milestone AC met. Owner decisions (2026-10-05): fix W1 AND add W2 guards — implemented via labby-fix in `c9c4197` (malformed path/query params → 400; only an ACTIVE Super Admin may grant the Super Admin role; an admin may never edit the role they themselves hold — all 409; SRS RBAC-01/02 + `rbac-v1.yaml` updated in the same commit; +2 integration tests). Independent re-audit over `ff1740f..a3ce6a9` **passed** (backend 120 tests green; no new findings above Info). Re-audit Info note kept for the record: `roles:manage` + `admins:manage` held TOGETHER still ≡ full access (create new full-catalog role → self-assign) — permission-checked and audited, outside the decided guard set, no action for M3; relevant if those two perms are ever granted together to a non-Super-Admin role. Open Info backlog from the audit: no-op role.update audit entries (inconsistent with admin no-op skips), fresh admins hardcode `Language.EN` for the set-password SMS, `admins:manage`-without-`roles:view` degrades the creation form (undocumented coupling). Suites at close: backend 120, admin 56, rider 54, driver 54. T4 walkthrough record (done 2026-10-05): T4 walkthrough passed in full against the live stack (Postgres + backend + admin app, real browser): Super Admin sees all RBAC screens; custom role created/edited/deleted via the role builder; Support-role admin created with the set-password flow (purpose `reset`, OTP captured via a local SMS-sink override of `SMS_GATEWAY_URL` — runtime env only, nothing committed); UI gating verified (only Dashboard visible to Support, direct routes show "No access"); server-side 403s on all five RBAC endpoints for Support; role edit granted `audit:view` → same access token flipped 403→200 instantly (and back on revert), Support admin's UI picked the change up on refresh; deactivate/reactivate verified UI- and server-side (suspended role assignment, reactivated login restores Support perms); last-Super-Admin deactivate → 409; system-role delete / Super-Admin edit → 409; audit log UI shows the complete 9-entry sequence (role.create/update×4/delete, admin.create/deactivate/reactivate) with before/after JSON, filters work; append-only trigger `trg_audit_log_append_only` confirmed installed in the live DB. **T4 findings for T5 to weigh:** malformed UUID in a path param (e.g. `/admin/admins/not-a-uuid/deactivate`) returns 500, contract-cleaner would be 400; a role save with an unchanged permission set still writes a `role.update` audit entry (before==after — arguably correct completeness). **T2 decisions a cold session needs:** admin `domain:action` authorities are resolved from the DB per request in `JwtAuthFilter`→`PermissionService` (never baked into tokens — that is what makes role edits/deactivation instant, the T2 AC); audit logging is service-level (not AOP) via `AuditService.record` inside each mutating service method, actions `role.create/update/delete`, `admin.create/role_change/deactivate/reactivate`; admin creation on a DELETED account's phone → 409 (reactivate first — flagged to owner); admin deactivation = suspending the admin role_assignment; `/users/me` now enriches the admin role assignment with `rbacRole {id,name}` + `permissions[]` (absent on rider/driver rows — auth-v1.yaml updated) so the admin UI can gate routes/menus (requested by the T3 session; UI picks up role edits on next profile fetch, enforcement stays per-request). **T3 decisions a cold session needs:** the UI learns the signed-in admin's own permission set from the `rbacRole`+`permissions` enrichment of /users/me's admin RoleAssignment (agreed cross-session with T2, implemented in PR #2 — T4 still verifies end-to-end); the only reader is `adminPermissions()` in `apps/admin/src/auth/permissions.ts`, deny-by-default when absent; role edits reach another admin's UI on next page refresh (profile re-fetch on load, documented in apps/admin/README.md), server-side enforcement stays per-request/instant; gating pattern for all future screens = `usePermissions().can('domain:action')` + `<RequirePermission>` routes; Super Admin is identified in the roles UI by its stable system-role name. **T1 decisions a cold session needs:** catalog v1 (22 perms, `enums/Permission.java` = source of truth, mirrored in V4) includes `admins:*` and `roles:*` domains beyond the ticket's ten so M3-T2's own admin/role endpoints are permission-checkable (RBAC-03); `audit_log` table shipped in V4 with a DB trigger making it append-only; system roles have fixed UUIDs (…0001 Super Admin, …0002 Support); one-role-per-admin lives as `role_assignments.admin_role_id` + CHECK, dev/existing admins backfilled to Super Admin; `RbacCatalogSeeder` (all profiles, idempotent) syncs code catalog → DB and keeps Super Admin at full grant, never touches editable Support; admin creation's set-password path reuses the password-reset flow (purpose `reset`) per contract `backend/docs/api/rbac-v1.yaml`.
- **M2 closure record:** the T7 audit (report `docs/reviews/review-M02.md`) returned Pass with comments; all findings were fixed via labby-fix (commits `9d8ebed`…`98839d0`) and the independent re-audit over `c222351..26d780f` **passed**. Owner decisions recorded: phone-change new-phone OTP stays purpose `2fa` (documented in UC-S-06); access-token revocation enforced per request via `SessionService` sid check; suspended-driver gate shows distinct copy with suspension-REASON display deferred until a milestone whose contract carries reasons; no resend UX in phone-change. JWT_SECRET has NO default — backend refuses to boot without it (value lives in gitignored backend/.env). Suites at close: backend 81, rider 54, driver 54, admin 33 — all green incl. lint/format/ArchUnit.
- **Blockers:** none. Owner still owes the one-time manual driver-app device run (from review-M01; the rider app was exercised live on a device in T6).
- **Review baseline:** `6f979ee` (M6's audit range = 6f979ee..HEAD at its close; M5 was audited over eae6dd3..a521cd2, W1 fix 6f979ee)
- **Last session note (2026-10-05, late evening):** M4 implemented and closed in the same local session that closed M3 — T1 locally, T2/T3/T4 by three parallel agents (disjoint trees, verified and committed per ticket), T5 Damascus seeder + live walkthrough, T6 audit Pass with comments (doc-only resolutions in the closure). Owner directive recorded: launch market is Syria — all demo/seed data defaults Syrian (Damascus first). Earlier same session — M3 closed end-to-end: T4 live walkthrough (Postgres + backend + admin app + real browser; OTP captured via a runtime-only local SMS-sink override of `SMS_GATEWAY_URL` — a reusable trick for local integration tickets, needs HTTP/1.1 + chunked-body handling), T5 audit → owner-approved fixes → re-audit Pass. Earlier same day: CI + cloud workflow set up and proven (first runs green ~2 min); M3 T1–T3 implemented by cloud sessions and merged by the owner. Gotcha: PR #3 was merged as a merge commit instead of the squash the git rules call for — history on main is still complete (audit ranges unaffected), but future PRs should use "Squash and merge". Earlier same day — M2 fully closed: Traccar SMS gateway live (cloud mode, raw token auth, `{to, message}` body), real-device verification of register/reset/2FA/delete→reactivate, T6 UX overhaul (eye toggles, confirm-password, staged change-password wizard), review cycle done. Backlog for later passes: NEW-1 from the re-audit (rider cold start with no cached profile + transiently failing refresh still clears the session — distinguish "session dead" from "server trouble" in apiFetch's refresh error); app-wide لابي→لبي rename DONE 2026-10-06 (brand is لبي everywhere); palette lacks error/success tokens (driver carries local ones); change-password contract validates the current password only at the final call (wizard surfaces a wrong current password late — a verify endpoint would be a contract change). Facts a cold session needs: RN apps are Expo SDK 57; seeded dev accounts per backend/docs/SEEDING.md (password `Password1!`, admin is +963900000004); dev boot needs backend/.env (JWT_SECRET + SMS_GATEWAY_URL/TOKEN, gitignored — owner has values); run backend with `set -a && . ./.env && set +a && make run`; owner's dev machine LAN IP 10.119.76.100, Expo apps need `LABBY_API_BASE_URL=http://10.119.76.100:8080`; owner's phone may run NordVPN, which blocks LAN access; OTP SMS wording must avoid "verification"/"التحقق" (carrier-filtered, delivery-tested).

---

## Milestone status

| # | Milestone | File | Status |
|---|---|---|---|
| M1 | Foundation & scaffolding | `M01-foundation.md` | review_passed |
| M2 | Auth & accounts | `M02-auth.md` | review_passed |
| M3 | RBAC & admin foundation | `M03-rbac.md` | review_passed |
| M4 | Regions & pricing config | `M04-regions.md` | review_passed |
| M5 | Driver onboarding | `M05-driver-onboarding.md` | review_passed |
| M6 | Realtime infrastructure | `M06-realtime.md` | in_progress |
| M7 | On-demand ride loop | `M07-ride-loop.md` | todo |
| M8 | Money | `M08-money.md` | todo |
| M9 | Surge & heatmap | `M09-surge.md` | todo |
| M10 | Communication & safety | `M10-comms-safety.md` | todo |
| M11 | Trust & quality | `M11-trust.md` | todo |
| M12 | Scheduled & shared rides | `M12-scheduled-shared.md` | todo |
| M13 | Growth | `M13-growth.md` | todo |
| M14 | Support & content | `M14-support.md` | todo |
| M15 | Analytics & launch hardening | `M15-analytics-hardening.md` | todo |

---

## Ticket status

Statuses live here (milestone files describe content only, they are never edited for status).

### M1 — Foundation & scaffolding
| Ticket | Title | Status |
|---|---|---|
| M1-T1 | Monorepo layout & root tooling | done |
| M1-T2 | Backend skeleton | done |
| M1-T3 | Admin web shell | done |
| M1-T4 | Rider app shell | done |
| M1-T5 | Driver app shell | done |
| M1-T6 | Cross-client integration smoke | done |
| M1-T7 | Review audit | review_passed |

### M2 — Auth & accounts
| Ticket | Title | Status |
|---|---|---|
| M2-T1 | Auth contract & migrations | done |
| M2-T2 | Auth backend | done |
| M2-T3 | Rider app auth screens | done |
| M2-T4 | Driver app auth screens | done |
| M2-T5 | Admin login | done |
| M2-T6 | Auth integration (real SMS) | done |
| M2-T7 | Review audit | review_passed |

### M3 — RBAC & admin foundation
| Ticket | Title | Status |
|---|---|---|
| M3-T1 | RBAC contract & migrations | done |
| M3-T2 | RBAC backend & audit log | done |
| M3-T3 | Admin UI: roles, admins, audit | done |
| M3-T4 | RBAC integration | done |
| M3-T5 | Review audit | review_passed |

### M4 — Regions & pricing config
| Ticket | Title | Status |
|---|---|---|
| M4-T1 | Regions contract & migrations | done |
| M4-T2 | Regions backend | done |
| M4-T3 | Admin UI: regions & zone drawing | done |
| M4-T4 | Apps: region resolution | done |
| M4-T5 | Regions integration | done |
| M4-T6 | Review audit | review_passed |

### M5 — Driver onboarding
| Ticket | Title | Status |
|---|---|---|
| M5-T1 | Onboarding contract & migrations | done |
| M5-T2 | Onboarding backend | done |
| M5-T3 | Driver app: application flow | done |
| M5-T4 | Admin UI: review queues | done |
| M5-T5 | Onboarding integration | done |
| M5-T6 | Review audit | review_passed |

### M6 — Realtime infrastructure
| Ticket | Title | Status |
|---|---|---|
| M6-T1 | Realtime contract & migrations | done |
| M6-T2 | Notifications backend (FCM + center) | done |
| M6-T3 | Tracking & routing backend | done |
| M6-T4 | Clients: maps, streaming, notification center | done |
| M6-T5 | Realtime integration (Firebase creds) | in_progress |
| M6-T6 | Review audit | todo |

### M7 — On-demand ride loop
| Ticket | Title | Status |
|---|---|---|
| M7-T1 | Ride contract & migrations | todo |
| M7-T2 | Ride backend (dispatch, lifecycle, fare core) | todo |
| M7-T3 | Rider app: booking → completion | todo |
| M7-T4 | Driver app: offer → completion | todo |
| M7-T5 | Ride loop integration & e2e | todo |
| M7-T6 | Review audit | todo |

### M8 — Money
| Ticket | Title | Status |
|---|---|---|
| M8-T1 | Money contract & migrations | todo |
| M8-T2 | Money backend | todo |
| M8-T3 | Rider app: wallet, tips, fees | todo |
| M8-T4 | Driver app: earnings & balance | todo |
| M8-T5 | Admin UI: grants, refunds, settlements | todo |
| M8-T6 | Money integration | todo |
| M8-T7 | Review audit | todo |

### M9 — Surge & heatmap
| Ticket | Title | Status |
|---|---|---|
| M9-T1 | Surge computation backend | todo |
| M9-T2 | Clients: heatmap, surge display, override UI | todo |
| M9-T3 | Surge integration | todo |
| M9-T4 | Review audit | todo |

### M10 — Communication & safety
| Ticket | Title | Status |
|---|---|---|
| M10-T1 | Comms contract & migrations | todo |
| M10-T2 | Chat, share page, SOS backend | todo |
| M10-T3 | Apps: chat, dial, share, SOS | todo |
| M10-T4 | Admin: live ops map & SOS alerts | todo |
| M10-T5 | Comms integration | todo |
| M10-T6 | Review audit | todo |

### M11 — Trust & quality
| Ticket | Title | Status |
|---|---|---|
| M11-T1 | Trust contract & migrations | todo |
| M11-T2 | Ratings, reports, metrics backend | todo |
| M11-T3 | Apps: rating, reporting, performance | todo |
| M11-T4 | Admin: reports queue & flags | todo |
| M11-T5 | Trust integration | todo |
| M11-T6 | Review audit | todo |

### M12 — Scheduled & shared rides
| Ticket | Title | Status |
|---|---|---|
| M12-T1 | Scheduled/shared contract & migrations | todo |
| M12-T2 | Scheduled & shared backend | todo |
| M12-T3 | Rider app: scheduling & shared rides | todo |
| M12-T4 | Driver app: claim board & shared flow | todo |
| M12-T5 | Integration | todo |
| M12-T6 | Review audit | todo |

### M13 — Growth
| Ticket | Title | Status |
|---|---|---|
| M13-T1 | Growth contract & migrations | todo |
| M13-T2 | Promos, referrals, loyalty, gamification backend | todo |
| M13-T3 | Rider app: growth features | todo |
| M13-T4 | Driver app + admin: challenges & promos | todo |
| M13-T5 | Integration | todo |
| M13-T6 | Review audit | todo |

### M14 — Support & content
| Ticket | Title | Status |
|---|---|---|
| M14-T1 | Support contract & migrations | todo |
| M14-T2 | Tickets, help CMS, lost items, feedback backend | todo |
| M14-T3 | Apps: support, lost items, feedback | todo |
| M14-T4 | Admin: queues, CMS, categories | todo |
| M14-T5 | Integration | todo |
| M14-T6 | Review audit | todo |

### M15 — Analytics & launch hardening
| Ticket | Title | Status |
|---|---|---|
| M15-T1 | Analytics backend & CSV export | todo |
| M15-T2 | Admin dashboard UI | todo |
| M15-T3 | Incentives engine | todo |
| M15-T4 | i18n & RTL completeness audit | todo |
| M15-T5 | Load test (1k concurrent) & fixes | todo |
| M15-T6 | Backups, restore drill, launch-gate checklist | todo |
| M15-T7 | Final review audit | todo |

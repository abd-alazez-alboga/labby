# M6 — Realtime Infrastructure

> Status lives in `README.md`. Prereq: M5 `review_passed`.
> **Owner input needed at T5:** Firebase service-account JSON + RN app configs.

## User stories
- As a user, I receive push notifications in my language and can review them in an in-app center that survives reinstalls. (UC-S-11/12/25, NTF-01…03)
- As a driver, going online streams my GPS every 5 s; going offline stops it. (UC-D-04, TRK-01)
- As any client, I get real routes and ETAs from OSRM, with a graceful fallback when it's unreachable. (ES-04, NFR-A3)

## Scope
SRS: NTF-01…03, TRK-01, TRK-04 (stale detection), ES-03, ES-04, DRV-05 (online/offline toggle), NFR-A3, NFR-P3 groundwork. Map components in all clients.

**Out:** ride-bound tracking views (M7), chat (M10), heatmap (M9).

## Tickets

### M6-T1 — Realtime contract & migrations
Migrations: `notifications` (user, category, localized payload, read, deep link), notification preferences, device tokens, `driver_locations`. Contracts: device-token registration, notification center/prefs APIs, GPS ingestion channel (WebSocket protocol + REST fallback), `RoutingProvider` interface (route, distance, duration, ETA) + estimate endpoint shape, online/offline endpoints.
**AC:** contracts reviewed against NTF/TRK SRS rows; migrations clean.

### M6-T2 — Notifications backend
`PushSender` seam + FCM implementation (config from env); notification service: persist to center + push per category prefs, critical categories uncancellable (NTF-02); localized templates (EN/AR); center API (list, read-state, deep links); backfill hook so M5's queued stage-change notifications flow through.
**AC:** unit/integration tests: pref filtering, critical override, localization, center pagination; FCM failure leaves center record intact (NFR-A3).

### M6-T3 — Tracking & routing backend
Online/offline state (gated: approved driver, not suspended, not below balance floor — floor arrives M8, seam now); GPS ingestion at 5 s cadence into `driver_locations`; stale-stream detection (30 s) flagging drivers unofferable; `RoutingProvider` with public-OSRM implementation + straight-line fallback flagged `approximate`; estimate endpoint.
**AC:** load-shaped test: 100 simulated drivers streaming without backlog; stale detection proven on a controlled clock; fallback activates when OSRM is blocked in test.

### M6-T4 — Clients: maps, streaming, notification center
Rider + driver apps: OSM-tile map component (reusable), notification center + preferences screens, push registration + deep-link handling. Driver app: online/offline toggle wired to streaming (background-capable location per platform rules, permission prompts per UC-D-04 E3). Admin: toast/alert infrastructure + token registration (for M10 SOS alerts).
**AC:** toggle online → position visibly updates on a dev map; center shows history after reinstall; push deep-links open the right screen; component tests green.

### M6-T5 — Realtime integration (Firebase credentials)
Owner provides Firebase credentials (ask now; env-only). Real push end-to-end on Android + iOS; GPS streaming on real device; OSRM estimates on the demo region.
**AC:** real push received on both platforms; full UC-S-25 alternates verified; secrets only in env.

### M6-T6 — Review audit
Audit against NTF/TRK rows, UC-S-11/12/25, UC-D-04; protocol robustness (reconnection, token refresh); battery-conscious streaming choices documented.
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3) → T4 → T5 → T6
```
(T4 may start against T1 contracts in parallel with T2/T3 for UI work; wiring completes after T3.)

## Milestone acceptance criteria
- Push + center + prefs behave per NTF-01…03 on real devices.
- A driver's live movement is visible server-side at 5 s cadence; silence > 30 s flags them.
- Routing works through the provider seam with a working fallback.
- Tracker updated; review audit passed.

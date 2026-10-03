# M10 — Communication & Safety

> Status lives in `README.md`. Prereq: M9 `review_passed`.

## User stories
- As a rider/driver, I chat with my counterpart (text + quick replies) from acceptance until 24 h after the ride. (UC-S-13, CHAT-01/02)
- As a rider/driver, I call the other party via my phone's dialer. (UC-S-14, CALL-01)
- As a rider/driver, I share a live trip link anyone can open without login — dead at ride end. (UC-S-15, SHARE)
- As a rider/driver, SOS dials the region's emergency number and alerts support instantly. (UC-S-16, SAFE)
- As an admin, I watch a live ops map and handle SOS alerts in real time. (UC-A-19/20, ADM-03)

## Scope
SRS: CHAT-01…03, CALL-01, SHARE-01/02, SAFE-01/02, ADM-03. Chat visibility for support admins (CHAT-03) lands here; the reopen-for-lost-items hook is exercised in M14.

## Tickets

### M10-T1 — Comms contract & migrations
Migrations: `chat_threads`/`messages` (per ride, window state), quick-reply catalog (localized), `trip_share_links` (token, expiry-at-ride-end), `sos_events` (permanent — no delete path). Contracts: WS chat protocol (send/receive/read-state/reconnect), chat REST (history), share-link create + public page data, SOS trigger, admin alert stream, live-ops-map data feed (drivers, active rides, surge overlay, SOS pins).
**AC:** window rules (acceptance → +24 h, read-only after, reopen hook) encoded in the contract; migrations clean.

### M10-T2 — Chat, share page, SOS backend
Chat service: thread per ride, window enforcement, quick replies, unread/read state, push on new message (muted-category rules don't apply — ride-critical), persistence + admin visibility (permission-gated); public share page: server-rendered/minimal web page (no login) with live position via token-scoped stream, full detail per SHARE-02, hard-dead at completion/cancel; SOS: event recording (ride, GPS, ts), red-flag on ride, real-time alert to support-permission admins (push + dashboard stream).
**AC:** integration tests: window edges (before accept, after +24 h, reopened), reconnection/dedup, share token unguessable + dead post-ride, SOS event immutability, alert fan-out to the right admins only.

### M10-T3 — Apps: chat, dial, share, SOS
Rider + driver apps: chat screen (free text + localized quick replies, unread badges, push deep-link), call button (`tel:` with counterpart number, window-gated), trip-share action (OS share sheet), SOS button (prominent in active rides; confirm-tap → dialer with region emergency number + silent event fire).
**AC:** UC-S-13…16 flows + exceptions against mocks; quick replies one-tap while driving (NFR-U2); RTL verified; tests green.

### M10-T4 — Admin: live ops map & SOS alerts
Live ops map per region: online driver dots (idle/on-ride), active ride routes, surge overlay (from M9), red SOS pins; click-through to ride/driver detail; SOS alert handling: real-time banner + alert list, ride focus, contact info access (permission-gated), resolution notes (linked note/ticket stub until M14).
**AC:** UC-A-19/20 end-to-end on the simulation harness; map stays live at demo scale; permission-gated; tests green.

### M10-T5 — Comms integration
E2e: ride with chat both ways + quick replies + push; call button opens dialer with the right number; share link opened in a plain browser tracks live then dies at completion; SOS fires: dialer + admin alert + red pin + permanent event.
**AC:** scripted walkthrough passes on real devices for dial/share/push.

### M10-T6 — Review audit
Audit against CHAT/CALL/SHARE/SAFE/ADM-03, UC-S-13…16, UC-A-19/20; share-token security review; SOS path latency check.
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4) → T5 → T6
```

## Milestone acceptance criteria
- Chat, dial, share, SOS all work on real devices within their exact validity windows.
- The share page leaks nothing beyond SHARE-02's list and dies on time.
- SOS is permanent, instant to admins, and visible on the live map.
- Tracker updated; review audit passed.

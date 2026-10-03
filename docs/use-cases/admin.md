# Labby — Admin Use Cases

Scope: **V1 only.** All admin-dashboard use cases are listed **flat** — RBAC permission mapping onto them comes later (owner decision). Every mutating use case below is implicitly audit-logged (RBAC-05) and permission-checked server-side (RBAC-03); this is not repeated per use case. Shared behaviors that also apply to admins (login UC-S-02, logout UC-S-03, password flows UC-S-04/05) live in `shared.md` — admin accounts are never self-registered (AUTH-06).

---

## Access Control

### UC-A-01 — Create an admin account
**Actor:** Super Admin
**Main flow:** Super Admin enters the new admin's phone + name, assigns exactly **one role** → account created with a set-password path (OTP to the admin's phone) → new admin logs in with phone + password.
**Exceptions:** E1 Phone already an account → existing account is granted the admin role + role assignment instead of a duplicate.
**SRS:** AUTH-06, RBAC-01

### UC-A-02 — Manage admin accounts
**Actor:** Super Admin
**Main flow:** list admins → change an admin's role (single role per admin, effective immediately) → deactivate/reactivate admin accounts.
**Exceptions:** E1 Deactivating the last Super Admin → blocked.
**SRS:** RBAC-01

### UC-A-03 — Manage roles and permissions
**Actor:** Super Admin
**Main flow:**
1. View roles with their permission sets (3-table RBAC: `roles` / `permissions` / `role_permissions`).
2. Create a role: name + tick permissions from the code-seeded catalog.
3. Edit a role's permissions → instantly affects every admin holding it.
4. Delete a custom role.
**Exceptions:** E1 System roles (`is_system`: Super Admin, Support) → undeletable; Super Admin's permission set immutable. E2 Deleting a role still assigned to admins → blocked until they're reassigned.
**SRS:** RBAC-01, RBAC-02, RBAC-04

### UC-A-04 — View the audit log
**Main flow:** open audit log → filter by actor, action type, target, date → inspect entries (actor, action, target, before/after, timestamp). Append-only; no deletion exists.
**SRS:** RBAC-05

---

## Regions & Pricing

### UC-A-05 — Create a region
**Main flow:**
1. Define name + geographic boundary, currency, emergency number.
2. Add service types with pricing (base / per-km / per-min / **minimum fare**).
3. Set time-window surcharges, cancellation grace + fee, wait grace + rate, pickup-distance threshold + rate.
4. Set commission tiers, incentive values, suspension thresholds, surge caps.
5. Activate region. (Ops note surfaced: load the region's map extract once routing is self-hosted — ASM-04.)
**Exceptions:** E1 Missing mandatory config → region cannot activate; saved as draft.
**SRS:** ADM-01, PRC-01, SD-01

### UC-A-06 — Edit region configuration
**Main flow:** open region → edit any part of the bundle → changes apply to **new** rides only (in-flight rides keep their locked values).
**SRS:** ADM-01, PRC-01, PRC-03

### UC-A-07 — Manage service types
**Main flow:** add/edit/disable a region's service types and their pricing → disabled types stop appearing in booking; existing rides unaffected.
**Exceptions:** E1 Disabling a type with claimed scheduled rides → warning listing them; admin resolves first.
**SRS:** ADM-01, PRC-01

### UC-A-08 — Draw and manage surge zones
**Main flow:** open the region map → draw/edit/delete polygon zones → set per-zone threshold steps + multiplier cap → zones go live with the next surge cycle (2 min).
**Alternates:** A1 Area outside all zones → always 1.0×.
**SRS:** PRC-02, ADM-01

### UC-A-09 — Manually override surge
**Main flow:** pick a zone → set a manual multiplier (within the cap) or reset to automatic → takes effect next cycle; override state visible on the live map and in the zone list.
**SRS:** PRC-02

---

## Driver Operations

### UC-A-10 — Review a driver application
**Main flow:**
1. Open the applications queue (`submitted`/`under_review`).
2. Inspect documents (photos, numbers, expiries) and vehicle details.
3. Decide: **approve** (assign the vehicle's allowed service types → driver role activates), **request changes** (per-item notes → `needs_changes`), or **reject** (reason).
4. Applicant notified at every stage change.
**Exceptions:** E1 Duplicate plate flag → resolve before approval.
**SRS:** DRV-02, DRV-03

### UC-A-11 — Review a vehicle switch
**Main flow:** open vehicle-review queue → inspect the new vehicle's registration + insurance → approve (assign service types; new vehicle becomes the active one) or reject (driver keeps the old vehicle).
**SRS:** DRV-03

### UC-A-12 — Monitor document expirations
**Main flow:** dashboard lists upcoming expiries (30/7-day horizon) and already-expired documents (auto-suspended drivers) → admin reviews renewal submissions → approval lifts the suspension automatically.
**SRS:** DRV-04

---

## Users & Trust

### UC-A-13 — Search and inspect a user
**Main flow:** search by phone/name → full profile: roles + states, ratings per role, ride history, wallet balances + transactions, driver ledger (if driver), reports (made/received), tickets, badges/level, audit trail of admin actions on them.
**SRS:** ADM-05

### UC-A-14 — Suspend / reactivate a user (role-level)
**Main flow:** pick user → suspend or reactivate a specific role (or whole account) with a mandatory reason → user notified with the reason; matching/booking immediately reflects the state.
**Alternates:** A1 Auto-suspended users (rating USR-05, doc expiry DRV-04) appear with the triggering rule; reactivation of rating-suspensions is a manual decision here.
**SRS:** USR-04, USR-06, USR-05

### UC-A-15 — Grant wallet credit / issue a refund
**Main flow:** from a user's profile or a ticket → grant credit (amount + currency + mandatory reason, linked to ride/ticket when applicable) → wallet credited instantly; user notified.
**SRS:** PAY-03, PAY-01

### UC-A-16 — Review flagged accounts
**Main flow:** open the flagged queue — low-rating alerts (RATE-03), metric warnings (DRV-07), report-threshold flags (REP-03) → inspect evidence → act (warn via support, suspend per UC-A-14, or dismiss the flag with a note).
**SRS:** RATE-03, DRV-07, REP-03

### UC-A-17 — Process a user report
**Main flow:**
1. Open the reports queue → pick a report.
2. Investigate with the ride record: GPS trace, chat log, fare, prior history of both parties.
3. Resolve `substantiated` / `unsubstantiated` + notes; reporter notified of the outcome.
**Postconditions:** substantiated count feeds REP-03 flagging.
**SRS:** REP-02, REP-03, CHAT-03

---

## Rides & Live Operations

### UC-A-18 — Search and inspect rides
**Main flow:** search/filter rides (region, state, date, user, kind) → detail: full state timeline, GPS trace on map, fare breakdown, chat log, offers trail (which drivers declined/timed out), payments, related reports/tickets/SOS.
**SRS:** ADM-05, TRK-03, PRC-04, RIDE-03

### UC-A-19 — Operate the live map
**Main flow:** open the live ops map for a region → online driver dots (idle vs on-ride), active ride routes, surge-zone overlay, red SOS pins → click any element through to its detail.
**SRS:** ADM-03

### UC-A-20 — Respond to an SOS alert
**Trigger:** real-time SOS alert (push + dashboard)
**Main flow:**
1. Alert names the ride; the live map centers on it, flagged red.
2. Admin inspects live position, parties, contact options (click-to-dial numbers are visible to admins with the permission).
3. Admin follows the incident operationally (contact user, monitor ride) and records actions in a linked ticket/note until stand-down.
**Postconditions:** SOS event permanent on the ride record.
**SRS:** SAFE-01, SAFE-02, ADM-03

---

## Support & Content

### UC-A-21 — Handle support tickets
**Main flow:** open the ticket queue (sorted priority + age) → assign/engage → message the user in the thread → move states (`in_progress`, `waiting_on_user`, `resolved`, `closed`) → user notified at each change.
**Alternates:** A1 Override a ticket's priority. A2 Resolve with a wallet-credit remedy → UC-A-15 inline.
**SRS:** SUP-02, SUP-03

### UC-A-22 — Track lost-item cases
**Main flow:** open the lost-items queue → case detail (ride, item description/photos, reopened chat visible) → progress the status (`driver_contacted → found/not_found → returned → closed`); both parties notified on changes.
**SRS:** LOST-02, CHAT-03

### UC-A-23 — Manage the help center
**Main flow:** CRUD categories and articles in **EN + AR**, order them, publish/unpublish → apps render published content immediately.
**Exceptions:** E1 Publishing with a missing language version → blocked (both languages required, NFR-I1).
**SRS:** SUP-04, NFR-I1

### UC-A-24 — Manage ticket categories
**Main flow:** CRUD the ticket category list (name EN/AR + default priority) → new tickets use the updated list; existing tickets keep their category.
**SRS:** SUP-01, SUP-03

### UC-A-25 — Review feedback
**Main flow:** browse feedback submissions → filter by category/date → tag entries → counts-by-category/time view for trends.
**SRS:** FDBK-01

---

## Growth & Money

### UC-A-26 — Manage promo codes
**Main flow:** create a promo (% or fixed, max-discount cap, validity window, total + per-user limits, region/service restriction, first-ride-only flag) → monitor redemptions → deactivate anytime (future use blocked; past applications untouched).
**SRS:** GRW-01, GRW-02

### UC-A-27 — Record a settlement
**Trigger:** driver settles cash debt or receives a payout off-app
**Main flow:** open the driver's ledger → record settlement (amount, direction pay-in/pay-out, note) → balance updates; if it rises above the floor, the driver's offer block lifts automatically and the driver is notified.
**SRS:** COM-03, COM-04

### UC-A-28 — Manage challenges
**Main flow:** create a challenge (target role, region, time window, goal, reward points) → monitor live participation/completion → completed challenges auto-credit rewards; admin can end a challenge early (completions so far honored).
**SRS:** GAME-02

### UC-A-29 — Configure incentives, commissions and thresholds
**Main flow:** per region, edit commission tiers, weekly/peak/rating incentive values, driver balance floor, suspension thresholds, report-flag threshold, metric-warning thresholds → changes apply from the next evaluation cycle (weekly recalcs, next ride, next surge cycle as applicable).
**SRS:** COM-02, COM-03, DRV-08, USR-05, DRV-07, REP-03, ADM-01

---

## Analytics

### UC-A-30 — Use the analytics dashboard
**Main flow:** open dashboard → cards/charts with date-range + region filters: Rides (volume, completion vs cancellation, by region/service, over time) · Revenue (gross fares, commission, by region) · Users (signups, active riders/drivers, drivers online now) · Ops (avg pickup ETA, acceptance rate, active surge zones).
**SRS:** ADM-02

### UC-A-31 — Export CSV
**Main flow:** on rides / users / drivers / transactions / tickets lists → "Export CSV" respecting active filters → file downloads; export recorded in the audit log.
**SRS:** ADM-06

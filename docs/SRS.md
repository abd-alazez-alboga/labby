# Labby — Software Requirements Specification

**Version:** 1.0 (draft for approval)
**Date:** 2026-10-03
**Audience:** the owner and Claude (working document; terse by design)
**Product:** Labby — a multi-region ride-hailing platform (open marketplace model)

---

## 1. Introduction

### 1.1 Purpose
This SRS defines the complete requirements for the Labby ride-hailing platform. It covers the **full product vision**, with every requirement tagged by delivery version:

- **V1** — the first implemented version: fully functional, real business grade, free of paid third-party dependencies except where explicitly decided (FCM, owner's SMS gateway).
- **V2** — committed follow-up scope.
- **Future** — acknowledged, intentionally unscheduled.

Requirement IDs (`AUTH-01`, `RIDE-03`, …) are stable and will be referenced by the milestone plan that follows this document.

### 1.2 Product overview
Labby is a real business starting small: an Uber-style **open marketplace** where independent, verified drivers serve riders using their own vehicles, with the platform taking a configurable commission. The platform operates in **multiple regions from V1**, each with its own currency, pricing, zones, and rules.

### 1.3 Products & stack (fixed)
| Client | Technology |
|---|---|
| Rider app | React Native (Android 10+ / iOS 15+) |
| Driver app | React Native (Android 10+ / iOS 15+) |
| Admin dashboard | React (web) |
| Backend API | Spring Boot (Java), PostgreSQL |

Repository layout: **monorepo** (backend + both RN apps + admin web).

### 1.4 Branding (fixed)
Name **Labby**; logo/icon in `assets/images/` (purple tri-spoke mark + wordmark, white variant, standalone icon); color system in `assets/theme/colors.scss` (primary `#59128A`, logo purple `#592D87`, lavender/lilac accents, tinted backgrounds, hero/button gradients). All three clients use this shared theme; UI requirements reference these tokens.

### 1.5 Actors
| Actor | Description |
|---|---|
| Rider | Books and pays for rides via the Rider app. |
| Driver | Verified marketplace driver with own vehicle; accepts and fulfills rides via the Driver app. |
| Super Admin | Fixed system role: full access; manages admin accounts, roles, regions. |
| Admin | Admin user holding exactly one RBAC role (e.g. predefined "Support", or custom roles). |
| System | Automated behaviors: dispatch, pricing, surge, notifications, auto-suspension, bonuses. |

---

## 2. Scope Decisions (SD)

| ID | Decision | Version |
|---|---|---|
| SD-01 | Multi-region support fully functional in V1: admins create/manage regions, each with its own pricing config, currency, service types, zones, and rules. | V1 |
| SD-02 | Full RBAC in V1: Super Admin, custom roles with granular permissions (3-table model: `roles`, `permissions`, `role_permissions`), audit log. | V1 |
| SD-03 | External-service policy: no paid/account-based services in V1 **except Firebase FCM** (owner-supplied credentials). Free/open services allowed: public OSM tiles, public OSRM, device GPS. Real SMS via owner's phone gateway app. Mocked behind swappable interfaces: payments, social login. | V1 |
| SD-04 | Branding fixed per §1.4. | V1 |

---

## 3. External Services & Integration Design (ES)

| ID | Service | Design |
|---|---|---|
| ES-01 | **SMS delivery — real (V1)** | Owner-operated Android SMS-gateway app on the owner's phone, called via its HTTP API with a token (app name, token, endpoint supplied by owner at implementation time). Carries all OTPs: registration verification, password reset, 2FA. Swappable `SmsSender` interface; V2 = commercial gateway. Constraints: gateway phone must be online; carrier caps apply; no delivery guarantee. **All environments send real SMS** — no dev bypass code path; dev/test environments may instead contain seeded pre-verified accounts (data, not code). |
| ES-02 | **Authentication** | Phone number is the sole identity. Register: phone → SMS OTP → verify → set password + name. Login: phone + password (never OTP). Password reset via OTP. 2FA (SMS OTP) only for: password change, phone-number change, account deletion. **No email exists anywhere in the system.** |
| ES-03 | **Push — real (V1)** | Firebase Cloud Messaging. Owner supplies service-account JSON (backend) + RN app configs at implementation time. |
| ES-04 | **Maps / routing / ETA** | V1 uses **public OSM tile servers + public OSRM demo server**. Recorded constraints: rate limits, no availability guarantee, usage policies prohibit production-scale traffic. Therefore **migration to self-hosted OSM/OSRM (or a paid provider) is a mandatory pre-launch gate**, not an optional V2 item. All access via `RoutingProvider` interface + configurable tile URL so migration is config/infra only. |
| ES-05 | **Voice contact** | Native `tel:` click-to-dial from both apps; phone numbers visible to the matched counterpart **by design — final decision, no masking planned**. No VoIP. |
| ES-06 | **Payments** | Cash + earned-credit wallet only (see PAY). No top-ups, no fake money. `PaymentProvider` interface reserves the V2 gateway seam. |
| ES-07 | **Social login** | V2. Auth model keeps room for OAuth identities to attach to existing phone-based accounts (addition, not migration). |

---

## 4. Functional Requirements

### 4.1 AUTH — Registration & Authentication

> As a new user, I register with only my phone number and a password, verify via SMS, and use one account everywhere.

| ID | Requirement | Ver |
|---|---|---|
| AUTH-01 | Registration from either app: enter phone → receive SMS OTP → verify → set password + name. Rider app grants rider role immediately; Driver app additionally opens a driver application (DRV-01). AC: unverified phones cannot complete registration; duplicate phone → login/reactivation path. | V1 |
| AUTH-02 | Login = phone + password from any app the account holds a role for. Token-based sessions; logout invalidates. AC: rider-only account cannot access Driver-app features. | V1 |
| AUTH-03 | Password reset: phone → SMS OTP → new password. | V1 |
| AUTH-04 | OTP policy (all flows): 6 digits · 5-min expiry · max 5 wrong attempts per code · 60 s resend cooldown · max 5 codes per phone per hour. Codes stored hashed, bound to a **purpose** (register / reset / 2FA) — a code is only valid for the operation it was issued for. | V1 |
| AUTH-05 | 2FA (SMS OTP) required for exactly: password change, phone-number change, account deletion. **Never for login (including admin login).** | V1 |
| AUTH-06 | Admin accounts created only by a Super Admin (never self-registered); log in with phone + password. | V1 |
| AUTH-07 | Dev/test environments may contain seeded pre-verified accounts (inserted as data; no OTP code path is bypassed). | V1 |

### 4.2 USR — Accounts, Roles & States

| ID | Requirement | Ver |
|---|---|---|
| USR-01 | One account per phone, holding one or both of rider/driver roles. A rider becomes a driver by applying in the Driver app with the same account; driver role activates on approval. | V1 |
| USR-02 | Ratings tracked **per role**; wallet **shared** across roles. | V1 |
| USR-03 | Profile: name, photo, language (EN/AR). Rider extras: saved locations, comfort preferences, matching toggles. Driver extras: vehicle, availability. | V1 |
| USR-04 | Account states `active / suspended / deleted`, with **role-level granularity** (driver role may be suspended while rider role stays active). Every state change notifies the user with the reason. | V1 |
| USR-05 | Auto-suspension on rating: per-role threshold + minimum rated-rides count, configurable per region. Defaults: driver < 3.0 avg after ≥ 20 rated rides; rider < 2.5 after ≥ 10. | V1 |
| USR-06 | Manual suspend/reactivate/deactivate by admins holding the permission; audit-logged with actor + reason. | V1 |
| USR-07 | Account deletion (behind 2FA) = **soft delete**: state `deleted`, all data retained, account unusable. Re-registering with that phone **automatically reactivates** the account after OTP verification (history, wallet, ratings intact; password reset available). | V1 |

### 4.3 RBAC — Admin Access Control

> Admin permissions follow a 3-table model: `roles`, `permissions`, `role_permissions`. Permissions are a code-seeded catalog; roles are admin-managed; each admin holds exactly one role.

| ID | Requirement | Ver |
|---|---|---|
| RBAC-01 | Super Admin: seeded system role, irremovable, permission set immutable (full access); manages admin accounts and roles. | V1 |
| RBAC-02 | Role management: create/edit/delete custom roles by ticking permissions from the catalog (`role_permissions` junction). Changing a role instantly affects every admin holding it. System roles (`is_system`) are undeletable. | V1 |
| RBAC-03 | Every admin API endpoint enforces its required permission server-side; admin UI additionally hides unauthorized functions. | V1 |
| RBAC-04 | Predefined, editable **Support** role ships by default: ride/user read access + ticket, report, and lost-item handling; no system config, no financial config. | V1 |
| RBAC-05 | Append-only audit log of all admin actions (actor, action, target, before/after where sensible, timestamp); viewable by Super Admin, filterable. | V1 |

### 4.4 RIDE — Booking & Lifecycle

> As a rider, I book a ride, watch my driver arrive, and pay a metered fare with a full breakdown.

| ID | Requirement | Ver |
|---|---|---|
| RIDE-01 | Booking: pickup (map pin / search / saved), destination, ≤ 3 intermediate stops, service type, payment method (cash/wallet), matching toggles → **fare estimate** (OSRM route × region pricing × locked surge), clearly labeled as an estimate, before confirmation. | V1 |
| RIDE-02 | State machine: `requested → offering → accepted → driver_arrived → in_progress → completed`; exits `cancelled_by_rider`, `cancelled_by_driver`, `no_driver_found`. Every transition timestamped and pushed to both parties. | V1 |
| RIDE-03 | **Sequential dispatch**: candidates ranked by pickup ETA (respecting rider toggles, service type, region, driver online state & vehicle class); offers show pickup, **destination**, estimated fare, surge flag; decline/timeout → next candidate. Offer window 15 s; dispatch gives up after 10 min / candidate exhaustion. Offers feed acceptance metrics. | V1 |
| RIDE-04 | Driver taps **Arrived** (allowed within 100 m geofence of pickup); rider notified; wait-time grace clock starts. Rider boards; driver taps **Start ride**. | V1 |
| RIDE-05 | In-ride: live tracking both sides, chat/dial available, rider may change destination or add stops (≤ 3 total); estimate updates, metering unaffected. | V1 |
| RIDE-06 | Completion: final fare = region pricing × **actual GPS distance + actual duration** × surge (locked at request) + extras (wait, pickup-distance fee) − discounts/credits, floored at the region/service **minimum fare**. Itemized breakdown to both; cash confirmed by driver or wallet auto-deducted; receipt generated; both prompted to rate. | V1 |
| RIDE-07 | Cancellation: free within grace (default 2 min post-acceptance); afterwards a fee applies (default 2, per region + service type). Driver cancellations: never charge the rider, require a reason, feed the driver's cancellation metric. | V1 |
| RIDE-08 | `no_driver_found` after exhaustion/timeout: rider notified with one-tap retry. | V1 |

**Scheduled rides (RIDE-S)**

| ID | Requirement | Ver |
|---|---|---|
| RIDE-S1 | Schedule for any future time (**no horizon cap**), same booking options; estimate flagged "priced at ride time" (surge evaluated at execution). | V1 |
| RIDE-S2 | **Claim board**: scheduled requests visible to drivers whose availability windows cover the slot (same region + service type); claiming locks driver ↔ ride, notifies rider. | V1 |
| RIDE-S3 | Reminders to both parties (defaults 24 h + 1 h before); claimed rides convert to live flow at pickup time from `accepted`. | V1 |
| RIDE-S4 | Unclaimed shortly before pickup (default 15 min) → normal live dispatch; failing that, rider notified early enough to replan. | V1 |

**Public shared rides (RIDE-P)**

| ID | Requirement | Ver |
|---|---|---|
| RIDE-P1 | A rider creates a shared ride: **one pickup point, one destination**, departure time (or "when full"), total seats, own party size. | V1 |
| RIDE-P2 | Riders browse/search open shared rides (region, destination, time) and join **automatically, first-come**, with party size; join blocked when remaining seats < party size. | V1 |
| RIDE-P3 | Dispatch triggers **manually by the creator** or **automatically when seats fill**; matching requires sufficient vehicle capacity. | V1 |
| RIDE-P4 | Final metered fare split **per seat**; each party pays via its own method (cash/wallet); individual receipts; each member may rate the driver. | V1 |
| RIDE-P5 | Members may leave before dispatch (seats freed); creator cancel before dispatch cancels the group (all notified). After dispatch, normal cancellation rules per member. | V1 |

### 4.5 TRK / CHAT / SHARE / NTF — Tracking & Communication

| ID | Requirement | Ver |
|---|---|---|
| TRK-01 | Driver app streams GPS every **5 s whenever online** (configurable); stops when offline. Powers dispatch, heatmap, surge, live ops map. | V1 |
| TRK-02 | From acceptance: rider sees driver's live position, route, continuously refreshed OSRM ETA; driver sees pickup, then route + stops. | V1 |
| TRK-03 | Full GPS trace stored per ride — source of truth for metered fares, receipt route maps, dispute review. **Retention: forever.** | V1 |
| TRK-04 | Driver stream silent > 30 s → excluded from new offers until updates resume; mid-ride → "connection lost" indicator both sides. | V1 |
| CHAT-01 | Per-ride chat thread: open from acceptance until **24 h after completion**, then read-only. An open lost-item case on the ride reopens it until the case closes. | V1 |
| CHAT-02 | Text + one-tap quick replies (localized EN/AR); push on new message; unread indicators. | V1 |
| CHAT-03 | Chat history retained; visible to admins with support permission (disputes, lost items). | V1 |
| CALL-01 | Click-to-dial (ES-05) from ride screen and chat header, both parties, while the chat window is open. | V1 |
| SHARE-01 | During an active ride, rider **or driver** can generate a trip-share link (OS share sheet). | V1 |
| SHARE-02 | Link opens a **no-login web page**: live position, driver first name + photo, vehicle model/color/plate, ETA, status. Unguessable token; page dies at ride completion/cancellation. | V1 |
| NTF-01 | All push via FCM, localized. Categories: ride events, chat, scheduled-ride reminders, promotions, account/system. | V1 |
| NTF-02 | Per-category opt-out — except ride-critical and safety notifications, which always deliver. | V1 |
| NTF-03 | **In-app notification center** in all three clients: chronological, read/unread, deep links; stored server-side (survives reinstall/device change). | V1 |

### 4.6 PRC / PAY / COM / GRW — Pricing & Money

> Fares are metered; surge comes from admin-drawn zones; cash and an earned-credit wallet carry all V1 payments; every movement lands in an append-only ledger.

| ID | Requirement | Ver |
|---|---|---|
| PRC-01 | Fare engine per region + service type: base, per-km, per-min, **minimum fare** (default 1.50), admin-defined time-window surcharges (e.g. rush +25%). Applied to actual GPS distance + duration. | V1 |
| PRC-02 | **Surge**: admin-drawn polygon zones per region. Every 2 min (configurable): demand ÷ supply per zone (open requests vs idle online drivers) → multiplier via admin thresholds (defaults ≥2→1.2×, ≥3→1.5×, ≥5→2.0×), capped per region. Multiplier from the **pickup zone**, shown before booking, **locked at request time**. Outside any zone = 1.0×. Admin manual override per zone. | V1 |
| PRC-03 | Extras in the same engine: wait-time (grace 5 min, then per-minute, default 0.25), pickup-distance fee (default threshold 10 km, 0.50/km, gated by rider toggles), cancellation fees — all per region. | V1 |
| PRC-04 | Every fare stores its full component breakdown (base, distance, time, surcharge, surge, wait, pickup fee, discounts, tip); receipts/history render from stored components, never recomputed. | V1 |
| PAY-01 | One wallet per account with **per-currency balances**; credits spendable only in matching-currency regions (no conversion in V1). Sources: referral, promo, loyalty redemption, refunds, admin grants. Never negative; **no top-ups**. | V1 |
| PAY-02 | Payment at completion: `cash` (driver confirms collection) or `wallet`; insufficient wallet → wallet pays what it can, **remainder due in cash**, shown to both. | V1 |
| PAY-03 | Refunds = admin-issued wallet credits (permission-gated, audit-logged, linked to ride/ticket). | V1 |
| PAY-04 | Tips: in-app from wallet during ride or ≤ 24 h after, suggested amounts; **100% to driver, commission-free**. Cash tips happen outside the app. | V1 |
| COM-01 | Driver earnings ledger per ride: wallet-paid → fare − commission credited; cash-paid → commission **debited** (driver keeps cash). Tips/bonuses credit. Every entry itemized. | V1 |
| COM-02 | Tiered commission (defaults 25% / 20% > 100 / 15% > 200 weekly trips; per region): each driver's rate recalculated weekly from the previous week's completed trips. | V1 |
| COM-03 | Driver balance below floor (default **−50**) → no new offers until settled; driver warned before and at blocking. | V1 |
| COM-04 | Admin settlement screen records off-app money movement: driver pay-ins (cash commission debt) and payouts of positive balances. V1 moves no real money; it records the truth. | V1 |
| GRW-01 | Promo codes (admin): % or fixed discount, max-discount cap, validity window, total + per-user usage limits, region/service restriction, first-ride-only flag. Applied at booking, itemized in breakdown. | V1 |
| GRW-02 | First-ride discount = a promo with the first-ride flag (no separate machinery). | V1 |
| GRW-03 | Referrals: unique code/link per user; referee enters at registration; on referee's **first completed ride** both sides get wallet credit (defaults 5 + 5, configurable). Self-referral and reactivation abuse blocked (reactivated deleted account ≠ new user). | V1 |
| GRW-04 | Loyalty (riders): 1 point per currency unit spent on completed rides; manual redemption, default 100 pts → 5 credit (per region). Balance + history in-app. | V1 |

### 4.7 DRV — Driver Lifecycle & Operations

| ID | Requirement | Ver |
|---|---|---|
| DRV-01 | Application (Driver app, existing account): personal details + 4 documents — government ID, driver's license, vehicle registration, insurance — each photo + number + **expiry date**; vehicle details (make, model, year, color, plate, seats, photos). | V1 |
| DRV-02 | Staged review: `submitted → under_review → needs_changes → approved / rejected`; admin queue; per-item correction requests (driver resubmits only those); every stage change notifies the applicant. Approval activates the driver role. | V1 |
| DRV-03 | One active vehicle per driver. At approval the **admin assigns the service types** the vehicle may serve. Vehicle switch = new registration + insurance reviewed; old vehicle active until new approved. Riders see make/model/color/plate/photo. | V1 |
| DRV-04 | Document expiry: reminders 30 and 7 days before; on expiry the driver role **auto-suspends** until a renewed document is approved. Admin dashboard lists upcoming expirations. | V1 |
| DRV-05 | Availability: online/offline toggle (gates live offers) + weekly availability schedule (gates the scheduled-ride board). | V1 |
| DRV-06 | Driver dashboard: acceptance rate, cancellation rate, on-time % (**arrived ≤ 5 min after the ETA quoted at acceptance**), avg rating, trips, earnings — rolling 7/30-day windows. | V1 |
| DRV-07 | Metric warnings (no auto-suspension except rating): acceptance < 50% or cancellation > 15% (configurable) → in-app warning + admin flag. | V1 |
| DRV-08 | Incentives (per region, live progress visible): weekly trip bonuses (defaults 50 @ 40+, 100 @ 60+); peak-hour bonus (+1.00/completed trip in admin windows); weekly rating reward (20 @ avg ≥ 4.8 with ≥ 30 trips). All credit COM-01. | V1 |
| DRV-09 | Live demand heatmap in Driver app: surge zones colored by demand/supply, refreshed with the surge cycle. | V1 |

### 4.8 RATE / SAFE / REP / SUP / LOST / GAME / FDBK — Trust, Safety & Engagement

| ID | Requirement | Ver |
|---|---|---|
| RATE-01 | Post-ride, both parties prompted to rate (1–5 + optional text). Skippable; 7-day window; one rating per ride; immutable. | V1 |
| RATE-02 | Per-role averages on profiles and matching contexts; **aggregates only** — the rated party never sees which ride/person produced a rating. | V1 |
| RATE-03 | Rolling average crossing the warning threshold (above USR-05 levels) flags the account on the admin dashboard. | V1 |
| SAFE-01 | SOS button (both apps, prominent in active rides): opens native dialer with the region's emergency number **and** records an SOS event (ride, GPS, timestamp) that flags the ride red + real-time alert to support admins. | V1 |
| SAFE-02 | SOS events are permanent and never deletable. | V1 |
| REP-01 | Riders report drivers and drivers report riders (categories: unsafe driving, inappropriate behavior, vehicle condition, other; text/photos), during or after a ride. | V1 |
| REP-02 | Reports enter an admin queue; investigation has ride record, GPS trace, chat log at hand; resolution `substantiated / unsubstantiated` + notes; audit-logged. | V1 |
| REP-03 | **3 substantiated reports in 90 days** (configurable) auto-flags the account for status review — flag only; suspension stays human/ratings-driven. | V1 |
| SUP-01 | Tickets from both apps: user-selected category (admin-managed list), description, attachments, optional ride link. | V1 |
| SUP-02 | Lifecycle `open → in_progress → waiting_on_user → resolved → closed` with a user↔support message thread; state changes notify; status/history in-app. | V1 |
| SUP-03 | Category carries default priority; admin override; queue sorted by priority + age. | V1 |
| SUP-04 | Help center: admin CMS (categories + articles, EN/AR, ordered, draft/published); in-app rendering with search; ticket form shows help center first. | V1 |
| LOST-01 | Lost-item report against a completed ride (description + photos) opens a case and **reopens the ride chat** until case closure. | V1 |
| LOST-02 | Cases are a ticket subtype: `reported → driver_contacted → found / not_found → returned → closed`; support tracks to closure. | V1 |
| GAME-01 | System milestone badges (fixed catalog: 10th/50th/100th ride, first shared ride, first referral, 5-star week, …), auto-awarded + notified, shown on own profile. | V1 |
| GAME-02 | Admin-created challenges: time-boxed goals per role per region ("5 rides this weekend → 100 points"); live progress; auto-credited rewards. | V1 |
| GAME-03 | Levels from **lifetime** points (riders: loyalty earned; drivers: trips + challenges); spending points never lowers a level; level on profile. | V1 |
| FDBK-01 | Categorized feedback/suggestions (not ride-bound); admin browse/filter/tag; counts-by-category/time view. | V1 |

### 4.9 ADM — Administration & Analytics

| ID | Requirement | Ver |
|---|---|---|
| ADM-01 | Region management: full config bundle — name + boundary, currency, emergency number, service types + pricing (base/km/min/minimum), time-window surcharges, surge zones (map-drawn) + thresholds + cap, cancellation/wait/pickup-fee values, commission tiers, incentive values, suspension thresholds. New-region setup notes the map-extract ops step. Edits audit-logged. | V1 |
| ADM-02 | Analytics dashboard with date-range + region filters: Rides (volume, completion vs cancellation, by region/service, over time) · Revenue (gross fares, commission, by region) · Users (signups, active riders/drivers, drivers online now) · Ops (avg pickup ETA, acceptance rate, active surge zones). | V1 |
| ADM-03 | **Live operations map** per region: online driver dots (idle/on-ride), active ride routes, surge overlay, red SOS pins; click-through to detail. | V1 |
| ADM-04 | Work queues (permission-gated): driver applications, reports, tickets, lost items, settlements, flagged accounts. | V1 |
| ADM-05 | Entity management: users (search, full history, suspend/reactivate, wallet grants), rides (search, detail + GPS trace + chat log), vehicles, promos, challenges, help-center CMS, notification categories. | V1 |
| ADM-06 | CSV export on key lists (rides, users, drivers, transactions, tickets), respecting filters; exports audit-logged. | V1 |

---

## 5. Data Requirements

Conceptual model (entities → PostgreSQL schema at implementation). **Retention: everything kept forever** — rides, GPS traces, chat, ledgers, audit logs. All money/audit tables are append-only; balances are derivable.

### 5.1 Identity & access
- **users** — phone (unique identity), password hash, name, photo, language, state (`active/suspended/deleted`; soft delete, auto-reactivation on re-registration).
- **role_assignments** — user × (`rider`/`driver`/`admin`), per-role state, timestamps.
- **roles / permissions / role_permissions** — admin RBAC, 3-table design. `permissions` is a code-seeded catalog (e.g. `rides.view`, `users.suspend`, `pricing.edit`, `settlements.record`); `roles` carries `is_system` (Super Admin, Support seeded); each admin user references exactly **one** role.
- **otp_codes** — phone, hashed code, **purpose** (`register/reset/2fa`), expiry, attempts (see AUTH-04; purpose binds a code to the operation it authorizes).
- **audit_log** — append-only: actor, action, target, before/after, timestamp.

### 5.2 Driver domain
- **driver_profiles** — application status, cached metrics, current commission rate.
- **documents** — owner, type (ID/license/registration/insurance), number, expiry, photo, review status.
- **vehicles** — driver, make/model/year/color/plate/seats/photos, admin-assigned service types, active flag (**exactly one active per driver**), review status.
- **availability_windows** — driver, weekday, time range.

### 5.3 Regions & pricing config
- **regions** — name, boundary, currency, emergency number + settings bundle (cancellation, wait, pickup-fee, commission tiers, incentive values, suspension thresholds).
- **service_types** — region, name, base/km/min/minimum fare.
- **surcharge_windows** — region/service, window, %.
- **surge_zones** — region, polygon, thresholds + cap, current multiplier, manual override.

### 5.4 Rides
- **rides** — rider, driver, vehicle, region, service type, kind (`on_demand/scheduled/shared`), state + per-transition timestamps, pickup/destination/stops, locked surge multiplier, payment method, estimate.
- **ride_offers** — ride × driver, offered_at, response (`accepted/declined/timeout`) — dispatch trail, feeds metrics.
- **scheduled_ride_ext** — scheduled time, claim state, claiming driver, reminder/fallback timestamps.
- **shared_ride_ext** — creator, seats, members + party sizes, dispatch trigger, per-seat shares.
- **ride_traces** — per-ride GPS points (ts, lat/lng).
- **driver_locations** — current position + updated_at while online.
- **fares** — stored component breakdown + total + currency.

### 5.5 Money
- **wallet_balances** — user × currency (never negative); **wallet_transactions** — typed, signed, linked to ride/ticket.
- **driver_ledger** — signed entries (`fare_credit/commission_debit/bonus/tip/settlement`); balance may run negative to the floor.
- **settlements** — driver, amount, direction, recording admin, ts.
- **promos / promo_redemptions**; **referrals** (referrer, referee, code, status, rewards); **points_accounts / points_transactions** (redeemable balance + lifetime total; lifetime drives levels).

### 5.6 Communication, safety, engagement
- **chat_threads / messages** (per ride, window per CHAT-01); **notifications** (server-stored, backs NTF-03); **trip_share_links** (token, dead at ride end).
- **ratings** (ride × rater-role unique, immutable); **reports** (status, resolution); **sos_events** (permanent).
- **support_tickets / ticket_messages**; lost-item cases = ticket subtype with own statuses + ride/chat link.
- **help_categories / help_articles** (EN/AR, draft/published); **feedback**.
- **badges / user_badges / challenges / challenge_progress**; level config.

---

## 6. Non-Functional Requirements

### 6.1 Performance
| ID | Requirement |
|---|---|
| NFR-P1 | Engineered + load-tested for **1,000 concurrent active users** (incl. ~300 drivers streaming GPS @ 5 s). The overview's 10,000 target is a **V2 commitment** gated on load testing. |
| NFR-P2 | Ride request → first offer ≤ 3 s under normal load; API reads p95 ≤ 500 ms; location ingestion keeps 5 s cadence without backlog at target scale. |
| NFR-P3 | Displayed live positions never staler than one update cycle (5 s) + network latency, at target scale. |
| NFR-P4 | Stateless API, no instance-local state: scaling to V2 numbers must be deployment work, not redesign. |

### 6.2 Availability & recovery
| ID | Requirement |
|---|---|
| NFR-A1 | V1: single production server, **~99% uptime** target stated honestly. 99.9% + redundancy = V2. |
| NFR-A2 | Automated nightly full DB backups, 30-day retention, off-server; documented restore procedure **tested periodically**. RPO ≤ 24 h, RTO ≤ 4 h. |
| NFR-A3 | Graceful degradation: OSRM/tiles unreachable → straight-line estimates flagged "approximate," never a hard failure; FCM down → notification center still records everything. |

### 6.3 Security
| ID | Requirement |
|---|---|
| NFR-S1 | Passwords bcrypt/argon2; OTPs stored hashed; TLS everywhere; short-lived tokens with refresh rotation. |
| NFR-S2 | Driver documents + photos stored privately; access only via authenticated, permission-checked, expiring URLs. |
| NFR-S3 | All permission/ownership checks server-side; rate limiting on auth + OTP endpoints (AUTH-04 enforced at API layer). |
| NFR-S4 | Secrets (SMS token, Firebase JSON, DB creds) in environment/config management, never in the repository. |

### 6.4 I18n, usability, maintainability
| ID | Requirement |
|---|---|
| NFR-I1 | Full EN + AR: every string, notification, SMS template localized; complete **RTL layouts** across all clients; instant language switch in settings. |
| NFR-I2 | Locale-correct currency/date/number formatting per region; one consistent Arabic numeral choice everywhere (decided at design time). |
| NFR-U1 | Device floor: Android 10+ / iOS 15+; admin dashboard: latest 2 versions of Chrome/Firefox/Safari/Edge. |
| NFR-U2 | Driver in-ride screens: glanceable — large targets, quick replies over typing, no interaction needed to follow navigation. |
| NFR-M1 | Modular monolith (Spring Boot) with enforced provider seams (`SmsSender`, `PaymentProvider`, `RoutingProvider`, push); OpenAPI-documented REST; versioned DB migrations from day one. |

---

## 7. Constraints & Assumptions

### 7.1 Constraints (CON)
| ID | Constraint |
|---|---|
| CON-01 | Stack fixed (§1.3); **monorepo**. |
| CON-02 | Branding fixed (§1.4). |
| CON-03 | **No email anywhere** — phone is the sole identity and contact channel (plus push). |
| CON-04 | External-service policy per SD-03/ES-04, including the **mandatory pre-launch migration off public OSM/OSRM**. |
| CON-05 | V1 records money movement, never executes it (settlements/payouts off-app, logged). |
| CON-06 | V1 posture: single server, ~99%, 1,000 concurrent; horizontal scalability preserved architecturally. |

### 7.2 Assumptions & dependencies (ASM)
| ID | Assumption |
|---|---|
| ASM-01 | Owner supplies at implementation: Firebase credentials (service-account JSON + RN configs) and SMS gateway app token/endpoint. |
| ASM-02 | SMS gateway phone stays powered/online/within carrier limits — OTP availability bounded by it (accepted risk). |
| ASM-03 | Public OSRM/OSM adequate during development; blocks/rate-limits are accepted dev risk (NFR-A3 mitigates; pre-launch migration resolves). |
| ASM-04 | Each new region brings the ops step of loading its map extract once routing is self-hosted (noted in ADM-01). |
| ASM-05 | Legal/regulatory work (transport licensing, privacy regime, insurance standards) is launch-gate work per region, not V1 software scope — beyond what's built in (terms consent at registration, retention, audit logs). |
| ASM-06 | In-person verification + background checks (Future) layer onto the existing DRV review stages without schema change. |

---

## 8. V2 & Future Registers

### 8.1 V2 (committed follow-up)
| Item | Notes |
|---|---|
| Social login (Google/Facebook/Apple) | Attaches OAuth identities to phone accounts (ES-07). |
| Commercial SMS gateway | Replaces owner-phone gateway behind `SmsSender`. |
| Real payment gateway | Cards + digital wallets behind `PaymentProvider`; wallet top-ups. |
| Suspension appeals workflow | In-app contest + review. |
| Designated pickup points | Curated per-region locations. |
| Traffic/history-adjusted ETAs | Beyond raw OSRM. |
| Weather / special-event pricing factors | External data feeds. |
| Cross-currency conversion + consolidated reporting | Exchange-rate feed. |
| Split fare between riders | Multi-party payment flow. |
| Optimal-hours analytics for drivers | Needs accumulated history. |
| Driver training modules | Content + activation gate. |
| Tax documentation for drivers | Region-specific. |
| Demand forecasting + high-demand alerts | Prediction on history. |
| Empty-return (deadhead) compensation | Config-heavy payout rule. |
| Custom report builder | Beyond ADM-02/ADM-06. |
| Number masking | Only if the no-masking stance is ever revisited; **currently: not planned**. |
| 10,000 concurrent + 99.9% uptime | Load-tested, redundant deployment. |
| Gamification extensions | Leaderboards, streaks on the V1 engine. |

### 8.2 Future (unscheduled)
| Item | Notes |
|---|---|
| Background screening + in-person verification | Ops processes on DRV stages (ASM-06). |
| Algorithmic ride-share matching | Route overlap, mid-ride pickups, distance-weighted splits, creator approval of joiners. |
| Ride-anomaly monitoring | Route-deviation/stop detection + response workflow; needs real-data threshold tuning. |

### 8.3 Deleted (decided against — not deferred)
| Item | Reason |
|---|---|
| PIN pickup verification | Edge cases (e.g. booking for a phone-less friend) outweigh the benefit — owner decision. |
| Email (any use) | Phone-only platform. |
| VoIP in-app calling | Click-to-dial chosen instead, numbers visible by design. |

---

## 9. Configurable Defaults (shipped values)

All admin-configurable (mostly per region); these are the values V1 ships with.

| Setting | Default |
|---|---|
| OTP | 6 digits, 5-min expiry, 5 attempts, 60 s resend cooldown, 5/phone/hour |
| Dispatch offer window / give-up | 15 s / 10 min |
| "Arrived" geofence | 100 m |
| Cancellation grace / fee | 2 min / 2 |
| Wait-time grace / rate | 5 min / 0.25 per min |
| Pickup-distance fee | > 10 km, 0.50/km |
| Minimum fare | 1.50 |
| Surge cycle / thresholds / example steps | 2 min; ≥2→1.2×, ≥3→1.5×, ≥5→2.0×, region cap |
| Scheduled reminders / fallback | 24 h + 1 h / 15 min before pickup |
| Chat window after completion | 24 h |
| Driver stale-stream exclusion | 30 s |
| Auto-suspend rating | driver < 3.0 @ ≥ 20 rides; rider < 2.5 @ ≥ 10 |
| Metric warnings | acceptance < 50%; cancellation > 15% |
| On-time definition | arrival ≤ 5 min after quoted ETA |
| Commission tiers | 25% / 20% > 100 / 15% > 200 weekly trips (weekly recalc) |
| Driver balance floor | −50 |
| Weekly trip bonuses | 50 @ 40+, 100 @ 60+ |
| Peak-hour bonus | +1.00 per trip in window |
| Rating reward | 20 @ avg ≥ 4.8 with ≥ 30 trips/week |
| Referral reward | 5 referrer + 5 referee, on first completed ride |
| Loyalty | 1 pt per currency unit; 100 pts → 5 credit |
| Report escalation flag | 3 substantiated / 90 days |
| Document expiry reminders | 30 + 7 days |
| Backups | nightly, 30-day retention, RPO ≤ 24 h, RTO ≤ 4 h |

---

## 10. Glossary

**Claim board** — list where drivers with matching availability claim scheduled rides. · **Dispatch** — sequential offering of a ride to ranked candidates. · **Driver balance** — net of the driver ledger; may run negative via cash-ride commission debt. · **Grace period** — free-cancellation or free-waiting window. · **Metered fare** — final fare from actual GPS distance + duration. · **OTP** — one-time SMS code bound to a purpose. · **Region** — top-level operating/config unit (currency, pricing, zones, rules). · **Service type** — vehicle class/price tier within a region. · **Settlement** — off-app money handover recorded in-app. · **Shared ride** — rider-created public ride others join; one pickup, one destination, per-seat split. · **Soft delete** — account marked deleted, data retained, auto-reactivates on re-registration. · **Surge zone** — admin-drawn polygon whose demand/supply ratio sets a fare multiplier. · **Wallet** — per-currency earned-credit balances; no top-ups in V1.

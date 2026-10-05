# Labby — Shared Use Cases (Rider & Driver)

Scope: **V1 only.** Use cases performed identically (or nearly so) by riders and drivers; role files reference these by ID instead of duplicating them. Where a step differs per role, the difference is called out inline. Admin-relevant variants are noted where they exist.

ID convention: `UC-S-xx` (shared), referenced from `rider.md` (`UC-R-xx`), `driver.md` (`UC-D-xx`), `admin.md` (`UC-A-xx`).

---

## Account & Authentication

### UC-S-01 — Register an account
**Actor:** unregistered person · **Trigger:** opens Rider or Driver app, taps "Create account"
**Preconditions:** phone number not belonging to an `active`/`suspended` account
**Main flow:**
1. User enters phone number.
2. System validates format + rate limits (AUTH-04) and sends a 6-digit OTP via the SMS gateway (purpose `register`).
3. User enters the OTP; system verifies code, purpose, expiry, attempt count.
4. User sets password and name; accepts terms of service.
5. System creates the account (`active`), grants the **rider role** (Rider app). In the **Driver app**, the system additionally opens a driver application (→ UC-D-01).
6. User lands authenticated in the app.
**Alternates:**
- A1 Phone belongs to a `deleted` account → reactivation path (UC-S-08) instead of new account.
- A2 User requests OTP resend → allowed after 60 s cooldown, max 5 codes/phone/hour.
- A3 Registration abandoned after OTP → no account persists; phone reusable immediately.
**Exceptions:**
- E1 OTP expired (5 min) → prompt to request a new code.
- E2 5 wrong attempts → code invalidated; user must request a new code.
- E3 Hourly OTP cap reached → blocked with retry-later message.
- E4 SMS gateway unreachable → user-visible "code could not be sent, try again later"; no account created.
- E5 Phone already registered and active → redirect to login.
**Postconditions:** verified account exists with ≥1 role; audit of consent stored.
**SRS:** AUTH-01, AUTH-04, ES-01, ES-02

### UC-S-02 — Log in
**Actor:** rider / driver / admin · **Trigger:** opens app/dashboard while signed out
**Main flow:**
1. User enters phone + password.
2. System verifies credentials and that the account holds a role valid for this client (rider/driver app, admin dashboard).
3. Session tokens issued; user lands on the role's home screen.
**Alternates:**
- A1 Account holds both roles → each app logs into its own role context.
**Exceptions:**
- E1 Wrong credentials → generic error; rate limiting after repeated failures (NFR-S3).
- E2 Account `suspended` (role-level) → login succeeds but the suspended role's functions are blocked with the suspension reason shown; a rider-suspended/driver-active account can still drive.
- E3 Account `deleted` → treated as no account; offer registration (which reactivates, UC-S-08).
- E4 No valid role for this client (e.g. rider-only account in admin dashboard) → access denied.
**Postconditions:** authenticated session; login not OTP-gated (AUTH-05).
**SRS:** AUTH-02, AUTH-05, USR-04

### UC-S-03 — Log out
**Main flow:** user taps logout → tokens invalidated server-side → returned to sign-in screen. Driver extra: going offline is forced first (active ride blocks logout, E1).
**Exceptions:** E1 Driver with an active ride → logout blocked until ride completes/cancels.
**SRS:** AUTH-02

### UC-S-04 — Reset forgotten password
**Trigger:** "Forgot password" on login screen
**Main flow:**
1. User enters phone; system sends OTP (purpose `reset`, AUTH-04 limits).
2. User enters OTP; system verifies.
3. User sets a new password; all existing sessions invalidated.
**Exceptions:** E1–E3 as UC-S-01 (expiry, attempts, rate cap). E4 Phone not registered → same neutral "code sent if the number exists" response (no account enumeration).
**SRS:** AUTH-03, AUTH-04, NFR-S3

### UC-S-05 — Change password (2FA)
**Preconditions:** logged in
**Main flow:** user enters current password → system sends OTP (purpose `2fa`) → user enters OTP → sets new password → other sessions invalidated.
**Exceptions:** wrong current password; OTP failures per AUTH-04.
**SRS:** AUTH-05

### UC-S-06 — Change phone number (2FA)
**Main flow:**
1. User requests change, enters new phone.
2. System checks the new phone isn't held by an active/suspended account.
3. OTP (purpose `2fa`) sent to the **current** phone and verified.
4. OTP (purpose `2fa`) sent to the **new** phone and verified. *(Deliberate deviation from the original `register` purpose, owner-approved at M2 review: a `register`-purpose code on the new phone could be consumed by a genuine registration attempt for that number; `2fa` scopes it to this logged-in flow.)*
5. Phone updated; identity continuity preserved (rides, wallet, ratings untouched).
**Exceptions:** E1 New phone already in use → rejected. E2 Either OTP fails per AUTH-04 → change aborted, nothing mutated.
**SRS:** AUTH-05, ES-02

### UC-S-07 — Delete account (2FA, soft)
**Preconditions:** no active ride; driver balance not below floor (must settle first)
**Main flow:**
1. User requests deletion; system shows consequences (access ends; data retained; phone re-registration reactivates).
2. OTP (purpose `2fa`) verified.
3. Account state → `deleted`; sessions invalidated; user invisible to matching/search.
**Exceptions:** E1 Active ride → blocked until finished. E2 Driver with debt below floor → blocked pending settlement (COM-03). E3 OTP failure → aborted.
**Postconditions:** soft-deleted; all data retained (USR-07).
**SRS:** USR-07, AUTH-05

### UC-S-08 — Reactivate a deleted account by re-registering
**Trigger:** registration flow (UC-S-01) detects phone of a `deleted` account
**Main flow:**
1. System sends OTP (purpose `register`); user verifies.
2. Account state → `active`; prior roles, history, wallet, ratings restored.
3. User logs in with the old password, or uses UC-S-04 to set a new one.
**Postconditions:** the original account is live again — it is **not** a new user (referral logic treats it accordingly, GRW-03).
**SRS:** USR-07, GRW-03

---

## Profile & Preferences

### UC-S-09 — Edit profile
**Main flow:** user updates name and/or profile photo → saved and reflected across clients. Photo stored privately (NFR-S2).
**Exceptions:** invalid image type/size → rejected with reason.
**SRS:** USR-03

### UC-S-10 — Switch language (EN/AR)
**Main flow:** user picks language in settings → UI switches instantly, including full RTL layout for Arabic; preference persists to the account and applies to notifications and SMS templates.
**SRS:** NFR-I1, USR-03

### UC-S-11 — View notification center
**Main flow:** user opens the center → server-stored chronological list (respecting category filters), read/unread state, tap deep-links to the target screen (ride, chat, ticket, promo).
**Alternates:** A1 Fresh install/new device → history still present (server-side).
**SRS:** NTF-03

### UC-S-12 — Configure notification preferences
**Main flow:** user toggles categories (promotions, etc.) → preference saved and honored for push + center.
**Exceptions:** E1 Ride-critical and safety categories cannot be disabled — toggle shown locked.
**SRS:** NTF-02

---

## In-Ride Communication & Safety

### UC-S-13 — Chat with ride counterpart
**Actors:** rider ↔ driver · **Preconditions:** ride in `accepted`…`completed` + 24 h window (or reopened by a lost-item case)
**Main flow:**
1. Either party opens the ride chat.
2. Sends free text or a one-tap quick reply (localized EN/AR).
3. Counterpart receives push + unread badge; messages persist.
**Alternates:** A1 Window expired → thread visible read-only. A2 Lost-item case open → thread reopened until case closure.
**Exceptions:** E1 Offline recipient → message stored; delivered on reconnect; push via FCM when possible.
**SRS:** CHAT-01, CHAT-02, CHAT-03

### UC-S-14 — Call ride counterpart (click-to-dial)
**Preconditions:** chat window open (same validity as UC-S-13)
**Main flow:** user taps call → native dialer opens pre-filled with the counterpart's real number → call happens outside the app.
**Note:** numbers visible **by design**; no masking (ES-05).
**SRS:** CALL-01, ES-05

### UC-S-15 — Share trip with a trusted contact
**Actors:** rider or driver, during an active ride
**Main flow:**
1. User taps "Share trip" → system generates an unguessable link.
2. User shares it via the OS share sheet.
3. Recipient (no login) sees live position, driver first name + photo, vehicle model/color/plate, ETA, status.
**Exceptions:** E1 Ride ends/cancels → page immediately dead.
**SRS:** SHARE-01, SHARE-02

### UC-S-16 — Trigger SOS
**Actors:** rider or driver, prominent during active rides
**Main flow:**
1. User taps SOS.
2. Native dialer opens pre-filled with the **region's emergency number**.
3. Simultaneously an SOS event (ride, GPS, timestamp) is recorded; the ride is flagged red on the admin live map and support admins receive a real-time alert.
**Postconditions:** SOS event permanent, never deletable.
**SRS:** SAFE-01, SAFE-02, ES-05

---

## Trust & Quality

### UC-S-17 — Rate the counterpart after a ride
**Preconditions:** ride `completed`; within 7 days; not yet rated by this party
**Main flow:** rating prompt (1–5 stars + optional text) → submit → per-role average recalculated.
**Alternates:** A1 Skip → re-accessible from ride history until the window closes.
**Exceptions:** E1 Window expired → rating refused. E2 Duplicate → refused (immutable, one per ride per rater).
**Postconditions:** aggregates updated; threshold crossings fire admin flags (RATE-03) or auto-suspension (USR-05).
**SRS:** RATE-01, RATE-02, RATE-03, USR-05

### UC-S-18 — Report the counterpart
**Trigger:** during or after a ride
**Main flow:** user picks category (unsafe driving / inappropriate behavior / vehicle condition / other — mirrored categories for reporting riders), adds text/photos → report enters the admin queue → reporter notified of resolution outcome (substantiated or not, without internal notes).
**Postconditions:** 3 substantiated reports in 90 days auto-flags the reported account (REP-03).
**SRS:** REP-01, REP-02, REP-03

---

## Support & Engagement

### UC-S-19 — Create a support ticket
**Main flow:**
1. User opens support; help center shown first (UC-S-21).
2. User proceeds to "create ticket": picks category (admin-managed list), writes description, attaches files, optionally links a ride.
3. Ticket created `open` with the category's default priority; user notified of creation.
**SRS:** SUP-01, SUP-03, SUP-04

### UC-S-20 — Track and respond to a support ticket
**Main flow:** user views ticket list/status → opens thread → exchanges messages with support → receives push on every state change → ticket reaches `resolved`, user can reply to reopen discussion until `closed`.
**Alternates:** A1 `waiting_on_user` → reminder surfaces in notification center.
**SRS:** SUP-02

### UC-S-21 — Browse the help center
**Main flow:** user opens help → categories → articles (in own language) → search by keyword.
**Alternates:** A1 Article not helpful → "create ticket" path (UC-S-19).
**SRS:** SUP-04

### UC-S-22 — Submit feedback / suggestion
**Main flow:** user opens feedback form (not ride-bound) → picks category, writes text → submitted for admin review; no per-item response promised.
**SRS:** FDBK-01

### UC-S-23 — View badges and level
**Main flow:** user opens profile → sees earned badges (with award dates), current level, lifetime points. New badges arrive with a push + center entry.
**SRS:** GAME-01, GAME-03

### UC-S-24 — View and progress a challenge
**Preconditions:** admin-created challenge active for the user's role + region
**Main flow:** user opens challenges → sees goal, time window, live progress → completes the goal through normal activity → reward points auto-credited + notification.
**Exceptions:** E1 Window lapses before completion → challenge closes, no partial reward.
**SRS:** GAME-02

### UC-S-25 — Receive a push notification
**Main flow:** event occurs → FCM push in user's language → notification also recorded in the center (NTF-03).
**Alternates:** A1 Category muted by user → center-only, no push (except critical). A2 FCM undeliverable → center still records it (NFR-A3).
**SRS:** NTF-01, NTF-02, NTF-03, ES-03

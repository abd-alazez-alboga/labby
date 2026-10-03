# M2 — Auth & Accounts

> Status lives in `README.md`. Prereq: M1 `review_passed`.
> **Owner input needed at T6:** SMS gateway app token + endpoint.

## User stories
- As a new user, I register with my phone + SMS OTP and a password, in either app. (UC-S-01, AUTH-01)
- As a returning user, I log in with phone + password — never an OTP. (UC-S-02, AUTH-02/05)
- As a user, I can reset my password, change my phone or password (2FA), edit my profile, switch language, and soft-delete my account knowing re-registration restores it. (UC-S-04…09, USR-07)
- As the owner, dev/test uses seeded pre-verified accounts so routine testing never burns SMS. (AUTH-07)

## Scope
SRS: AUTH-01…07, USR-01 (account+roles model), USR-03 (base profile), USR-04 (states, without admin UI), USR-07, ES-01, ES-02, NFR-S1/S3. Driver-role *application* content is M5 — here the Driver app only gates on "no driver role → application placeholder".

**Out:** RBAC/admin management (M3), driver application (M5), notification center (M6).

## Tickets

### M2-T1 — Auth contract & migrations
OpenAPI spec for all auth/account endpoints (register start/verify/complete, login, refresh, logout, reset, change-password, change-phone, delete, profile CRUD, language); DTOs; Flyway migrations: `users`, `role_assignments`, `otp_codes` (hashed code, **purpose**, expiry, attempts); seeder design for dev accounts.
**AC:** OpenAPI reviewed against AUTH-01…07/USR-01…07; migrations apply cleanly; entity conventions per PROJECT-STRUCTURE (UUID PK, audit columns, soft-delete pattern on users).

### M2-T2 — Auth backend
`SmsSender` interface + SMS-gateway implementation (token/endpoint from env) ; OTP service enforcing AUTH-04 (6 digits, 5 min, 5 attempts, 60 s cooldown, 5/hour, purpose-bound, hashed); registration incl. deleted-account auto-reactivation; JWT access+refresh with rotation; password flows; phone change (double OTP); 2FA gates on the three operations; soft delete; profile endpoints; role-aware login contexts; rate limiting on auth endpoints; profile-gated dev seeder with pre-verified accounts.
**AC:** unit + integration tests cover every exception path in UC-S-01…08 (expiry, attempts, caps, reactivation, duplicate phone, suspended-role login); OTP never logged or returned in any API response; bcrypt/argon2 verified; ArchUnit still green.

### M2-T3 — Rider app auth screens
Register (phone → OTP → password+name), login, forgot password, profile edit, change password/phone, delete account, language setting. Mocked API until T6 (contract-driven).
**AC:** all flows navigable with validation + error states for every UC-S exception; RTL correct; component tests green.

### M2-T4 — Driver app auth screens
Same flows as T3 plus: post-login gate — account without approved driver role sees an "apply to drive" placeholder (real application in M5).
**AC:** as T3; gate shows for non-drivers and disappears for accounts seeded with driver role.

### M2-T5 — Admin login
Admin dashboard: login (phone+password), session handling, logout; access denied for accounts without the admin role; seeded Super Admin account for dev.
**AC:** non-admin accounts rejected with a clear message; session expiry handled gracefully; tests green.

### M2-T6 — Auth integration (real SMS)
Wire the real SMS gateway (owner provides token/endpoint — ask now, record in `.env.example` shape only, never commit values). End-to-end: register, reset, 2FA flows on real devices/emulators with real SMS; seeded accounts verified to bypass nothing except data.
**AC:** full register→login→change-password→delete→reactivate cycle passes against the real gateway; secrets only in env.

### M2-T7 — Review audit
Audit against SRS AUTH/USR sections + UC-S-01…12, structure conformance, security review (token handling, OTP storage, rate limits), test adequacy.
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4 ∥ T5) → T6 → T7
```

## Milestone acceptance criteria
- A real phone can register via real SMS in both apps; dev works entirely on seeded accounts.
- Every AUTH/USR requirement in scope demonstrably enforced server-side.
- No OTP or secret ever appears in logs, responses, or the repo.
- Tracker updated; review audit passed.

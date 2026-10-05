# Review — M2 Auth & Accounts milestone audit (`372a53f..HEAD`)
_7 commits · 199 files (+16,468/−144) · reviewed 2026-10-05 · HEAD = dc3ffdd_

Audited by four parallel component reviewers (backend, rider, driver, admin) + a consolidating
cross-boundary pass (contract alignment, secrets scan, cross-app pattern verification).

## Summary

M2 delivers a security-literate auth stack: AUTH-04 OTP policy enforced to the letter and proven
at unit + HTTP level, refresh rotation with family revocation on reuse, enumeration neutrality
beyond what the SRS demands, contract-exact API layers in all three clients, and live
verification on a real device through the real Traccar SMS gateway (register, reset, 2FA,
delete→reactivate, plus the rate limiter and login throttle observed firing). The endpoint sets
of the OpenAPI contract, backend mappings, and all three clients align exactly; no secret
appears anywhere in the range. What keeps this from a clean pass: one explicitly AC-mandated
test path (suspended-role login) has zero coverage, an RTL double-flip will mis-mirror rows in
both RN apps once the native restart applies forced RTL, and two deliberate-or-not deviations
(phone-change OTP purpose, access-token revocation window) need an owner decision on record.

**Verdict:** Pass with comments — findings below go through `/labby-fix` (+ scoped re-audit)
before M2 is `review_passed`.
**Findings:** Critical 0 · High 1 · Warning 6 · Info 5 (+7 more nitpicks) · Praise 6

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| T1: OpenAPI covers all auth/account endpoints per AUTH-01..07/USR-01..07 | Met | `backend/docs/api/auth-v1.yaml` — all 16 endpoints; clients mirror it 1:1 (path-set comparison exact) |
| T1: migrations apply cleanly; entity conventions per PROJECT-STRUCTURE | Met | V2/V3 run in every Testcontainers test; UUID PKs, audit columns; soft-delete-as-state deviation documented at the point of deviation (V2 header, User javadoc) |
| T2: tests cover every UC-S-01..08 exception path | **Partial** | Expiry/attempts/caps/cooldown/reactivation/duplicate-phone/purpose-binding all covered; **suspended-role login (UC-S-02 E2) has zero coverage** → finding H1 |
| T2: OTP never logged nor returned; bcrypt verified; ArchUnit green | Met | All 6 src/main log statements audited; OtpCode stores bcrypt hash only, asserted in test; BCrypt beans; ArchUnit 7/7 |
| T3: rider flows navigable, validation + error states per UC-S exceptions, RTL, tests green | Met | Every mapped status (400/401/403/409/410/429) per flow has a distinct localized test-covered state; 52/52 green. RTL correct pre-restart; post-restart double-flip → finding W1 |
| T4: driver = T3 + apply-to-drive gate shows/disappears by role | Met | Three-way `Stack.Protected` gating incl. launch-profile refresh so approval re-evaluates without re-login; 50/50 green |
| T5: non-admin rejected w/ clear message; session expiry graceful; tests green | Met | 403→notAdmin mapping w/ `role="alert"`; single-flight refresh, expiry notice; 32/32 green |
| T6: full register→login→change-password→delete→reactivate cycle vs real gateway; secrets env-only | Met | Live device verification 2026-10-05 (recorded in tracker; backend request shape pinned by SmsGatewaySenderTest); `git log -p` secrets scan clean |
| Milestone: real phone registers via real SMS; dev entirely on seeded accounts | Met | Live run; `DevDataSeeder` is data-only (no code-path bypass), per AUTH-07 |
| Milestone: AUTH/USR enforced server-side | Met w/ deviations | AUTH-04 exact; AUTH-05 2FA on exactly the 3 ops; deviations → W2 (phone-change OTP purpose), W4 (revocation window) |
| Milestone: no OTP or secret in logs, responses, repo | Met | Dev-profile DEBUG is app-logger only; SMS bodies never logged; repo scan clean |
| Milestone: tracker updated | Met | Current and accurate (one count off by one → nitpick) |

## Critical

None.

## High

**H1 · tests · Certainty: High** — `backend/src/test/` (suite-wide)
M2-T2's AC explicitly enumerates "suspended-role login" among the exception paths to cover;
`grep -ri suspend backend/src/test` matches nothing. The behavior *likely* works
(`AuthServiceImpl.login:141` excludes only DELETED; `RoleAssignmentDto` exposes state) but the
AC is a test-coverage criterion and this named path is unproven — also the only AC in the
milestone not fully met.
**Fix:** integration test seeding a suspended `role_assignment` (and a suspended account):
assert login 200 with `roles[].state == "suspended"` in the profile, and whatever client-facing
contract the owner intends for a fully suspended account.

## Warning

**W1 · correctness (RTL) · Certainty: Medium** — `apps/rider/src/screens/settings-screen.tsx:208-210`,
`register-screen.tsx:343-345`, `profile-edit-screen.tsx:207-209`, `apps/rider/src/components/form.tsx`
(reveal-toggle `start`/`end` overrides); same pattern in driver: `apps/driver/src/components/auth/ui.tsx:367`
(`checkboxRowRtl`) + its reveal toggle; both apps call `I18nManager.forceRTL` (rider
`locale-context.tsx:40-51`, driver `i18n/index.ts:62-63`).
Manual RTL overrides key off the locale flag alone. After the documented app restart applies
native RTL, RN flips `flexDirection:'row'` and logical `start`/`end` by itself — the manual
overrides then flip those rows/positions *back*, rendering Arabic mirrored-wrong post-restart.
Correct pre-restart; wrong after, in both apps.
**Fix:** derive an "effective flip" flag (`isRTL && !I18nManager.isRTL`) in each locale provider
and key row/position overrides on it (text alignment can stay keyed on locale).

**W2 · srs-conformance · Certainty: High (deviation exists; impact Low)** —
`backend/src/main/java/com/labby/backend/service/MeServiceImpl.java:134,149`
UC-S-06 step 4 specifies the new-phone OTP uses purpose `register`; the implementation issues
and validates it as `2fa`, undocumented. Codes are phone-bound and the new phone is asserted
free, so practical risk is low — but it's a silent deviation (CLAUDE.md conduct rule).
**Fix:** switch to `OtpPurpose.REGISTER` for the new-phone step, or record the deviation as a
deliberate owner-approved decision in the contract/design notes.

**W3 · security · Certainty: Medium** — `backend/src/main/resources/application.yml:52`
`jwt-secret: ${JWT_SECRET:change-me-to-a-long-random-secret}` is a *usable* committed default
(33 bytes — long enough that jjwt's weak-key guard won't trip). A prod deploy that forgets the
env var silently signs all tokens with a repo-public secret.
**Fix:** drop the default so boot fails fast without `JWT_SECRET`, or reject the placeholder
under the prod profile.

**W4 · security/srs-conformance · Certainty: Medium** —
`backend/src/main/java/com/labby/backend/security/JwtAuthFilter.java:36-49`
Logout / password change / reset / delete / reuse-revocation revoke refresh tokens only; access
tokens (carrying a `sid` claim that points at the refresh-token row) are never checked against
`revoked_at`, so a revoked session's access token works for up to 900 s. UC-S-03 says "tokens
invalidated server-side". Mitigations: deleted accounts blocked in `loadUsableUser`, short TTL.
**Fix:** check `sid` revocation in the filter (one indexed lookup), or document the ≤15-min
window as an accepted trade-off with owner sign-off.

**W5 · robustness · Certainty: High** — `apps/rider/src/api/http-client.ts:106-109`,
`apps/rider/src/auth/auth-context.tsx:123-133`
Any non-ok refresh response — including transient 500/429 — clears tokens and signs the user
out (contract reserves 401 for invalid/revoked). Likewise, launch with tokens but no cached
profile treats *any* `getMe` failure (incl. offline) as fatal and destroys the session. A flaky
backend or a cold start in a tunnel logs riders out. Driver app's equivalents should be checked
for the same pattern during the fix.
**Fix:** clear + emit session-expiry only on 401 (/403 where applicable); on network/5xx keep
tokens and fail the request.

**W6 · tests · Certainty: High** — `apps/admin/src/test/` and `apps/driver/src/__tests__/`
The T6 UX surfaces shipped without coverage: admin's show-password toggle (no test asserts the
`type` flip / `aria-pressed` swap), and driver's change-password escape hatch (sign-out →
reset flow across a guard flip — exactly the regression-prone interaction) plus both
start-over paths. Rider covers its equivalents; the gaps are admin + driver.
**Fix:** one admin toggle test; driver tests for escape hatch and the two start-over paths.

## Info (max 5)

1. **integration** — `register/complete` 409 (concurrent-registration race, auth-v1.yaml) falls
   to the generic error in both RN apps (rider `register-screen.tsx:151-155`, driver
   `register-screen.tsx:137`) with no phone-taken/start-over affordance.
2. **robustness** — Logout revocation is sent with the possibly-expired access token in all
   three clients (admin `AuthContext.tsx:96`, driver `AuthProvider.tsx:50-58`, rider
   equivalent); a 401 leaves the refresh token un-revoked server-side (local session still
   cleared). Route logout through the authed/refresh-capable client.
3. **UX** — Phone-change wizards have no resend affordance (contract has no resend endpoint for
   the flow); rider additionally carries dead cooldown wiring (`change-phone-screen.tsx:30,57,80`
   arms a cooldown nothing consumes).
4. **mess** — Unused i18n keys added in range: rider `common.back`, `common.cancel`, and
   `changePassword.sendCode` (orphaned by the T6 staged rewrite).
5. **UX/srs** — Driver gate copy tells an approved-but-*suspended* driver "you don't have an
   active driver role yet… apply here" (`auth-types.ts:60-64` + `gate.body`); UC-S-02 E2 wants
   the suspension reason, which the contract can't carry yet — needs distinct copy or a recorded
   deferral.

+7 more nitpicks — ask to see them.

## What's good

- Refresh rotation with **family revocation on reuse**, proven by a test that the rotated-to
  token also dies (`AuthFlowIntegrationTest`).
- OTP attempt counting in a `REQUIRES_NEW` transaction with `noRollbackFor`, so failed attempts
  persist through outer rollbacks — a subtlety most implementations miss.
- Anti-enumeration beyond spec: rate-limit and SMS-delivery failures also fold into the neutral
  204 on reset-start, with tests asserting no SMS leaves for unknown *and* deleted phones.
- Integration harness stubs only the `SmsSender` boundary and reads OTPs out of captured SMS
  bodies "like a phone would" — honoring ES-01's no-bypass rule end to end.
- Contract-level fetch-stub test style in all three clients (request bodies/headers asserted
  against auth-v1.yaml; undeclared requests fail loudly).
- Every template deviation documented at the point of deviation (soft-delete-as-state in the V2
  header; Checkstyle scoping in pom.xml) — exactly how PROJECT-STRUCTURE adaptations should look.

## Pre-existing (out of scope, non-blocking)

- Arabic brand rename **لابي → لبي** pending across all three apps (owner decision during T6);
  includes pre-existing keys, a handful of new-in-range strings consistent with the old name,
  and one driver test asserting the old spelling (`login-and-gate.test.tsx:183`).
- Admin `client.ts:38` header spread would drop `Headers`-instance headers (all callers pass
  plain objects); `expiresInSeconds` unused (reactive refresh covers expiry).
- Swagger UI public by default (M1 decision, unchanged); palette lacks error/success tokens
  (driver carries local ones).

## Test run results

| Suite | Command | Result |
|---|---|---|
| Backend | `cd backend && make check` (spotless + checkstyle + `mvn verify`, Testcontainers) | **BUILD SUCCESS — 79/79**, 0 skipped (tracker said 80 — off by one) |
| Rider | `cd apps/rider && npm run check` | **52/52**, lint + `tsc` clean |
| Driver | `cd apps/driver && npm run check` | **50/50**, lint + `tsc` clean |
| Admin | `cd apps/admin && npm run check` | **32/32**, eslint + prettier + `tsc -b` clean |

Cross-boundary checks (consolidator): OpenAPI paths ⇔ backend mappings ⇔ rider/driver/admin
call sets align exactly; `git log -p 372a53f..HEAD` contains no token-like values (only
`change-me` placeholders and a unit-test literal).

---

## Resolution (2026-10-05, commits 9d8ebed…98839d0)

Owner decisions: W2 → keep purpose `2fa` and document the deviation (a `register`-purpose code on
the new phone could be consumed by a real registration; UC-S-06 updated). W4 → implement the
revocation check. Info 5 → distinct suspended copy now; reason display deferred until the contract
carries suspension reasons. Info 3 → remove dead wiring only, no new resend UX.

| Finding | Outcome | Where |
|---|---|---|
| H1 suspended-role login untested | Fixed — integration test asserts login 200 + `roles[].state == suspended` | `AuthFlowIntegrationTest.shouldLoginWithSuspendedRoleStateExposed` (9d8ebed) |
| W1 RTL double-flip (both apps) | Fixed — `flipRows` (`locale RTL && !I18nManager.isRTL`) now keys every structural override (rows, toggle positions) in rider and driver | 464fe53, f528beb |
| W2 phone-change OTP purpose | Accepted deviation, documented in UC-S-06 | docs/use-cases/shared.md (9d8ebed) |
| W3 usable JWT-secret default | Fixed — no fallback; boot fails fast; tests supply their own | application.yml, AbstractIntegrationTest (9d8ebed) |
| W4 access-token revocation window | Fixed — JwtAuthFilter checks the `sid` session row via a new `SessionService` (ArchUnit-compliant); logout test proves immediate 401 | 9d8ebed |
| W5 transient-failure sign-outs | Fixed in rider AND driver — refresh clears the session only on contract 401; rider launch keeps tokens on network failure; pinned by tests in both apps | 464fe53, f528beb |
| W6 missing T6-UX tests | Fixed — admin reveal-toggle test; driver escape-hatch + register start-over + change-password start-over tests | 98839d0, f528beb |
| Info 1 register/complete 409 | Fixed in both apps — routes to the phone-taken → login path, tested | 464fe53, f528beb |
| Info 2 logout with stale access token | Fixed in driver + admin (authed client) with a mid-logout rotation guard; **rider half was a false positive** (already authed) — rider gained the rotation guard | 464fe53, f528beb, 98839d0 |
| Info 3 dead cooldown wiring | Fixed — removed from rider change-phone; no new resend UX added | 464fe53 |
| Info 4 unused i18n keys | Fixed — `common.back`, `common.cancel`, `changePassword.sendCode` removed (EN+AR) | 464fe53 |
| Info 5 suspended-driver gate copy | Fixed — distinct EN+AR copy keyed on suspended driver role; reason display deferred (recorded in tracker) | f528beb |

Post-fix suites: backend 81/81 (`make check`, incl. spotless/checkstyle/ArchUnit), rider 54/54,
driver 54/54, admin 33/33 — all with lint/typecheck/format green.

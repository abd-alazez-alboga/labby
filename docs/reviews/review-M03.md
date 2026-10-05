# Review — M3 RBAC & admin foundation (`26d780f..ff1740f`)
_17 commits · 82 files · reviewed 2026-10-05_

## Summary
M3 delivers the full RBAC foundation: a clean 3-table model with a DB-enforced append-only audit log (V4), per-request DB resolution of `domain:action` authorities (which makes the "role edits apply instantly" AC structural rather than incidental), `@PreAuthorize` on every admin endpoint, and an admin UI whose gating reuses the backend's permission strings verbatim with deny-by-default. Every ticket AC is met with direct evidence, both test suites are green, and the T4 live walkthrough confirmed the whole loop against the real stack. The two findings carried in from T4 are both confirmed in code; neither blocks the milestone. One additional design-level security note (permission-based self-escalation) is flagged for an owner decision.

**Verdict:** Pass with comments
**Findings:** Critical 0 · High 0 · Warning 2 · Info 4 · Praise 4

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| **T1:** Super Admin + Support roles seeded | met | `V4__rbac.sql:66-69` fixed UUIDs; `RbacMigrationIntegrationTest.shouldSeedSystemRoles` |
| **T1:** catalog seed idempotent | met | `ON CONFLICT DO NOTHING` throughout V4; `RbacCatalogSeeder` insert-only; `shouldBeIdempotentWhenSeederRunsAgain` |
| **T1:** migrations clean | met | Flyway runs in every Testcontainers boot; `make check` green; DB catalog mirrors `Permission.java` (`shouldMirrorCodeCatalogInDatabase`) |
| **T2:** security tests prove forbidden without / allowed with permission | met | `RbacAdminIntegrationTest.shouldEnforcePermissionsServerSide` (401 anonymous, 403 rider/Support, 200 Super Admin) |
| **T2:** instant effect of role edits | met | `shouldApplyRoleEditsInstantly` — same access token flips 403↔200 after a role edit, no re-login |
| **T2:** audit entries for every mutating admin action | met | `shouldAuditEveryMutation` covers all 7 action types + filters; `AuditService.record` inside each mutating service method |
| **T2:** integration tests cover UC-A-01…04 exceptions | met | set-password OTP path, E1 grant, duplicate 409, Super Admin immutability, system-role delete 409, assigned-role delete 409, last-Super-Admin 409 |
| **T3:** UI hides/disables unauthorized functions | met | `Sidenav.tsx` menu gating, `RequirePermission` routes, `canManage` on all mutating controls; `rbac-gating.test.tsx` + per-page hide tests |
| **T3:** role edit changes another admin's access without re-login (or next refresh, documented) | met | documented in `apps/admin/README.md` ("Permissions (RBAC, M3-T3)"); verified live in T4 |
| **T3:** component tests green | met | 56 tests / 13 files pass (`npm run check`) |
| **T4:** scripted walkthrough passes; audit log shows complete sequence | met | T4 record in tracker (2026-10-05): full live-stack walkthrough incl. 9-entry audit sequence and append-only trigger check |
| **Milestone:** enforcement provably server-side | met | integration tests hit endpoints directly; every admin endpoint carries `@PreAuthorize` (verified by grep, see "What's good") |
| **Milestone:** Super Admin invariants (immutable, undeletable, never last-one-removed) | met | `RbacRoleServiceImpl.updateRole/deleteRole`, `AdminAccountServiceImpl.requireNotLastActiveSuperAdmin`; unit + integration coverage |
| **Milestone:** audit log append-only and complete | met | `trg_audit_log_append_only` (V4) + `shouldRejectMutationOfAuditLogRows`; completeness per `shouldAuditEveryMutation` |
| **Milestone:** tracker updated; review audit passed | partial | tracker current through T4; this audit is the final gate |

## Critical
None.

## High
None.

## Warning

### W1 — Malformed UUID in a path param returns 500 instead of 400
- **Category:** correctness · **Severity:** Warning · **Certainty:** High (observed live in T4; cause confirmed in code)
- **Location:** `backend/src/main/java/com/labby/backend/exception/GlobalExceptionHandler.java:71-79`
- **Rationale:** `GET/POST /api/v1/admin/admins/{userId}/…` and `/roles/{roleId}` declare `format: uuid` path params in `backend/docs/api/rbac-v1.yaml` (e.g. lines 80, 177). A non-UUID value makes Spring throw `MethodArgumentTypeMismatchException`, which falls into the catch-all `@ExceptionHandler(Exception.class)` → 500 "An unexpected error occurred" (and an error-level log per probe). Spring's default resolver would have answered 400; the catch-all (extended in this range) shadows it. Contract-correct is 400. Same applies to malformed `actorId`/`from`/`to` query params on the audit endpoint.
- **Fix Suggestion:** add a handler before the catch-all:
  ```java
  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
    HttpStatus status = HttpStatus.BAD_REQUEST;
    return ResponseEntity.status(status)
        .body(ErrorResponse.of(status.value(), status.getReasonPhrase(), "Malformed request parameter"));
  }
  ```

### W2 — `admins:manage` / `roles:manage` holders can self-escalate to full access
- **Category:** security · **Severity:** Warning · **Certainty:** High (that the path exists; whether it violates intent is an owner call)
- **Location:** `backend/src/main/java/com/labby/backend/service/AdminAccountServiceImpl.java:113-136` (changeRole), `RbacRoleServiceImpl.java:78-107` (updateRole)
- **Rationale:** nothing restricts *granting* the Super Admin role: any admin whose role carries `admins:manage` can `PUT /admin/admins/{self}/role` to Super Admin, and any holder of `roles:manage` can edit their own (custom) role to tick the entire catalog. Both are permission-checked and audited, so this is not a bypass — but it means those two permissions are transitively equivalent to full access, which is worth an explicit owner decision before they are ever granted to a non-Super-Admin role (UC-A-01/02/03 name the Super Admin as the actor; the implementation correctly generalizes to permission checks per RBAC-03, which widens the actor set). The SRS does not forbid it, so this is flagged as a design caveat, not a conformance violation.
- **Fix Suggestion:** either record the owner's acceptance (these permissions are Super-Admin-only in practice), or add guards: only Super Admins may assign the Super Admin role, and a role edit may not target the actor's own role.

## Info (max 5)

1. **No-op role save still writes a `role.update` audit entry (before == after).** `RbacRoleServiceImpl.updateRole` (lines 93-105) records unconditionally, while `AdminAccountServiceImpl` skips audit on no-op `changeRole`/`deactivate`/`reactivate` (guards at lines 121, 143, 165). Arguably correct completeness per RBAC-05 (T4's own framing), but the two services are inconsistent; pick one convention. — correctness, certainty High.
2. **PR #3 was merged as a merge commit** (`6a85c6d`, plus `e2c3440`) instead of the squash-merge the CLAUDE.md git rules require. History on main stays complete and audit ranges work; already recorded as a gotcha in the tracker. Process note only. — structure, certainty High.
3. **Fresh admin accounts hardcode `Language.EN`** (`AdminAccountServiceImpl.java:189`), so the set-password OTP SMS goes out in English regardless of the market default. A `language` field on the create contract (or AR default) may be preferable — owner call, since the contract doesn't carry it today. — srs-conformance, certainty Medium.
4. **An admin with `admins:manage` but without `roles:view` gets a degraded creation form:** `AdminsPage.tsx:74-86` loads the role options via `GET /admin/roles` (requires `roles:view` server-side), so the create/role-change selects fail with a banner. Handled gracefully, but the implicit permission coupling is undocumented. — integration, certainty High.

+1 more nitpick — ask to see it.

## What's good

- **Per-request DB permission resolution** (`JwtAuthFilter` → `PermissionService` → `findCodesForActiveAdmin`) makes the hardest T2 AC — instant effect of role edits on live sessions — a structural property instead of a cache-invalidation problem, and the integration test proves it with the same access token flipping 403↔200.
- **Append-only is enforced at the DB level** (trigger in V4) and *tested* (`shouldRejectMutationOfAuditLogRows`), with honest, well-commented `TRUNCATE` workarounds in test cleanup rather than a weakened trigger.
- **Catalog drift fails loudly three ways:** `resolvePermissions` throws on DB/code divergence, `PermissionTest` pins the domain set, and `shouldMirrorCodeCatalogInDatabase` compares the live DB to the enum.
- **No admin endpoint exists without a permission check** — verified by sweeping every `@RequestMapping` under `controller/`: all 10 endpoints across `AdminAccountsController`, `RolesController`, `AuditLogController` carry `@PreAuthorize("hasAuthority('…')")`, behind a deny-by-default chain with `@EnableMethodSecurity`. The UI reuses the identical strings through a single reader (`permissions.ts`, deny-by-default), and EN/AR i18n key sets are in exact parity (verified programmatically).

## Pre-existing (out of scope, non-blocking)

- The catch-all 500 `@ExceptionHandler(Exception.class)` pattern predates M3 (W1 only concerns the new UUID path params that now hit it).
- Backlog items recorded at M2 close (rider cold-start refresh handling, لابي→لبي rename, palette error/success tokens) are untouched by this range, as expected.

## Test run results

| Suite | Command | Result |
|---|---|---|
| Backend | `cd backend && make check` | **green** — 118 tests, 0 failures (unit + Testcontainers integration incl. `RbacAdminIntegrationTest`/`RbacMigrationIntegrationTest` + 7 ArchUnit rules), Spotless 0 changes needed, Checkstyle 0 violations, BUILD SUCCESS in 1:56 min. Ran with the dev backend (port 8080) and `labby-postgres` (5432) still up — no conflicts; Testcontainers used random ports. |
| Admin app | `cd apps/admin && npm run check` | **green** — 13 files, 56 tests passed (lint + typecheck + tests), exit 0. |
| Rider app | not run | `git diff --stat 26d780f..HEAD -- apps/rider` is empty — untouched by M3. |
| Driver app | not run | `git diff --stat 26d780f..HEAD -- apps/driver` is empty — untouched by M3. |

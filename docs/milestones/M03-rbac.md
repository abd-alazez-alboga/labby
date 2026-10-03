# M3 — RBAC & Admin Foundation

> Status lives in `README.md`. Prereq: M2 `review_passed`.

## User stories
- As the Super Admin, I create admin accounts and give each exactly one role. (UC-A-01/02)
- As the Super Admin, I build custom roles by ticking permissions from a catalog; edits apply instantly to every holder. (UC-A-03)
- As any admin, every action I take is in an append-only audit log. (UC-A-04, RBAC-05)
- As the owner, every admin endpoint is permission-checked server-side; the UI hides what I can't do. (RBAC-03)

## Scope
SRS: RBAC-01…05, AUTH-06. The 3-table model (`roles`, `permissions`, `role_permissions`) exactly as specified in SRS §5.1; permission catalog seeded from code; `domain:action` permission strings shared verbatim with the frontend.

**Out:** the feature screens permissions will guard (they arrive milestone by milestone; the catalog grows via migrations).

## Tickets

### M3-T1 — RBAC contract & migrations
Migrations: `roles` (`is_system`), `permissions` (seeded catalog v1: user, ride, region, pricing, driver-review, support, settlement, promo, analytics, audit domains), `role_permissions`, admin role assignment (one role per admin). OpenAPI: admin accounts CRUD, roles CRUD, audit log query.
**AC:** Super Admin + Support roles seeded; catalog seed idempotent; migrations clean.

### M3-T2 — RBAC backend & audit log
Method security on `domain:action` authorities resolved from the user's single role; role CRUD with rules (system roles undeletable, Super Admin permissions immutable, no deleting an assigned role, last-Super-Admin protection); admin account creation (phone + set-password OTP path per AUTH-06); audit logging (aspect or service-level) capturing actor/action/target/before-after; audit query API (filterable).
**AC:** security tests prove: forbidden without permission, allowed with it, instant effect of role edits; audit entries written for every mutating admin action; integration tests cover UC-A-01…04 exceptions.

### M3-T3 — Admin UI: roles, admins, audit
Screens: admin accounts list/create/deactivate + role assignment; role builder (permission checklist grouped by domain); audit log viewer with filters. Route/menu gating driven by the same permission strings; permission-aware UI helper (hook/guard) established as the pattern for all future admin screens.
**AC:** UI hides/disables unauthorized functions; role edit visibly changes another admin's access without re-login (or on next refresh — documented); component tests green.

### M3-T4 — RBAC integration
End-to-end: create role → create admin with it → log in as them → verify allowed/denied surfaces server-side and UI-side; audit trail of the whole sequence inspected.
**AC:** scripted walkthrough passes; audit log shows the complete sequence correctly.

### M3-T5 — Review audit
Audit against RBAC-01…05, UC-A-01…04; confirm no admin endpoint exists without a permission check; structure + tests adequacy.
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3) → T4 → T5
```

## Milestone acceptance criteria
- Permission enforcement is provably server-side (tests hitting endpoints directly).
- Super Admin invariants hold (immutable, undeletable, never last-one-removed).
- Audit log is append-only and complete for all admin mutations in scope.
- Tracker updated; review audit passed.

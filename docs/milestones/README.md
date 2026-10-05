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

---

## Current state

- **Current milestone:** M3 — RBAC & admin foundation: **review_passed** (closed 2026-10-05). Next up: **M4 — Regions & pricing config** (`M04-regions.md`), starting with M4-T1. CI is live in `.github/workflows/ci.yml` (backend `make check` + three `npm run check` jobs on every push/PR); cloud-session git rules are in CLAUDE.md.
- **In progress now:** nothing mid-flight — M3 is closed. **Next concrete action: M4-T1 (Regions contract & migrations) via /labby-task**, after reading `M04-regions.md`.
- **M3 closure record:** T5 audit (report `docs/reviews/review-M03.md`, range `26d780f..ff1740f`) returned Pass with comments — 0 Critical, 0 High, 2 Warning; every ticket + milestone AC met. Owner decisions (2026-10-05): fix W1 AND add W2 guards — implemented via labby-fix in `c9c4197` (malformed path/query params → 400; only an ACTIVE Super Admin may grant the Super Admin role; an admin may never edit the role they themselves hold — all 409; SRS RBAC-01/02 + `rbac-v1.yaml` updated in the same commit; +2 integration tests). Independent re-audit over `ff1740f..a3ce6a9` **passed** (backend 120 tests green; no new findings above Info). Re-audit Info note kept for the record: `roles:manage` + `admins:manage` held TOGETHER still ≡ full access (create new full-catalog role → self-assign) — permission-checked and audited, outside the decided guard set, no action for M3; relevant if those two perms are ever granted together to a non-Super-Admin role. Open Info backlog from the audit: no-op role.update audit entries (inconsistent with admin no-op skips), fresh admins hardcode `Language.EN` for the set-password SMS, `admins:manage`-without-`roles:view` degrades the creation form (undocumented coupling). Suites at close: backend 120, admin 56, rider 54, driver 54. T4 walkthrough record (done 2026-10-05): T4 walkthrough passed in full against the live stack (Postgres + backend + admin app, real browser): Super Admin sees all RBAC screens; custom role created/edited/deleted via the role builder; Support-role admin created with the set-password flow (purpose `reset`, OTP captured via a local SMS-sink override of `SMS_GATEWAY_URL` — runtime env only, nothing committed); UI gating verified (only Dashboard visible to Support, direct routes show "No access"); server-side 403s on all five RBAC endpoints for Support; role edit granted `audit:view` → same access token flipped 403→200 instantly (and back on revert), Support admin's UI picked the change up on refresh; deactivate/reactivate verified UI- and server-side (suspended role assignment, reactivated login restores Support perms); last-Super-Admin deactivate → 409; system-role delete / Super-Admin edit → 409; audit log UI shows the complete 9-entry sequence (role.create/update×4/delete, admin.create/deactivate/reactivate) with before/after JSON, filters work; append-only trigger `trg_audit_log_append_only` confirmed installed in the live DB. **T4 findings for T5 to weigh:** malformed UUID in a path param (e.g. `/admin/admins/not-a-uuid/deactivate`) returns 500, contract-cleaner would be 400; a role save with an unchanged permission set still writes a `role.update` audit entry (before==after — arguably correct completeness). **T2 decisions a cold session needs:** admin `domain:action` authorities are resolved from the DB per request in `JwtAuthFilter`→`PermissionService` (never baked into tokens — that is what makes role edits/deactivation instant, the T2 AC); audit logging is service-level (not AOP) via `AuditService.record` inside each mutating service method, actions `role.create/update/delete`, `admin.create/role_change/deactivate/reactivate`; admin creation on a DELETED account's phone → 409 (reactivate first — flagged to owner); admin deactivation = suspending the admin role_assignment; `/users/me` now enriches the admin role assignment with `rbacRole {id,name}` + `permissions[]` (absent on rider/driver rows — auth-v1.yaml updated) so the admin UI can gate routes/menus (requested by the T3 session; UI picks up role edits on next profile fetch, enforcement stays per-request). **T3 decisions a cold session needs:** the UI learns the signed-in admin's own permission set from the `rbacRole`+`permissions` enrichment of /users/me's admin RoleAssignment (agreed cross-session with T2, implemented in PR #2 — T4 still verifies end-to-end); the only reader is `adminPermissions()` in `apps/admin/src/auth/permissions.ts`, deny-by-default when absent; role edits reach another admin's UI on next page refresh (profile re-fetch on load, documented in apps/admin/README.md), server-side enforcement stays per-request/instant; gating pattern for all future screens = `usePermissions().can('domain:action')` + `<RequirePermission>` routes; Super Admin is identified in the roles UI by its stable system-role name. **T1 decisions a cold session needs:** catalog v1 (22 perms, `enums/Permission.java` = source of truth, mirrored in V4) includes `admins:*` and `roles:*` domains beyond the ticket's ten so M3-T2's own admin/role endpoints are permission-checkable (RBAC-03); `audit_log` table shipped in V4 with a DB trigger making it append-only; system roles have fixed UUIDs (…0001 Super Admin, …0002 Support); one-role-per-admin lives as `role_assignments.admin_role_id` + CHECK, dev/existing admins backfilled to Super Admin; `RbacCatalogSeeder` (all profiles, idempotent) syncs code catalog → DB and keeps Super Admin at full grant, never touches editable Support; admin creation's set-password path reuses the password-reset flow (purpose `reset`) per contract `backend/docs/api/rbac-v1.yaml`.
- **M2 closure record:** the T7 audit (report `docs/reviews/review-M02.md`) returned Pass with comments; all findings were fixed via labby-fix (commits `9d8ebed`…`98839d0`) and the independent re-audit over `c222351..26d780f` **passed**. Owner decisions recorded: phone-change new-phone OTP stays purpose `2fa` (documented in UC-S-06); access-token revocation enforced per request via `SessionService` sid check; suspended-driver gate shows distinct copy with suspension-REASON display deferred until a milestone whose contract carries reasons; no resend UX in phone-change. JWT_SECRET has NO default — backend refuses to boot without it (value lives in gitignored backend/.env). Suites at close: backend 81, rider 54, driver 54, admin 33 — all green incl. lint/format/ArchUnit.
- **Blockers:** none. Owner still owes the one-time manual driver-app device run (from review-M01; the rider app was exercised live on a device in T6).
- **Review baseline:** `a3ce6a9` (M4's audit range = a3ce6a9..HEAD at its close; M3 was audited over 26d780f..ff1740f + re-audit ff1740f..a3ce6a9)
- **Last session note (2026-10-05, evening):** M3 closed end-to-end in a local session: T4 live walkthrough (Postgres + backend + admin app + real browser; OTP captured via a runtime-only local SMS-sink override of `SMS_GATEWAY_URL` — a reusable trick for local integration tickets, needs HTTP/1.1 + chunked-body handling), T5 audit → owner-approved fixes → re-audit Pass. Earlier same day: CI + cloud workflow set up and proven (first runs green ~2 min); M3 T1–T3 implemented by cloud sessions and merged by the owner. Gotcha: PR #3 was merged as a merge commit instead of the squash the git rules call for — history on main is still complete (audit ranges unaffected), but future PRs should use "Squash and merge". Earlier same day — M2 fully closed: Traccar SMS gateway live (cloud mode, raw token auth, `{to, message}` body), real-device verification of register/reset/2FA/delete→reactivate, T6 UX overhaul (eye toggles, confirm-password, staged change-password wizard), review cycle done. Backlog for later passes: NEW-1 from the re-audit (rider cold start with no cached profile + transiently failing refresh still clears the session — distinguish "session dead" from "server trouble" in apiFetch's refresh error); app-wide لابي→لبي rename (owner decision: brand is لبي); palette lacks error/success tokens (driver carries local ones); change-password contract validates the current password only at the final call (wizard surfaces a wrong current password late — a verify endpoint would be a contract change). Facts a cold session needs: RN apps are Expo SDK 57; seeded dev accounts per backend/docs/SEEDING.md (password `Password1!`, admin is +963900000004); dev boot needs backend/.env (JWT_SECRET + SMS_GATEWAY_URL/TOKEN, gitignored — owner has values); run backend with `set -a && . ./.env && set +a && make run`; owner's dev machine LAN IP 10.119.76.100, Expo apps need `LABBY_API_BASE_URL=http://10.119.76.100:8080`; owner's phone may run NordVPN, which blocks LAN access; OTP SMS wording must avoid "verification"/"التحقق" (carrier-filtered, delivery-tested).

---

## Milestone status

| # | Milestone | File | Status |
|---|---|---|---|
| M1 | Foundation & scaffolding | `M01-foundation.md` | review_passed |
| M2 | Auth & accounts | `M02-auth.md` | review_passed |
| M3 | RBAC & admin foundation | `M03-rbac.md` | review_passed |
| M4 | Regions & pricing config | `M04-regions.md` | todo |
| M5 | Driver onboarding | `M05-driver-onboarding.md` | todo |
| M6 | Realtime infrastructure | `M06-realtime.md` | todo |
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
| M4-T3 | Admin UI: regions & zone drawing | in_progress |
| M4-T4 | Apps: region resolution | in_progress |
| M4-T5 | Regions integration | todo |
| M4-T6 | Review audit | todo |

### M5 — Driver onboarding
| Ticket | Title | Status |
|---|---|---|
| M5-T1 | Onboarding contract & migrations | todo |
| M5-T2 | Onboarding backend | todo |
| M5-T3 | Driver app: application flow | todo |
| M5-T4 | Admin UI: review queues | todo |
| M5-T5 | Onboarding integration | todo |
| M5-T6 | Review audit | todo |

### M6 — Realtime infrastructure
| Ticket | Title | Status |
|---|---|---|
| M6-T1 | Realtime contract & migrations | todo |
| M6-T2 | Notifications backend (FCM + center) | todo |
| M6-T3 | Tracking & routing backend | todo |
| M6-T4 | Clients: maps, streaming, notification center | todo |
| M6-T5 | Realtime integration (Firebase creds) | todo |
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

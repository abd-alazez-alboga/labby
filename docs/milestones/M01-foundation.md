# M1 — Foundation & Scaffolding

> Status lives in `README.md` (tracker). This file is content-only.

## User stories
- As the owner, I have a monorepo where every client and the backend build, run, and test with one command each, so agents can work in parallel without stepping on each other.
- As a future developer (or agent), the architecture rules are enforced by tooling (ArchUnit, lint), not by convention documents. (NFR-M1)
- As a user, both apps and the dashboard already speak EN + AR with correct RTL from the first screen. (NFR-I1)

## Scope
Monorepo layout; Spring Boot skeleton per `docs/PROJECT-STRUCTURE.md` (adapted: no Keycloak); React admin shell; RN rider & driver shells; Labby theme everywhere; docker-compose for local Postgres; no business features.

**Out:** anything user-facing beyond shells; auth (M2).

## Tickets

### M1-T1 — Monorepo layout & root tooling
Create: `backend/`, `apps/rider/`, `apps/driver/`, `apps/admin/`, root `README.md`, `.gitignore`, root Makefile delegating to sub-projects.
**AC:** tree matches the layout; `make help` at root lists targets; `.gitignore` covers Java, Node, RN, env files.

### M1-T2 — Backend skeleton
Spring Boot 3.x / Java 21 / Maven wrapper. Package-by-layer skeleton with `package-info.java` per package; Flyway wired (`ddl-auto: validate`, `V1__init.sql` baseline); `application.yml` with `${ENV_VAR:default}` pattern + `dev`/`prod` profiles; logback JSON config; `GlobalExceptionHandler` + `BusinessException` hierarchy; ArchUnit layer tests; google-java-format + Checkstyle failing the build; Makefile (`check/fix/test/build`); `.env.example`; docker-compose (Postgres); health endpoint; springdoc OpenAPI on the `controller` package; Testcontainers `AbstractIntegrationTest`.
**AC:** `make check` green; ArchUnit fails on a deliberate layer violation (verified then reverted); app boots against docker-compose Postgres; `/actuator/health` UP; Swagger UI serves.

### M1-T3 — Admin web shell
React app: routing, runtime config loaded at boot (`config.json`, envsubst-able), i18n EN/AR with RTL switching, Labby theme tokens imported from `assets/theme/colors.scss`, layout chrome (sidenav/navbar placeholder), API client base reading the runtime config, lint/format/test tooling, component-test setup.
**AC:** `npm run build` + tests green; language toggle flips EN↔AR with full RTL; theme uses token variables (no hardcoded colors); config loaded at runtime, not build time.

### M1-T4 — Rider app shell
React Native app: navigation, i18n EN/AR + RTL, Labby theme (tokens ported from `colors.scss`), runtime/env config pattern, API client base, test setup.
**AC:** app builds and runs on Android emulator + iOS simulator; language toggle with RTL; tests green.

### M1-T5 — Driver app shell
Same as M1-T4 for the Driver app (separate app, own icon/label using brand assets).
**AC:** same as M1-T4.

### M1-T6 — Cross-client integration smoke
A trivial versioned endpoint (`GET /api/v1/meta`) returning app name + version; each client calls it on boot and surfaces failure gracefully.
**AC:** all three clients display live data from the local backend; failure shows a friendly error state, not a crash.

### M1-T7 — Review audit
Independent review agent audits M1 against this file, `CLAUDE.md`, and `PROJECT-STRUCTURE.md`: layout conformance, tooling enforcement real (not decorative), tests meaningful, no dead code or leftovers.
**AC:** findings written, resolved, re-checked; tracker set to `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4 ∥ T5) → T6 → T7
```

## Milestone acceptance criteria
- One `git clone` + documented commands bring up backend + all three clients locally.
- Architecture/lint/test gates run and fail on violations in every sub-project.
- EN/AR + RTL and Labby branding functional in all three clients.
- Tracker updated; review audit passed.

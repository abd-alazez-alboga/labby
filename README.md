# Labby

## Why this exists

I applied to **Labby** and was told the technical round would be a live build session with
Claude. Rather than wait for it, I took the initiative and built the whole thing: over about
three weeks, using Claude Code, I took a ride-hailing platform from a requirements document to
a deployed, working product. This repository is that work, shared in place of the technical
interview so the team can judge how I work with the tool at real project scale.

What was built, end to end:

- **Rider app** and **driver app** (React Native, Android APKs) and an **admin dashboard**
  (React), full English and Arabic with RTL throughout.
- A **Spring Boot backend**: phone + password auth with SMS OTP, driver onboarding and document
  review, live ride dispatch and tracking, scheduled and shared rides, cash + wallet payments,
  driver ledgers and commissions, surge pricing, promos, support tickets, SOS, analytics, RBAC
  and an append-only audit log.

How it was built:

1. **Requirements first** — a full SRS with stable requirement IDs (`docs/SRS.md`) plus per-role
   use cases; it stayed the source of truth throughout.
2. **Design first** — every screen was mocked on a design canvas (~200 artboards) and approved
   before any code.
3. **15 strictly ordered milestones** (`docs/milestones/`), each closed by an independent AI
   review audit against the SRS; a failed audit went through a fix cycle and a re-audit before
   the milestone counted (`docs/reviews/`).
4. **CI as the gate** — GitHub Actions runs the backend gate (format, Checkstyle, unit,
   Testcontainers integration and ArchUnit tests) plus the three apps' lint, type-check and test
   suites on every push; nothing ships on red.
5. **Hardening** — a 1,000-concurrent-user load test, an i18n/RTL audit, a backup and restore
   drill (`docs/ops/`), and a 54-scenario behaviour test on real devices, with findings triaged
   and fixed.
6. **Deployment** — the platform runs on free tiers (Render + Neon + Vercel) with seeded demo
   data, and both mobile apps are built as installable APKs.

**Live demo:** admin dashboard at <https://labby-cy1w.vercel.app>. Logins and the Android APKs
are shared on request rather than published here. The backend sleeps when idle on the free
tier; the first request after a quiet period can take a couple of minutes.

## What Labby is

Labby is a multi-region ride-hailing platform (open marketplace model): riders book on-demand,
scheduled, or public shared rides; independent verified drivers fulfill them; admins run
regions, pricing, and operations from a web dashboard. Phone-number-only identity, cash +
earned-credit wallet in V1, real SMS via an owner-operated gateway, FCM push, OpenStreetMap +
OSRM for maps and routing.

## Monorepo layout

| Path | What | Stack |
|---|---|---|
| `backend/` | API | Spring Boot (Java 21) · PostgreSQL · Flyway |
| `apps/rider/` | Rider app | React Native |
| `apps/driver/` | Driver app | React Native |
| `apps/admin/` | Admin dashboard | React (web) |
| `assets/` | Brand assets (logo, icon, color tokens) | — |
| `docs/` | All project documentation | — |

## Documentation

- `docs/SRS.md` — requirements source of truth (stable FR IDs).
- `docs/use-cases/` — per-role use cases (rider, driver, admin, shared).
- `docs/milestones/README.md` — **status tracker**: roadmap, ticket states, current state.
- `docs/milestones/M*.md` — one file per milestone: stories, tickets, acceptance criteria.
- `docs/reviews/` — the per-milestone review audits, the V1 conformance audit and the live
  behaviour test; `docs/ops/` — backup and restore runbooks; `docs/load-test-results-2026-10-20.md`.
- `docs/PROJECT-STRUCTURE.md` — structure conventions (backend strict, clients by principle).
- `CLAUDE.md` — working rules (git, tracker, milestone discipline).

## Getting started

Root `make help` lists everything; `make check` runs every sub-project's gate.

- **Backend** ([backend/README.md](backend/README.md)) — `cp backend/.env.example backend/.env`
  and set `JWT_SECRET` in it (no default; the app refuses to boot without it), then
  `make -C backend db-up` (compose Postgres) and `make -C backend run` (loads `.env`); health
  at `:8080/actuator/health`, Swagger at `/swagger-ui.html`. Gate: `make backend-check`.
- **Admin dashboard** ([apps/admin/README.md](apps/admin/README.md)) — `cd apps/admin &&
  npm install && npm run dev` → `http://localhost:5173`. Gate: `make admin-check`.
- **Rider app** ([apps/rider/README.md](apps/rider/README.md)) — `cd apps/rider &&
  npm install && npx expo start` (Expo SDK 57). Gate: `make rider-check`.
- **Driver app** ([apps/driver/README.md](apps/driver/README.md)) — `cd apps/driver &&
  npm install && npx expo start`. Gate: `make driver-check`.

## Project skills (Claude)

`/labby-task` (ticket + ad-hoc work) · `/labby-review` (audits, auto at milestone close) ·
`/labby-fix` (resolve review findings) · `/labby-next-session` (session handoff).

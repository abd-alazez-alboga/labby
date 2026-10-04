# Labby

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
- `docs/PROJECT-STRUCTURE.md` — structure conventions (backend strict, clients by principle).
- `CLAUDE.md` — working rules (git, tracker, milestone discipline).

## Getting started

Root `make help` lists everything. Per sub-project (each section is filled in by its
scaffolding ticket):

- **Backend** — arrives with M1-T2 (`make backend-check`, docker-compose Postgres).
- **Admin dashboard** — arrives with M1-T3.
- **Rider app** — arrives with M1-T4.
- **Driver app** — arrives with M1-T5.

## Project skills (Claude)

`/labby-task` (ticket + ad-hoc work) · `/labby-review` (audits, auto at milestone close) ·
`/labby-fix` (resolve review findings) · `/labby-next-session` (session handoff).

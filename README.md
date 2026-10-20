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

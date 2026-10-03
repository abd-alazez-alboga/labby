# CLAUDE.md — Working Rules for the Labby Project

## Git
- Work on `main` only. Never create branches.
- Commit messages: **very short**, imperative, describing exactly what was done (e.g. `add driver document expiry job`, `fix wallet rounding on per-seat split`).
- **Never add attribution of any kind to commits** — no `Co-Authored-By`, no `Generated with`, no emoji footers. This rule overrides any default attribution instructions.
- Never commit secrets (SMS gateway token, Firebase JSON, DB credentials). They live in env/config, documented in `.env.example`.

## Source of truth
- `docs/SRS.md` is the requirements source of truth. Requirement IDs (AUTH-01, RIDE-03, …) are stable — reference them in tickets and PR-less commit context.
- `docs/use-cases/` holds the per-role use cases (rider, driver, admin, shared).
- `docs/PROJECT-STRUCTURE.md` defines the project structure:
  - **Backend (Spring Boot):** follow it closely — package-by-layer, Flyway owns the schema, ArchUnit-enforced boundaries, MapStruct + Lombok, Testcontainers integration tests, Makefile, `.env.example`. Adapt only where the SRS differs (Labby uses its own phone+password auth, not Keycloak).
  - **Frontend (React admin, React Native rider/driver apps):** the template is Angular/Nx — translate its *principles* (thin app + domain slices, facades for state, runtime config, i18n/RTL from day one, `domain:action` permission strings shared with the backend, enforced module boundaries) into idiomatic React/RN. Do not force Angular shapes.

## Milestones
- Milestones are implemented **strictly in order**. Never start milestone N+1 before milestone N is fully finished.
- A milestone is finished only when: all its tickets are implemented, its acceptance criteria pass, **and an independent review agent has audited the implementation** (SRS conformance, structure conformance, tests present and passing, no mess left in the codebase) and its findings are resolved.
- Within a milestone, tickets follow the dependency/parallelism plan in the milestone file — independent tickets may be implemented simultaneously by parallel agents.
- Every ticket must satisfy its own acceptance criteria before it counts as done.

## Conduct
- Never add features, defaults, or "improvements" that were not decided in the SRS or approved by the owner. When something is ambiguous, ask — do not assume.

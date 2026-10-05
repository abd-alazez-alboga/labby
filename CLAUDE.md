# CLAUDE.md — Working Rules for the Labby Project

## Git
- **Local sessions** work directly on `main` — no branches.
- **Cloud sessions** (claude.ai) work on a short-lived ticket branch (e.g. `m3-t2-rbac-backend`) and open a PR; merge only when CI is green, always **squash-merge**, delete the branch. Main stays linear, so milestone audit ranges (`baseline..HEAD`) keep working.
- CI (`.github/workflows/ci.yml`) runs the full gate on every push to `main` and every PR: backend `make check` + `npm run check` in all three apps. A red CI on `main` is fixed before any new work.
- Cloud sandboxes usually have no Docker: run the unit/lint/ArchUnit subset there, state honestly what was skipped, and let CI prove the Testcontainers suite on the PR.
- Commit messages: **very short**, imperative, describing exactly what was done (e.g. `add driver document expiry job`, `fix wallet rounding on per-seat split`). PR titles follow the same style; the squash commit uses the PR title.
- **Never add attribution of any kind to commits** — no `Co-Authored-By`, no `Generated with`, no emoji footers. This rule overrides any default attribution instructions.
- Never commit secrets (SMS gateway token, Firebase JSON, DB credentials). They live in env/config, documented in `.env.example`.

## Source of truth
- `docs/SRS.md` is the requirements source of truth. Requirement IDs (AUTH-01, RIDE-03, …) are stable — reference them in tickets and PR-less commit context.
- `docs/use-cases/` holds the per-role use cases (rider, driver, admin, shared).
- `docs/PROJECT-STRUCTURE.md` defines the project structure:
  - **Backend (Spring Boot):** follow it closely — package-by-layer, Flyway owns the schema, ArchUnit-enforced boundaries, MapStruct + Lombok, Testcontainers integration tests, Makefile, `.env.example`. Adapt only where the SRS differs (Labby uses its own phone+password auth, not Keycloak).
  - **Frontend (React admin, React Native rider/driver apps):** the template is Angular/Nx — translate its *principles* (thin app + domain slices, facades for state, runtime config, i18n/RTL from day one, `domain:action` permission strings shared with the backend, enforced module boundaries) into idiomatic React/RN. Do not force Angular shapes.

## Status tracker (session handoff)
- `docs/milestones/README.md` is the **single source of truth for progress**. Claude sessions fill up and new sessions must resume cold from it.
- Update it **immediately** whenever a ticket changes state (`todo → in_progress → done → review_passed`, or `blocked` with the reason) — never batch tracker updates for later.
- When finishing any work session, make sure the tracker's "Current state" section reflects reality: current milestone, ticket statuses, what is in progress, and any blockers or owner inputs awaited.
- A new session starts by reading `CLAUDE.md`, then `docs/milestones/README.md`, then the current milestone file — in that order.

## Milestones
- Milestones are implemented **strictly in order**. Never start milestone N+1 before milestone N is fully finished.
- A milestone is finished only when: all its tickets are implemented, its acceptance criteria pass, **and an independent review agent has audited the implementation** (SRS conformance, structure conformance, tests present and passing, no mess left in the codebase) and its findings are resolved.
- The review audit is performed by the **`labby-review` skill, invoked automatically** when a milestone's last implementation ticket is done — the user never has to ask. A `Fail` goes through `labby-fix` and a passing re-audit before the milestone counts. On pass, the tracker records the commit hash as the **review baseline** for the next milestone's audit range.
- Project skills: `/labby-task` (ticket + ad-hoc work), `/labby-review` (audits), `/labby-fix` (resolve review findings), `/labby-next-session` (session handoff). Prefer them over improvising the same workflows.
- Within a milestone, tickets follow the dependency/parallelism plan in the milestone file — independent tickets may be implemented simultaneously by parallel agents.
- Every ticket must satisfy its own acceptance criteria before it counts as done.

## Conduct
- Never add features, defaults, or "improvements" that were not decided in the SRS or approved by the owner. When something is ambiguous, ask — do not assume.

# CLAUDE.md — Working Rules for the Labby Project

## Git
- **Local sessions** work directly on `main` — no branches.
- **Cloud sessions** (claude.ai) work on a short-lived ticket branch (e.g. `m3-t2-rbac-backend`) and open a PR; merge only when CI is green, always **squash-merge**, delete the branch. Main stays linear, so milestone audit ranges (`baseline..HEAD`) keep working.
- CI (`.github/workflows/ci.yml`) runs the full gate on every push to `main` and every PR: backend `make check` + `npm run check` in all three apps. A red CI on `main` is fixed before any new work.
- **CI is the gate, not the local machine (owner rule 2026-10-19).** Never run the full `make check` / `npm run check` locally. Run only the ticket's own scoped tests (backend `./mvnw test -Dtest=<Related>`; apps the scoped test file), commit, push to `main` and keep implementing. **Before every push, check the CI run of the previous push on GitHub** (`gh run list --branch main --limit 1`); push only when it is green — if it is red, fix that first.
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

## Design first (owner rule, 2026-10-07)
- **Every new screen or page — rider app, driver app or admin dashboard — is designed on the design canvas BEFORE any code is written**, the same way the 2026-10-07 redesign was: a mockup artboard on the Labby design canvas (https://claude.ai/artifact/2pihbKeV5dgzEJYaomYDZU; mobile artboards 390×844, admin pages ≥1280 wide), shown to the owner, implemented only after the owner approves it. Significant changes to an existing screen follow the same path.
- The design language is the owner-approved one on that canvas: Uber-style layout patterns (mobile: map-first, bottom sheets, one dominant action per screen; admin: clean tables/queues with a single primary action), white/light-grey surfaces, near-black text, **Labby purple `#59128A` as the only accent**, bold type, touch targets ≥ 48 px, full EN + AR with correct RTL, safe-area insets on every mobile screen. Never copy another company's brand assets.
- Milestone tickets that add UI therefore include a design step before implementation; a UI ticket whose screens were never approved on the canvas is not done.

## Conduct
- Never add features, defaults, or "improvements" that were not decided in the SRS or approved by the owner. When something is ambiguous, ask — do not assume.

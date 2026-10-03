---
name: labby-task
description: >
  Approval-gated workflow for implementing Labby work: either a milestone ticket (e.g. "work
  M4-T2") or an ad-hoc bug/improvement/feature outside milestone scope. Use whenever the user
  invokes /labby-task, names a ticket id like M<n>-T<n>, pastes a bug or broken behavior and
  wants it handled, or asks to implement something in the labby repo. Claude analyzes, judges
  whether a reported bug is valid or a false positive, proposes before touching code,
  implements only after explicit approval, verifies with related tests + build, updates the
  milestone status tracker immediately, and commits on sign-off per CLAUDE.md commit rules.
---

# Labby Task Workflow

One repo, one branch (`main`), two modes. Detect the mode from the request:

- **Ticket mode** — the request names a milestone ticket (`M4-T2`, "next ticket", "continue M4").
- **Ad-hoc mode** — a bug, improvement, or feature that is not a milestone ticket.

The gates are the product: nothing is implemented the user hasn't seen coming. Unlike the
Regardian skills, **Claude commits here** — after explicit sign-off, directly on `main`, with
a very short imperative message and **no attribution of any kind** (CLAUDE.md rules).

## Session start (both modes)

1. Read, in order, if not already in context this session: `CLAUDE.md`,
   `docs/milestones/README.md` (the tracker), and — in ticket mode — the current milestone file.
2. Run `git status --short`; report leftovers in the tree in one line.
3. Honor the milestone order rule: never work a ticket of milestone N+1 while milestone N is
   not `review_passed`. If asked to, refuse and point at the tracker.

## Ticket mode

1. **Load the ticket** from its milestone file: description, acceptance criteria, dependency
   plan. Check the tracker: if a ticket this one depends on is not `done`, say so and stop.
2. **Set the tracker**: ticket → `in_progress` (immediately, before any code — tracker rules
   in CLAUDE.md). Commit the tracker change together with the ticket's final commit, not
   separately.
3. **Plan gate** — Present a short plan: files to create/touch, approach, how each acceptance
   criterion will be met, what tests will cover it, anything ambiguous in the ticket
   (ambiguity = ask, don't assume — SRS/CLAUDE.md conduct rule). ⏸ **Wait for approval.**
   If the user already said "go ahead" / "no gates" for this ticket or session, skip the wait
   but still print the plan.
4. **Implement** — scoped to the ticket. Follow `docs/PROJECT-STRUCTURE.md` (backend strictly;
   React/RN by its principles). Tests are part of the ticket: backend = unit + integration,
   clients = component tests. No unrequested refactoring, no drive-by cleanups.
5. **Verify** — run the relevant checks (backend: `make check` or scoped `./mvnw test
   -Dtest=…`; clients: the project's test + lint commands, scoped). Report results honestly;
   pre-existing unrelated failures are reported as pre-existing, not fixed.
6. **Hand back** — what changed, where, verification results, which acceptance criteria are
   met (each one, explicitly). ⏸ **Wait.**
7. **Iterate or finalize** — feedback → apply exactly that, re-verify, hand back again.
   Sign-off ("approved", "looks good", "done") → **commit** (one commit for the ticket, short
   imperative message, e.g. `add otp service and sms gateway sender`), set the tracker to
   `done` in the same commit, and confirm with the commit hash. Then stop — the next ticket is
   a new request.

Parallel-agent etiquette: touch only files in this ticket's scope. If the ticket plan collides
with files another in-progress ticket owns (check the tracker), flag it before implementing.

## Ad-hoc mode

Classify first — **bug** · **improvement** · **feature** — and state scope (backend / which
app(s) / fullstack) in one line: *"Treating this as a **bug** in the **driver app** — correct
me if I'm wrong."* Underspecified → ask blocking questions before any analysis.

### Bug flow
1. **Analyze** — what happens, what should happen, where.
2. **Validate** — mandatory verdict after reading the actual code:
   - **Valid** → continue.
   - **False positive** → the behavior is correct/intended/already handled. Prove it with
     `file:line` evidence and say what the confusion likely was. ⏸ User accepts (closed) or
     pushes back with context → re-examine honestly.
   - Lean on evidence, not deference — the final call is the user's.
3. **Root cause** — exact `file:line`, full file + callers read, competing hypotheses stated
   honestly when the cause can't be pinned.
4. **Propose fix** — files touched, shape of the diff, side effects, and **contract impact on
   the other side** (backend change → name the affected app screens/calls; app change → name
   the API dependency). ⏸
5. **Implement → verify → hand back.** ⏸
6. **Iterate or finalize** — sign-off → commit (short message), confirm hash.

### Improvement flow
Same as bug, with the verdict adapted (false positive = unnecessary / already exists / makes
things worse) and a "why it's like this today" step when current behavior looks deliberate.
Purely additive polish skips straight to Propose.

### Feature flow
1. **Understand** — restate, surface ambiguities/edge cases (empty states, permissions, error
   paths, EN/AR + RTL). ⏸ if questions were asked.
2. **Plan** — approach, files, endpoints/DTOs/migrations and/or components/screens/state,
   contract impact, test coverage. For fullstack: **backend first**, then plan each client
   against the backend contract *as actually implemented*. ⏸ per phase.
3. **Implement → verify → hand back.** ⏸ per phase.
4. **Finalize** — sign-off → commit per phase (backend commit, then client commit(s)).

Ad-hoc work that changes behavior the SRS specifies → flag the SRS delta in the proposal; on
sign-off, update `docs/SRS.md` in the same commit so the source of truth stays true.

## Ground rules

1. Advance past ⏸ only on a clear affirmative. Questions/partial feedback/silence are not
   approval.
2. Minimal, scoped diffs. Adjacent breakage is mentioned, not fixed.
3. Evidence over pattern-matching; uncertainty stated, never papered over.
4. Tests follow approved behavior only — never bend a test to make wrong code pass.
5. Tracker updated immediately on every state change (CLAUDE.md).
6. Commits: short, imperative, exact, **no attribution** — and never commit secrets.
7. Report honestly: failed tests, skipped steps, partial work — plainly, in the hand-back.

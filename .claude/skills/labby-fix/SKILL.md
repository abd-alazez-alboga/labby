---
name: labby-fix
description: >
  Validate the findings of a labby-review report (docs/reviews/*.md) against the live code,
  then implement the valid fixes after the user's approval, run the related tests, and commit
  the approved fixes per CLAUDE.md rules. Use whenever the user mentions a review report and
  asks to fix/apply/resolve/action its findings, invokes /labby-fix, or when a milestone
  review audit came back Fail and its findings need resolving before the milestone can pass.
  Re-checks every finding against actual source, asks blocking questions, presents a
  fix/ignore plan for approval, never bends a test to green without an explicitly approved
  behavior change. Pairs with labby-review.
---

# Labby Fix

Takes a review report, **re-validates every finding against the live code**, and — after
approval — implements the valid fixes, runs the related tests, and **commits** them (this is
Labby: commits are Claude's job, per CLAUDE.md — short imperative messages, no attribution).

**Core principle:** the review file is a list of *claims to verify*, not facts. The same
reasoning that wrote it can be wrong, and the code may have changed since. Every finding is
re-checked against actual source — no shortcuts by severity or certainty.

## Inputs

The user names a report (or the milestone-audit flow hands one over, typically
`docs/reviews/review-M<NN>.md`). Act only on the named report — never auto-discover others.
Before anything, note `git status --short`; if the tree is already dirty, warn that the
clean-start assumption behind post-fix test results may not hold.

## The cycle

### 1. Parse
Extract each finding: Category, Severity, Certainty, Location, Rationale, Fix Suggestion.
**Skip "What's good"** and **"Pre-existing (out of scope)"** — fixing those is scope creep.
For a milestone audit, also carry the unmet-AC rows: each is a finding to resolve.

### 2. Validate against live code — every finding, same depth
Open the file at the Location, read the surrounding code, grep callers/definitions. Classify:
- **Valid** — real and fixable in the current code.
- **False positive** — not a problem; one-line reason.
- **Obsolete** — code already changed; no longer applies.
- **Needs input** — real but ambiguous (multiple reasonable fixes, unclear intent, touches
  an API contract between backend and the apps, or deviates from the SRS). Becomes a question.

### 3. Ask blocking questions — before the plan
All "Needs input" items plus anything genuinely uncertain, in one concrete batch. This is
also where the user declares any **intentional behavior change** (the only thing that later
authorizes updating a test's assertions). **Wait for answers.**

### 4. Present the plan — then wait
- **Will fix** — each valid finding with its concrete approach (incorporating the answers),
  flagging approved behavior changes and any SRS updates they imply.
- **Will ignore** — false positives + obsolete findings, each with its reason.
⏸ Apply nothing until explicit approval. The user may drop/alter items.

### 5. Implement the approved plan
Apply the fixes; re-read each changed file to confirm the edit is correct and complete. Run
the related tests:
- Backend: scoped `./mvnw test -Dtest=<Related>` only — never the full `make check` locally; CI is the gate (owner rule 2026-10-19).
- Clients: the project's configured runner, scoped to related files/projects.
State the exact commands and results honestly.

**Red test after a fix — never infer intent:**
- The user explicitly approved that behavior change → update the test's assertions to match.
- The fix needs new coverage → *adding* tests that exercise the fixed behavior is fine.
- Anything else → **STOP. Don't touch the test.** Diagnose, suggest, wait — the honest answer
  is often that the fix is wrong, not the test.

### 6. Commit
After all approved fixes are applied and tests are green (or explicitly accepted):
- Group related fixes into one commit; unrelated fixes touching the same file share a commit;
  a fix and the tests it drove travel together.
- Short imperative messages (`fix wallet rounding on per-seat split`), specific files only
  (never `git add .`), **no attribution**.
- Commit; report hashes.

### 7. Close out
Summary: fixed, ignored (with reasons), test results, unresolved failures flagged for
diagnosis. If this was a milestone-audit `Fail`: mark the fixed findings in the report file
(or append a resolution section), then trigger **`/labby-review` re-audit** of the new range —
the milestone only reaches `review_passed` through a passing re-audit. Update the tracker
accordingly (CLAUDE.md: immediately).

## Guardrails
- Only the named report; never fix "Pre-existing" or "What's good" items.
- Never edit a test to pass without an explicitly approved behavior change.
- SRS-affecting fixes update `docs/SRS.md` in the same commit (approved first).
- Tracker updated immediately; secrets never committed.

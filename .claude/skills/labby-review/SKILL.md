---
name: labby-review
description: >
  Review a range of Labby commits on main and write a structured markdown report. Runs in two
  ways: automatically as the final review-audit ticket of every milestone (audit everything
  the milestone committed, against its acceptance criteria, the SRS, and PROJECT-STRUCTURE),
  or on demand ("review M4-T2", "review the last 5 commits", an explicit range). Use whenever
  the user invokes /labby-review, asks to review/audit code or a milestone, or when a
  milestone's tickets are all done and its review-audit ticket is next — in that case invoke
  this skill without being asked. Suppresses noise: findings need file:line evidence, max 5
  nitpicks, no fake certainty percentages.
---

# Labby Review

Reviews commits on `main` (there are no branches) and writes one report per run. Doubles as
the **independent review-audit agent** CLAUDE.md requires at the end of every milestone — and
at milestone close it runs **automatically**: when the last implementation ticket of a
milestone is `done`, the review-audit ticket is executed by invoking this skill, no user
request needed.

A report with 8 real findings beats one with 30 where 22 are guesses. After one noisy report
the reader stops reading, and the real bugs die with the nitpicks.

## Determining the diff range

- **Milestone audit (default / automatic):** base = the **review baseline** recorded in
  `docs/milestones/README.md` ("Current state" section — the commit hash of the previous
  milestone's `review_passed`). Range: `<baseline>..HEAD`. For M1 (no baseline yet), base =
  the first commit of the repo.
- **Ticket review:** the commit(s) the tracker/ticket sign-off recorded for that ticket, or
  the commits whose messages the user points at.
- **Explicit:** any range or "last N commits" the user gives.

Collect deterministically: `git log --oneline <range>`, `git diff --stat <range>`, then
`git diff <range>`. State the exact range used at the top of the report.

## Review workflow

1. **Read intent first.** The milestone file (user stories, scope, every ticket's acceptance
   criteria) for an audit; the ticket text or user description otherwise. A review that
   doesn't know what the code *tried* to do generates garbage findings.
2. **Read full files, not hunks.** For each changed file, open the actual file. Most false
   positives come from judging a hunk in isolation.
3. **Check surroundings.** Grep callers/definitions of changed symbols across the monorepo —
   including the backend↔client boundary (a DTO change's impact on app code and vice versa).
4. **Audit the conformance axes** (milestone audits always; ad-hoc reviews where relevant):
   - **AC conformance** — each milestone/ticket acceptance criterion: met, partially met, or
     unmet, with evidence. Unmet AC is automatically a Critical finding in an audit.
   - **SRS conformance** — behavior matches the referenced FR IDs; silent deviations and
     unapproved additions (CLAUDE.md conduct rule) are findings.
   - **Structure conformance** — `docs/PROJECT-STRUCTURE.md`: backend layering/conventions,
     client principles, ArchUnit/lint gates not weakened, migrations sane, no secrets.
   - **Tests** — present, meaningful (assert behavior, not padding), green. Run the relevant
     suites — the SCOPED equivalents only, never the full `make check` locally (owner rule 2026-10-19; cite the CI run on GitHub for the full gate) — and include results in the report.
   - **Mess check** — dead code, leftovers, debug output, commented-out blocks, tracker
     drift (tracker says done but AC unmet, or vice versa).
5. **Verification gate before writing ANY finding:** can I point at the exact line, and have
   I confirmed it isn't handled elsewhere?
   - Yes → report, certainty **High**.
   - Partly → report, certainty **Medium**, say what would confirm it.
   - Pattern-based hunch → drop it, or **Low** only if severity would be High+. Never spend a
     Critical/High slot on a guess.

**Scope:** findings only on code in the reviewed range. Pre-existing problems the diff merely
touches go in "Pre-existing (out of scope)", non-blocking, never Critical.

## Severity · Certainty · Schema

Severity: **Critical** (bugs, security, data loss, unmet AC — blocks the milestone) ·
**High** (likely incorrect / significant risk) · **Warning** (smell, missing tests,
fragility) · **Info** (minor, max 5 reported — end with `+N more nitpicks — ask to see
them.`) · **Praise** (genuinely good patterns; signals understood intent).

Certainty: **High / Medium / Low** buckets only — never numeric percentages.

Every finding: **Category** (correctness · security · performance · tests · structure ·
srs-conformance · integration) · **Severity** · **Certainty** · **Location** (`file:line`) ·
**Rationale** · **Fix Suggestion** (concrete, snippet when it helps).

## Output report

Write to `docs/reviews/review-M<NN>.md` (milestone audit) or
`docs/reviews/review-<slug>-<YYYY-MM-DD>.md` (ad-hoc). Structure:

```markdown
# Review — <subject> (`<range>`)
_<N> commits · <M> files · reviewed <YYYY-MM-DD>_

## Summary
<2–3 sentences + overall picture.>

**Verdict:** <Pass | Pass with comments | Fail>
**Findings:** Critical <n> · High <n> · Warning <n> · Info <n> · Praise <n>

## Acceptance criteria   ← milestone/ticket audits only
| Criterion | Status | Evidence |
<met / partial / unmet rows>

## Critical / ## High / ## Warning / ## Info (max 5)
<finding blocks, or "None.">

## What's good
## Pre-existing (out of scope, non-blocking)
## Test run results
<commands + honest outcomes>
```

**Verdict rule:** any Critical (incl. unmet AC) → `Fail`. Any High → `Fail` unless trivially
fixable, else `Pass with comments`. Otherwise `Pass`/`Pass with comments`.

## After writing — milestone audits only

- `Fail` or findings worth fixing → hand off to `/labby-fix` with this report; the milestone
  stays un-passed until findings are resolved and a re-audit passes.
- `Pass` → update the tracker: milestone → `review_passed`, record `HEAD`'s hash as the new
  **review baseline** in "Current state", commit the report + tracker together (short
  message, e.g. `pass m04 review`). Only then may the next milestone start.

Tell the user the report path and the one-line verdict. Don't paste the full report into chat.

---
name: labby-next-session
description: >
  End-of-session handoff for the Labby project. Use whenever the user invokes
  /labby-next-session, says the session is getting full, says they're leaving/stopping and
  will continue in a new session, or asks for a prompt to resume work elsewhere. Claude
  updates the milestone status tracker's "Current state" to match reality, commits any
  loose approved work plus the tracker, and prints a short copy-paste prompt that starts the
  next session exactly where this one left off.
---

# Labby Next Session

Produces a clean handoff: the repo tells the whole story, and the user carries only a short
prompt into the new session. The tracker (`docs/milestones/README.md`) is the real memory —
this skill's job is making sure it's true, committed, and pointed at.

## Steps

### 1. Make the tracker true
Reconcile `docs/milestones/README.md` with reality **as of this session**:
- Current milestone + every ticket status (`todo / in_progress / blocked(reason) / done /
  review_passed`) — including anything that changed this session and wasn't recorded yet.
- **Current state** section rewritten:
  - Current milestone and exactly which ticket(s) are where.
  - **In progress now:** what is genuinely mid-flight — which files are touched, what works,
    what doesn't yet, and the next concrete action (specific: "wire OtpService into
    RegistrationController and add the failure tests", not "continue auth").
  - **Blockers / owner inputs awaited** (e.g. SMS token, Firebase JSON, an unanswered gate
    question — quote the open question).
  - **Last session note:** one or two sentences of context the files can't carry (decisions
    taken verbally this session, a gotcha discovered, a gate the user approved).
- Review baseline hash if a milestone passed review this session.

### 2. Leave the tree clean
- Signed-off, finished work that wasn't committed yet → commit it per CLAUDE.md (short
  message, no attribution).
- Genuinely half-done work → prefer committing a coherent WIP commit named for what it is
  (e.g. `wip: otp service, verification pending`) so the next session diffs it trivially;
  if the user prefers it uncommitted, record exactly which files are dirty and why in the
  tracker's "In progress now".
- Commit the tracker update itself (`update tracker for session handoff` or fold into the
  last commit). Push if a remote is configured and reachable; say so either way.

### 3. Print the handoff prompt
A short fenced block the user copies into the new session — pointer-style, not a context
dump (the files carry the detail):

```
Continue the Labby project. Read CLAUDE.md, then docs/milestones/README.md, then
docs/milestones/<current-milestone-file>. We are on <Mx> — <one-line state, e.g.
"T2 in progress: OTP service done, SMS sender untested; T3/T4 running in parallel">.
Next action: <the concrete next step>. <Open gate/blocker, if any, in one line.>
Use /labby-task to continue ticket work.
```

Fill every `<>` with the real values. One prompt, nothing else after it — the session is
ending.

## Rules
- Never end the skill with an un-updated or uncommitted tracker — that is the one failure
  mode this skill exists to prevent.
- The prompt must be self-sufficient for a cold session that has read the three files —
  no references to "as we discussed" or conversation-only context (that context belongs in
  the tracker's "Last session note").
- Honest state only: if tests are red or a ticket is stuck, the tracker and the prompt say
  so plainly.

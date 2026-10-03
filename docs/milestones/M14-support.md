# M14 — Support & Content

> Status lives in `README.md`. Prereq: M13 `review_passed`.

## User stories
- As a rider/driver, I browse the help center first, then open a categorized ticket and track it to resolution. (UC-S-19…21, SUP)
- As a rider, I report a lost item on a ride; the chat reopens and support tracks the case to closure. (UC-R-20, UC-D-21, LOST)
- As a user, I submit feedback and suggestions. (UC-S-22, FDBK)
- As an admin, I work ticket/lost-item queues, author help content in EN+AR, and manage ticket categories. (UC-A-21…25)

## Scope
SRS: SUP-01…04, LOST-01/02, FDBK-01. Lost-item cases exercise M10's chat-reopen hook. SOS resolution notes (M10-T4 stub) upgrade to real linked tickets.

## Tickets

### M14-T1 — Support contract & migrations
Migrations: `support_tickets` (category, priority, status, ride link) + `ticket_messages`, ticket categories (EN/AR, default priority), lost-item case fields (subtype statuses), `help_categories`/`help_articles` (EN/AR, order, draft/published), `feedback`. Contracts: ticket create/thread/status, category admin CRUD, lost-item report + case progression, help CMS CRUD + public read + search, feedback submit + admin browse/tag.
**AC:** state machines documented (`open→…→closed`; `reported→…→closed`); migrations clean.

### M14-T2 — Tickets, help CMS, lost items, feedback backend
Ticket workflow (states, default priority from category, admin override, queue sort priority+age, user notifications per change, reopen-on-reply until closed); help CMS (both-languages-required publish rule, ordering, search); lost items: report against completed ride (desc + photos) → case opens → **ride chat reopens** until closure → case statuses with both-party notifications; feedback (categorized, admin tags, counts-by-category/time view); SOS-note stub migration to real tickets.
**AC:** integration tests: full ticket lifecycle incl. `waiting_on_user` reminder surfacing, publish blocked on missing language, chat-window reopen/close exactly tracking case state, feedback aggregation.

### M14-T3 — Apps: support, lost items, feedback
Rider + driver apps: support home (help center first: categories, articles, search → "create ticket"), ticket create + thread + status list, feedback form; rider: lost-item report from ride history; driver: lost-item case view + reopened chat entry point.
**AC:** UC-S-19…22, UC-R-20, UC-D-21 flows + exceptions against mocks; EN/AR content rendering + RTL; tests green.

### M14-T4 — Admin: queues, CMS, categories
Ticket queue (priority+age sort, filters, thread, state controls, priority override, wallet-credit remedy shortcut → M8 grant flow); lost-item queue with case progression; help CMS editor (EN/AR side-by-side, draft/publish, ordering); ticket-category management; feedback browser with tags + trend counts.
**AC:** UC-A-21…25 end-to-end; permission-gated + audited; tests green.

### M14-T5 — Integration
E2e: user browses help → opens ticket → support responds → `waiting_on_user` → resolved → closed with notifications throughout; lost item: report → chat reopens → driver coordinates → `returned` → chat closes with case; feedback submitted and visible in admin trends.
**AC:** scripted walkthrough passes.

### M14-T6 — Review audit
Audit against SUP/LOST/FDBK and the UCs; notification coverage check; chat-reopen edge cases (case on a ride older than 24 h, multiple cases).
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4) → T5 → T6
```

## Milestone acceptance criteria
- The full support loop (help → ticket → resolution) works with notifications at every step.
- Lost-item cases provably control the chat window.
- Help content is impossible to publish half-translated.
- Tracker updated; review audit passed.

# Labby — Milestone Roadmap & Status Tracker

> **This file is the single source of truth for implementation progress.**
> It must be updated **immediately** on every ticket state change so a brand-new Claude session can resume cold.
> Resume order for a new session: `CLAUDE.md` → this file → the current milestone file.

## Rules (binding)

- Milestones run **strictly in order**: M(N+1) never starts before M(N) is `review_passed`.
- A milestone is `review_passed` only when all tickets are done, all acceptance criteria pass, and the **review-agent audit ticket** (always the last ticket) passed with findings resolved.
- Tickets follow each milestone's dependency plan; tickets in the same parallel group may be implemented simultaneously by separate agents.
- Ticket states: `todo` · `in_progress` · `blocked(reason)` · `done` · (milestone-level) `review_passed`.
- Every ticket ships its own tests (backend: unit + integration; frontend: component tests). No green tests → not `done`.
- Work happens on `main` only. Commit per CLAUDE.md rules (short, exact, **no attribution**).

## Owner inputs needed (ask when the ticket starts, not before)

| Input | Needed for | Status |
|---|---|---|
| SMS gateway app token + endpoint | M2-T6 (auth integration) | received (Traccar cloud; values in backend/.env, never committed) |
| Firebase service-account JSON + RN app configs | M6-T5 (realtime integration) | pending |

---

## Current state

- **Current milestone:** M2 — Auth & accounts (`in_progress`)
- **In progress now:** M2-T7 (review audit) — audit over `372a53f..dc3ffdd` COMPLETE, report at `docs/reviews/review-M02.md`. **Verdict: Pass with comments** (Critical 0 · High 1 · Warning 6 · Info 5+7). M2 is NOT `review_passed` yet: findings go through /labby-fix + scoped re-audit first. Key items: H1 missing suspended-role login test (only partially-met AC); W1 RTL double-flip post-restart in both RN apps; W2 phone-change OTP purpose deviates from UC-S-06 (owner decision); W3 usable committed JWT-secret default; W4 access-token ≤15-min revocation window (owner decision); W5 rider signs out on transient refresh/offline failures; W6 missing T6-UX tests (admin toggle, driver escape hatch). Suite counts verified: backend 79 (not 80 as previously noted here), rider 52, driver 50, admin 32 — all green. T6 is DONE. Part C completed 2026-10-05 with live SMS verification on a real device: Traccar SMS Gateway wired in cloud mode (`POST https://www.traccar.org/sms/`, raw token in Authorization header — no Bearer, body `{to, message}`); OTP SMS wording delivery-tested and deliberately avoids "verification"/"التحقق" (the carrier silently drops SMS containing those words — see OtpServiceImpl.buildMessage comment); Arabic brand name is **لبي** per owner (apps' AR translations still say لابي — rename suggested as separate task). Live-verified flows: register (OTP 204→verify 200→complete 201), 2FA change-password incl. wrong-current-password 400, logout/login, password reset, delete→reactivate; also witnessed live: OTP hourly cap (5/h, silently swallowed on reset-start per anti-enumeration), login throttle counting. Owner UX feedback mid-T6 led to committed UX fixes in all three frontends: show-password eye on every password field (rider/driver field primitives + admin login), confirm-password with match validation (register + reset + change), change-password restructured into a staged wizard (current pwd + forgot-password escape hatch → 2FA OTP step → new+confirm). New RN deps: @expo/vector-icons, expo-font, expo-asset. Tests green: backend 80 (incl. new SmsGatewaySenderTest pinning the Traccar request shape), rider 52, driver 50, admin 32.
- **Blockers:** none. Known caveat for T7: the change-password contract validates current password + OTP only in the single final call, so a wrong current password surfaces at the end of the wizard (separate verify endpoint would be a contract change — review may weigh in). Owner still owes the one-time manual driver-app device run (from review-M01; rider app was exercised live in T6).
- **Review baseline:** `372a53f` (M2's audit range = 372a53f..HEAD at its close)
- **Last session note (2026-10-05):** M2 T1–T6 done; next = T7 automatic /labby-review audit over 372a53f..HEAD, then labby-fix if needed, then M3. Facts a cold session needs: RN apps are Expo SDK 57; seeded dev accounts per backend/docs/SEEDING.md (password `Password1!`, admin is +963900000004); dev boot needs backend/.env (JWT_SECRET + SMS_GATEWAY_URL/TOKEN, gitignored — owner has values); run backend with `set -a && . ./.env && set +a && make run`; owner's dev machine LAN IP 10.119.76.100, Expo apps need `LABBY_API_BASE_URL=http://10.119.76.100:8080`; owner's phone may run NordVPN which blocks LAN. Owner notes pending: palette lacks error/success tokens (driver added local danger/success in its tokens.ts); T2 backend deviations documented in its design decisions (409 race, Checkstyle scoped to handwritten sources); app-wide لابي→لبي rename pending.

---

## Milestone status

| # | Milestone | File | Status |
|---|---|---|---|
| M1 | Foundation & scaffolding | `M01-foundation.md` | review_passed |
| M2 | Auth & accounts | `M02-auth.md` | in_progress |
| M3 | RBAC & admin foundation | `M03-rbac.md` | todo |
| M4 | Regions & pricing config | `M04-regions.md` | todo |
| M5 | Driver onboarding | `M05-driver-onboarding.md` | todo |
| M6 | Realtime infrastructure | `M06-realtime.md` | todo |
| M7 | On-demand ride loop | `M07-ride-loop.md` | todo |
| M8 | Money | `M08-money.md` | todo |
| M9 | Surge & heatmap | `M09-surge.md` | todo |
| M10 | Communication & safety | `M10-comms-safety.md` | todo |
| M11 | Trust & quality | `M11-trust.md` | todo |
| M12 | Scheduled & shared rides | `M12-scheduled-shared.md` | todo |
| M13 | Growth | `M13-growth.md` | todo |
| M14 | Support & content | `M14-support.md` | todo |
| M15 | Analytics & launch hardening | `M15-analytics-hardening.md` | todo |

---

## Ticket status

Statuses live here (milestone files describe content only, they are never edited for status).

### M1 — Foundation & scaffolding
| Ticket | Title | Status |
|---|---|---|
| M1-T1 | Monorepo layout & root tooling | done |
| M1-T2 | Backend skeleton | done |
| M1-T3 | Admin web shell | done |
| M1-T4 | Rider app shell | done |
| M1-T5 | Driver app shell | done |
| M1-T6 | Cross-client integration smoke | done |
| M1-T7 | Review audit | review_passed |

### M2 — Auth & accounts
| Ticket | Title | Status |
|---|---|---|
| M2-T1 | Auth contract & migrations | done |
| M2-T2 | Auth backend | done |
| M2-T3 | Rider app auth screens | done |
| M2-T4 | Driver app auth screens | done |
| M2-T5 | Admin login | done |
| M2-T6 | Auth integration (real SMS) | done |
| M2-T7 | Review audit | in_progress |

### M3 — RBAC & admin foundation
| Ticket | Title | Status |
|---|---|---|
| M3-T1 | RBAC contract & migrations | todo |
| M3-T2 | RBAC backend & audit log | todo |
| M3-T3 | Admin UI: roles, admins, audit | todo |
| M3-T4 | RBAC integration | todo |
| M3-T5 | Review audit | todo |

### M4 — Regions & pricing config
| Ticket | Title | Status |
|---|---|---|
| M4-T1 | Regions contract & migrations | todo |
| M4-T2 | Regions backend | todo |
| M4-T3 | Admin UI: regions & zone drawing | todo |
| M4-T4 | Apps: region resolution | todo |
| M4-T5 | Regions integration | todo |
| M4-T6 | Review audit | todo |

### M5 — Driver onboarding
| Ticket | Title | Status |
|---|---|---|
| M5-T1 | Onboarding contract & migrations | todo |
| M5-T2 | Onboarding backend | todo |
| M5-T3 | Driver app: application flow | todo |
| M5-T4 | Admin UI: review queues | todo |
| M5-T5 | Onboarding integration | todo |
| M5-T6 | Review audit | todo |

### M6 — Realtime infrastructure
| Ticket | Title | Status |
|---|---|---|
| M6-T1 | Realtime contract & migrations | todo |
| M6-T2 | Notifications backend (FCM + center) | todo |
| M6-T3 | Tracking & routing backend | todo |
| M6-T4 | Clients: maps, streaming, notification center | todo |
| M6-T5 | Realtime integration (Firebase creds) | todo |
| M6-T6 | Review audit | todo |

### M7 — On-demand ride loop
| Ticket | Title | Status |
|---|---|---|
| M7-T1 | Ride contract & migrations | todo |
| M7-T2 | Ride backend (dispatch, lifecycle, fare core) | todo |
| M7-T3 | Rider app: booking → completion | todo |
| M7-T4 | Driver app: offer → completion | todo |
| M7-T5 | Ride loop integration & e2e | todo |
| M7-T6 | Review audit | todo |

### M8 — Money
| Ticket | Title | Status |
|---|---|---|
| M8-T1 | Money contract & migrations | todo |
| M8-T2 | Money backend | todo |
| M8-T3 | Rider app: wallet, tips, fees | todo |
| M8-T4 | Driver app: earnings & balance | todo |
| M8-T5 | Admin UI: grants, refunds, settlements | todo |
| M8-T6 | Money integration | todo |
| M8-T7 | Review audit | todo |

### M9 — Surge & heatmap
| Ticket | Title | Status |
|---|---|---|
| M9-T1 | Surge computation backend | todo |
| M9-T2 | Clients: heatmap, surge display, override UI | todo |
| M9-T3 | Surge integration | todo |
| M9-T4 | Review audit | todo |

### M10 — Communication & safety
| Ticket | Title | Status |
|---|---|---|
| M10-T1 | Comms contract & migrations | todo |
| M10-T2 | Chat, share page, SOS backend | todo |
| M10-T3 | Apps: chat, dial, share, SOS | todo |
| M10-T4 | Admin: live ops map & SOS alerts | todo |
| M10-T5 | Comms integration | todo |
| M10-T6 | Review audit | todo |

### M11 — Trust & quality
| Ticket | Title | Status |
|---|---|---|
| M11-T1 | Trust contract & migrations | todo |
| M11-T2 | Ratings, reports, metrics backend | todo |
| M11-T3 | Apps: rating, reporting, performance | todo |
| M11-T4 | Admin: reports queue & flags | todo |
| M11-T5 | Trust integration | todo |
| M11-T6 | Review audit | todo |

### M12 — Scheduled & shared rides
| Ticket | Title | Status |
|---|---|---|
| M12-T1 | Scheduled/shared contract & migrations | todo |
| M12-T2 | Scheduled & shared backend | todo |
| M12-T3 | Rider app: scheduling & shared rides | todo |
| M12-T4 | Driver app: claim board & shared flow | todo |
| M12-T5 | Integration | todo |
| M12-T6 | Review audit | todo |

### M13 — Growth
| Ticket | Title | Status |
|---|---|---|
| M13-T1 | Growth contract & migrations | todo |
| M13-T2 | Promos, referrals, loyalty, gamification backend | todo |
| M13-T3 | Rider app: growth features | todo |
| M13-T4 | Driver app + admin: challenges & promos | todo |
| M13-T5 | Integration | todo |
| M13-T6 | Review audit | todo |

### M14 — Support & content
| Ticket | Title | Status |
|---|---|---|
| M14-T1 | Support contract & migrations | todo |
| M14-T2 | Tickets, help CMS, lost items, feedback backend | todo |
| M14-T3 | Apps: support, lost items, feedback | todo |
| M14-T4 | Admin: queues, CMS, categories | todo |
| M14-T5 | Integration | todo |
| M14-T6 | Review audit | todo |

### M15 — Analytics & launch hardening
| Ticket | Title | Status |
|---|---|---|
| M15-T1 | Analytics backend & CSV export | todo |
| M15-T2 | Admin dashboard UI | todo |
| M15-T3 | Incentives engine | todo |
| M15-T4 | i18n & RTL completeness audit | todo |
| M15-T5 | Load test (1k concurrent) & fixes | todo |
| M15-T6 | Backups, restore drill, launch-gate checklist | todo |
| M15-T7 | Final review audit | todo |

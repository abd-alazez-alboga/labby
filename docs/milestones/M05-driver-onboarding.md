# M5 — Driver Onboarding

> Status lives in `README.md`. Prereq: M4 `review_passed`.

## User stories
- As a user, I apply to drive: documents + vehicle, and track every stage. (UC-D-01…03, DRV-01/02)
- As an admin, I review applications, request per-item changes, approve (assigning the vehicle's service types) or reject. (UC-A-10, DRV-02/03)
- As a driver, I switch vehicles with re-review, and renew expiring documents; expiry auto-suspends me. (UC-D-18/19, DRV-03/04)
- As an admin, I see upcoming document expirations before they bite. (UC-A-12)

## Scope
SRS: DRV-01…04 (DRV-05 availability belongs to M6/M7), USR-01 (driver role activation), NFR-S2 (private document storage). Suspension here = document-expiry auto-suspension + the role state machinery; rating-based suspension is M11.

**Out:** going online, offers (M6/M7); performance metrics (M11).

## Tickets

### M5-T1 — Onboarding contract & migrations
Migrations: `driver_profiles` (application status), `documents` (type, number, expiry, file ref, review status), `vehicles` (details, photos, service types, active flag, review status). OpenAPI: application submit/resubmit/status, document upload, vehicle switch, admin review actions, expiry dashboard. Private file storage design (local disk store + permission-checked expiring URLs — `StorageProvider` seam).
**AC:** migrations clean; one-active-vehicle constraint at DB level; storage design satisfies NFR-S2.

### M5-T2 — Onboarding backend
Application state machine (`submitted → under_review → needs_changes → approved/rejected`) with per-item correction requests; notifications on every stage change (push arrives M6 — emit through the notification seam, deliverable later; persist for the center); document upload/validation (type, expiry-in-future); approval activates driver role + admin assigns vehicle service types; vehicle switch flow (old active until new approved); scheduled expiry job: reminders 30/7 days, auto-suspend on expiry, un-suspend on approved renewal; expiry dashboard query.
**AC:** integration tests cover UC-D-01…03/18/19 incl. races (double review, switch during review) and the expiry→suspend→renew→unsuspend cycle (clock-controlled); files inaccessible without permission; ArchUnit green.

### M5-T3 — Driver app: application flow
Application wizard (personal details, 4 documents with camera/file upload + number + expiry, vehicle details + photos); stage tracker with notes; resubmission of flagged items only; vehicle switch screen; document renewal screen; suspended-for-expiry state with clear reason.
**AC:** full wizard navigable with validation per UC-D-01 exceptions; resubmission touches only flagged items; tests green.

### M5-T4 — Admin UI: review queues
Application queue with document viewer (secure URLs), per-item change requests, approve (service-type assignment) / reject with reason; vehicle-switch review queue; document-expiry dashboard (30/7-day horizon + expired list).
**AC:** reviewer completes UC-A-10/11/12 end-to-end from the UI; permission-gated; tests green.

### M5-T5 — Onboarding integration
End-to-end: seeded rider applies → admin requests changes → resubmit → approve → driver role active in the app; expiry simulation → suspension visible in app → renewal → restored. Seeder extended with approved demo drivers (+vehicles) for later milestones.
**AC:** walkthrough passes; demo drivers seeded.

### M5-T6 — Review audit
Audit against DRV-01…04, UC-D-01…03/18/19, UC-A-10…12, NFR-S2; state machine soundness; storage security.
**AC:** findings resolved; tracker `review_passed`.

## Dependency plan
```
T1 → (T2 ∥ T3 ∥ T4) → T5 → T6
```

## Milestone acceptance criteria
- A user becomes an approved driver entirely through app + dashboard, with every stage notified and audited.
- Document expiry provably suspends and renewal provably restores, on a controlled clock.
- Documents are never publicly reachable.
- Tracker updated; review audit passed.

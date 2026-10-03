# Labby — Driver Use Cases

Scope: **V1 only.** Shared behaviors (account, auth, profile, chat, call, trip share, SOS, rating, reporting, support, feedback, gamification, notifications) live in `shared.md` (UC-S-xx). A driver account always also holds the rider role's capabilities via the Rider app (USR-01); those are in `rider.md`.

---

## Onboarding

### UC-D-01 — Apply to become a driver
**Actor:** registered user (or new user via Driver app, which runs UC-S-01 first)
**Trigger:** opens the Driver app without an approved driver role
**Main flow:**
1. User starts the application: personal details.
2. Uploads the 4 documents — government ID, driver's license, vehicle registration, insurance — each as photo + document number + **expiry date**.
3. Enters vehicle details: make, model, year, color, plate, seats, photos.
4. Submits → application `submitted`; user sees the stage tracker.
**Exceptions:**
- E1 Missing/unreadable upload → submission blocked with per-item errors.
- E2 Document already expired → rejected at entry.
- E3 Plate already registered to another active driver → flagged for admin review.
**Postconditions:** application queued for admin review (UC-A-10); every later stage change notifies the applicant.
**SRS:** DRV-01, DRV-02, AUTH-01

### UC-D-02 — Resubmit after "needs changes"
**Trigger:** admin requested corrections on specific items
**Main flow:** driver sees exactly which items need fixing + admin notes → resubmits only those → application returns to `under_review`.
**SRS:** DRV-02

### UC-D-03 — Track application status
**Main flow:** applicant opens the Driver app → sees current stage (`submitted / under_review / needs_changes / approved / rejected`) with history and notes; push on every change.
**Alternates:** A1 Approved → driver role activates; driver home unlocks. A2 Rejected → reason shown; reapplication allowed.
**SRS:** DRV-02, USR-01

---

## Availability & Matching

### UC-D-04 — Go online / offline
**Preconditions:** driver role `active`; approved vehicle; no blocking conditions
**Main flow:**
1. Driver toggles **online** → GPS streaming starts (every 5 s) → driver enters the dispatch pool for their position, vehicle's service types, and region.
2. Driver toggles **offline** → streaming stops; no new offers; an active ride must finish first.
**Exceptions:**
- E1 Driver role suspended (rating, expired document, manual) → toggle blocked with reason.
- E2 Balance below floor (default −50) → toggle allowed but **no offers** until settlement (COM-03); banner explains.
- E3 GPS permission denied → cannot go online; prompt to enable.
**SRS:** DRV-05, TRK-01, COM-03, DRV-04

### UC-D-05 — Set weekly availability windows
**Main flow:** driver defines recurring weekly windows → windows gate which scheduled-ride board entries the driver sees (UC-D-11).
**SRS:** DRV-05, RIDE-S2

### UC-D-06 — Receive and answer a ride offer
**Preconditions:** online, idle (or finishing a ride about to complete)
**Main flow:**
1. Offer arrives: pickup point + distance/ETA to it, **destination**, estimated fare, surge flag, rider rating.
2. 15 s countdown shown.
3. Driver **accepts** → ride `accepted`; rider info unlocked; navigation to pickup begins (UC-D-07).
**Alternates:**
- A1 Driver **declines** → offer moves to next candidate; decline recorded (acceptance metric).
- A2 Timeout → counts as decline for metrics; next candidate.
**Exceptions:** E1 Ride cancelled by rider while offer pending → offer vanishes with notice.
**SRS:** RIDE-03, DRV-06

### UC-D-07 — Navigate to pickup and mark arrived
**Main flow:**
1. Driver follows the route to pickup (OSRM route shown; live position streamed to the rider).
2. Within the 100 m geofence, driver taps **Arrived** → rider notified; wait grace (5 min) starts, then wait charges accrue to the fare.
3. Rider boards.
**Alternates:** A1 Rider requests coordination → chat / quick replies / call (UC-S-13/14).
**Exceptions:**
- E1 "Arrived" outside geofence → rejected with distance hint.
- E2 Rider no-show → driver may cancel with reason `no-show` after the grace window; rider pays the cancellation fee; driver released (RIDE-07 terms).
**SRS:** RIDE-04, PRC-03, TRK-02

### UC-D-08 — Start and conduct the ride
**Main flow:**
1. Driver taps **Start ride** → `in_progress`; metering runs on GPS + time.
2. Driver follows the route through stops (≤ 3) to the destination; rider-made destination/stop changes update the route live.
3. SOS, chat, call remain available.
**Exceptions:** E1 GPS stream lost > 30 s → both parties see "connection lost"; trace gap handled at fare time (support-reviewable).
**SRS:** RIDE-05, TRK-03, TRK-04

### UC-D-09 — Complete the ride and collect payment
**Main flow:**
1. At destination, driver taps **End ride** → system computes the metered fare; itemized breakdown shown.
2. **Cash:** driver collects and taps "payment received". **Wallet:** auto-deducted, driver sees confirmation. **Mixed:** wallet part auto, remainder shown as cash due.
3. Earnings ledger updates instantly: wallet ride → fare − commission credited; cash ride → commission debited (driver keeps cash). Real-time per-trip earnings shown.
4. Rating prompt (UC-S-17).
**Exceptions:** E1 Rider disputes/refuses cash → driver marks unpaid → support path; ride still completes.
**SRS:** RIDE-06, PAY-02, COM-01, DRV-06

### UC-D-10 — Cancel an accepted ride
**Main flow:** driver cancels before `in_progress`, picking a mandatory reason → rider notified + re-dispatched automatically → cancellation feeds the driver's cancellation metric (warnings per DRV-07); the rider is never charged.
**SRS:** RIDE-07, DRV-07

---

## Scheduled & Shared Rides

### UC-D-11 — Claim a scheduled ride
**Preconditions:** availability window covers the slot; region + service type match
**Main flow:**
1. Driver opens the **claim board** → list of open scheduled requests (time, pickup area, destination, estimated fare basis).
2. Driver claims one → locked to them; rider notified; reminders at 24 h + 1 h.
**Exceptions:** E1 Already claimed by another driver (race) → claim fails with refresh.
**SRS:** RIDE-S2, RIDE-S3, DRV-05

### UC-D-12 — Fulfill a scheduled ride
**Main flow:** at pickup time the claimed ride converts to a live ride in `accepted` → flows UC-D-07 … UC-D-09 apply.
**Exceptions:** E1 Driver cancels a claim → rider notified; ride returns to the board (or live dispatch if near pickup time, RIDE-S4); cancellation metric fed.
**SRS:** RIDE-S3, RIDE-S4

### UC-D-13 — Drive a shared ride
**Preconditions:** vehicle capacity ≥ booked seats
**Main flow:**
1. Dispatch offer indicates a shared ride (party count, single pickup, single destination).
2. Driver accepts → proceeds to the common pickup; members board; driver starts the ride.
3. At destination, driver ends the ride → per-seat split computed; each member's payment collected per their own method (cash portions itemized per member).
**Exceptions:** E1 A member no-shows at pickup → driver marks them absent; their share follows cancellation rules; remaining members proceed.
**SRS:** RIDE-P3, RIDE-P4, RIDE-P5

---

## Earnings & Performance

### UC-D-14 — View the demand heatmap
**Main flow:** driver opens the heatmap → surge zones colored by live demand/supply (refreshed with the surge cycle) → driver repositions by own judgment.
**SRS:** DRV-09, PRC-02

### UC-D-15 — View earnings
**Main flow:** driver opens earnings → real-time per-trip breakdowns (fare, commission rate + amount, tips, bonuses) → weekly/monthly summaries → current commission tier and next-tier progress.
**SRS:** COM-01, COM-02, DRV-06 (earnings view), 5.8a decision

### UC-D-16 — Monitor balance and settle debt
**Main flow:**
1. Driver watches the running balance (cash-ride commission debt vs credits).
2. Nearing the floor → warning notification.
3. Below floor (default −50) → offers stop; banner explains; driver settles **off-app** (hands cash / transfers) with an admin, who records it (UC-A-27).
4. Settlement recorded → balance restored above floor → offers resume automatically.
**SRS:** COM-03, COM-04

### UC-D-17 — Track incentive progress
**Main flow:** driver opens incentives → live progress on weekly trip bonuses (40+/60+), peak-hour bonus windows (map/time hints), weekly rating reward (≥ 4.8 avg, ≥ 30 trips) → earned amounts auto-credit the ledger with notifications.
**SRS:** DRV-08, COM-01

### UC-D-18 — Switch vehicle
**Main flow:**
1. Driver submits the new vehicle: details + its registration + insurance documents.
2. Old vehicle remains active while the new one is `under_review`.
3. On approval (admin assigns the new vehicle's service types), the new vehicle becomes the single active one.
**Exceptions:** E1 Rejected → driver keeps the old vehicle; reasons shown.
**SRS:** DRV-03

### UC-D-19 — Renew an expiring document
**Trigger:** reminders at 30 and 7 days before expiry
**Main flow:** driver uploads the renewed document → reviewed by admin → on approval the expiry clock resets.
**Exceptions:** E1 Document expires before approval of a renewal → driver role **auto-suspends** until the renewed document is approved; offers stop immediately.
**SRS:** DRV-04

### UC-D-20 — View performance dashboard and warnings
**Main flow:** driver opens performance → acceptance rate, cancellation rate, on-time % (≤ 5 min after quoted ETA), average rating over rolling 7/30-day windows → active warnings shown with the metric and threshold that triggered them.
**Alternates:** A1 Rating near the auto-suspension threshold → explicit warning with the exact rule (USR-05).
**SRS:** DRV-06, DRV-07, USR-05

### UC-D-21 — Handle a lost-item case
**Trigger:** rider reported an item on one of the driver's completed rides
**Main flow:**
1. Driver is notified; the ride chat reopens.
2. Driver checks the vehicle, replies in chat (text / quick replies) or calls.
3. Coordination of handover happens via chat/call; support updates the case (`found` → `returned`) as it progresses; driver sees case status.
**Alternates:** A1 Item not found → driver says so in chat; support closes `not_found`.
**SRS:** LOST-01, LOST-02, CHAT-01

# Labby — Rider Use Cases

Scope: **V1 only.** Shared behaviors (account, auth, profile, chat, call, trip share, SOS, rating, reporting, support, feedback, gamification, notifications) live in `shared.md` (UC-S-xx) and are not repeated here.

---

## Setup & Preferences

### UC-R-01 — Manage saved locations
**Main flow:** rider opens saved locations → adds "Home"/"Work"/custom-named places (map pin or search) → edits or deletes entries → saved locations appear as one-tap choices in booking.
**Exceptions:** E1 Duplicate name → rejected with prompt to rename.
**SRS:** USR-03, RIDE-01

### UC-R-02 — Set comfort preferences
**Main flow:** rider sets temperature preference, conversation level, music preference → persisted → shown to the driver on every subsequent trip.
**SRS:** USR-03 (comfort preferences), 3.6b decision

### UC-R-03 — Set matching toggles
**Main flow:** rider toggles "Nearby drivers only" **or** "Accept distant driver fee" → persisted → applied to dispatch and fare (pickup-distance fee) on every booking; current effect shown in the booking screen.
**SRS:** USR-03, RIDE-03, PRC-03

---

## On-Demand Rides

### UC-R-04 — Request a ride
**Trigger:** rider opens booking
**Preconditions:** rider role `active`; inside an operating region
**Main flow:**
1. Rider sets pickup (map pin / search / saved location), destination, and up to 3 stops.
2. Rider picks a service type (region's list with per-type estimate).
3. Rider picks payment method (cash / wallet) and may apply a promo code.
4. System shows the fare **estimate**: OSRM route × region pricing × current pickup-zone surge (flagged when > 1.0×) + foreseeable extras, promo applied — labeled as an estimate.
5. Rider confirms → ride `requested`, surge multiplier **locked**, dispatch starts (UC-R-05).
**Alternates:**
- A1 Promo invalid/expired/limit-reached → clear error, booking continues without it.
- A2 Surge active → multiplier + explanation shown before confirm.
- A3 "Accept distant driver fee" riders see the potential pickup fee range before confirm.
**Exceptions:**
- E1 Pickup outside any region → booking blocked with message.
- E2 OSRM unreachable → straight-line estimate flagged "approximate" (NFR-A3).
- E3 Rider role suspended → booking blocked with reason + appeal info.
- E4 Rider already has an active ride → blocked (one active ride per rider).
**Postconditions:** ride exists in `requested`; estimate + locked surge stored.
**SRS:** RIDE-01, RIDE-02, PRC-01, PRC-02, GRW-01, NFR-A3

### UC-R-05 — Track dispatch and driver approach
**Main flow:**
1. Rider sees "finding your driver" while sequential offers run.
2. On acceptance: driver identity (first name, photo, per-role rating), vehicle (make/model/color/plate/photo), live position, pickup ETA.
3. Chat/call/trip-share/SOS become available (UC-S-13…16).
4. Driver arrival notification; 5-min wait grace starts, then per-minute wait charges with an in-app running notice.
**Alternates:** A1 Driver connection lost > 30 s → "connection lost" indicator (TRK-04).
**Exceptions:**
- E1 `no_driver_found` (timeout/exhaustion) → rider notified, one-tap retry (RIDE-08).
- E2 Driver cancels after accepting → rider notified, dispatch restarts automatically, no rider charge.
**SRS:** RIDE-03, RIDE-04, TRK-02, TRK-04, PRC-03

### UC-R-06 — Ride in progress
**Preconditions:** driver tapped "Start ride"
**Main flow:**
1. Rider follows live route + continuously refreshed ETA.
2. Rider may change destination or add stops (≤ 3 total); estimate updates; metering simply continues.
3. ETA-affecting events (reroute, heavy delay) surface as notifications.
**Exceptions:** E1 Attempt to exceed 3 stops → rejected.
**SRS:** RIDE-05, TRK-02, RIDE-01

### UC-R-07 — Complete and pay
**Trigger:** driver ends the ride at destination
**Main flow:**
1. System computes the final metered fare: actual GPS distance + duration × region pricing × locked surge + wait/pickup-distance extras − promo/credits, floored at the minimum fare.
2. Itemized breakdown shown to both parties.
3. Payment per chosen method: **cash** → driver confirms collection; **wallet** → auto-deducted.
4. Receipt generated (route map, timestamps, breakdown) into ride history; rating prompts fire (UC-S-17).
**Alternates:**
- A1 Wallet shortfall → wallet drained, **remainder due in cash**, both parties shown the split (PAY-02).
- A2 Promo makes the fare 0 → cash step skipped, receipt still issued.
**Exceptions:**
- E1 Cash dispute (driver claims non-payment) → driver marks unpaid → support ticket path; ride still completes.
**Postconditions:** fare components stored immutably; ledgers updated (COM-01).
**SRS:** RIDE-06, PRC-01, PRC-04, PAY-02, COM-01

### UC-R-08 — Tip the driver
**Preconditions:** ride in progress or ≤ 24 h after completion; wallet balance available
**Main flow:** rider opens tip screen → picks a suggested amount or custom → wallet debited, driver credited 100%, commission-free → reflected in both receipts.
**Exceptions:** E1 Insufficient wallet balance → tip rejected (cash tips happen outside the app).
**SRS:** PAY-04

### UC-R-09 — Cancel a ride
**Trigger:** rider cancels between `requested` and `in_progress`
**Main flow:**
1. Rider taps cancel, picks a reason.
2. Within grace (default 2 min post-acceptance) or before acceptance → free.
3. After grace / driver en route beyond threshold → cancellation fee (region + service type) charged via the ride's payment method.
4. Driver (if assigned) notified and released.
**Exceptions:** E1 Cancel after `in_progress` → not allowed; ride must complete (support handles disputes).
**SRS:** RIDE-07, PRC-03

---

## Scheduled Rides

### UC-R-10 — Schedule a ride
**Main flow:**
1. Rider books with a future pickup time (**no horizon limit**) — same options as UC-R-04.
2. Estimate shown flagged "priced at ride time" (surge evaluated at execution).
3. Request lands on the drivers' claim board (availability-window matched).
4. Rider notified when a driver claims; reminders at 24 h + 1 h.
**Exceptions:** E1 Pickup time in the past / too near → treated as on-demand or rejected with message.
**SRS:** RIDE-S1, RIDE-S2, RIDE-S3

### UC-R-11 — Manage a scheduled ride
**Main flow:** rider views upcoming scheduled rides (claim status visible) → may cancel (scheduled-ride cancellation terms per region shown first).
**Alternates:**
- A1 Unclaimed at T−15 min → auto-falls into live dispatch; rider sees normal "finding your driver".
- A2 Live dispatch also fails → rider notified early enough to replan (RIDE-S4).
**SRS:** RIDE-S2, RIDE-S4, RIDE-07

---

## Shared (Public) Rides

### UC-R-12 — Create a shared ride
**Main flow:**
1. Rider defines **one pickup point, one destination**, departure (time or "when full"), total seats offered, own party size.
2. System validates seat count against available vehicle capacities in the region.
3. Ride published — visible to other riders in the region.
**Exceptions:** E1 Party size > seats → rejected.
**SRS:** RIDE-P1

### UC-R-13 — Join a shared ride
**Main flow:**
1. Rider browses/searches open shared rides (region, destination, time).
2. Picks one; enters party size; system checks remaining seats.
3. Join is **automatic (first-come)**; member sees pickup point, departure rule, current occupancy, per-seat price basis.
**Exceptions:** E1 Remaining seats < party size → join blocked. E2 Ride dispatched/cancelled meanwhile → join fails with refresh.
**SRS:** RIDE-P2

### UC-R-14 — Leave a shared ride
**Preconditions:** before dispatch
**Main flow:** member leaves → seats freed → creator + members see updated occupancy.
**Exceptions:** E1 After dispatch → leaving = normal cancellation rules per member (RIDE-P5).
**SRS:** RIDE-P5

### UC-R-15 — Start / cancel a shared ride (creator)
**Main flow:**
- Start: creator taps "start now" (or the system auto-dispatches when all seats fill) → normal sequential dispatch with vehicle-capacity requirement → all members track the driver (UC-R-05 flows apply to each member).
- Cancel: creator cancels before dispatch → group cancelled, every member notified.
**Completion:** final metered fare split **per seat**; each party pays via its own method; individual receipts; each member may rate the driver.
**SRS:** RIDE-P3, RIDE-P4, RIDE-P5

---

## History, Wallet & Growth

### UC-R-16 — View ride history and receipts
**Main flow:** rider opens history (kept forever) → list with filters → detail: route map from stored GPS trace, timestamps, driver info, full fare breakdown → receipt viewable in-app.
**SRS:** RIDE-06, PRC-04, TRK-03

### UC-R-17 — View wallet
**Main flow:** rider opens wallet → per-currency balances + transaction history (typed entries: referral, promo, loyalty redemption, refund, admin grant, fare payment, tip).
**SRS:** PAY-01

### UC-R-18 — Refer a friend
**Main flow:** rider opens referral screen → shares personal code/link → referee registers with the code → on the referee's **first completed ride**, both receive wallet credit (push + center entries).
**Exceptions:** E1 Self-referral / reactivated-account referral → blocked (GRW-03). E2 Code entered after registration → not accepted (entry happens at registration).
**SRS:** GRW-03

### UC-R-19 — Earn and redeem loyalty points
**Main flow:** points accrue automatically (1 pt per currency unit on completed rides) → rider views balance + history → redeems (default 100 pts → 5 credit) → wallet credited instantly.
**Exceptions:** E1 Below redemption threshold → redeem disabled.
**SRS:** GRW-04

### UC-R-20 — Report a lost item
**Trigger:** after a completed ride
**Main flow:**
1. Rider opens the ride in history → "report lost item" → description + photos.
2. Case opens (`reported`); the ride's chat **reopens** for direct coordination with the driver.
3. Rider coordinates return via chat/call; support tracks the case to closure; rider notified on every case status change.
**Alternates:** A1 Item not found → case closed `not_found`, rider notified.
**SRS:** LOST-01, LOST-02, CHAT-01

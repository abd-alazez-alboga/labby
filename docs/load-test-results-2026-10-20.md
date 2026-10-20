# Load test results — 2026-10-20 (M15-T5)

**Result:** at 1,000 concurrent users (300 drivers sending GPS every 5 s + 700 riders booking and
reading) every NFR-P1/P2/P3 target is met in steady state:
- **Errors:** zero in 161,646 requests.
- **First offer:** p95 1.07 s once the ramp was over.
- **The one exception:** during the single minute in which the ramp ended, on a backend started
  two minutes earlier (cold JVM), **26 of 2,798 rides (0.9 %) waited 3.0–3.6 s** for their first
  offer. Details are under run 3.

No code change was needed. Run 3 is the measurement of record. It was made after the M15 review
corrected the harness: GPS samples now go out on a true 5 s schedule, and rides that never get an
offer are counted. Raw data: [`load-test-2026-10-20/`](load-test-2026-10-20/).

| Target (SRS) | Measured (run 3) | Verdict |
|---|---|---|
| NFR-P1: 1,000 concurrent active users incl. ~300 drivers @ 5 s GPS | 1,000 accounts driven (998 logged in: 2 logins hit an I/O error in the setup burst, so 299 drivers + 699 riders) for 600 s + drain; ~250 req/s sustained; 33,976 GPS samples = one per driver every **5.0 s** | ✅ |
| NFR-P2: request → first offer ≤ 3 s | **steady state (from 01:19, after the ramp minute): 0 of 2,522 over 3 s, p95 1.07 s, max 2.17 s.** Whole run: p50 0.77 s · p95 1.60 s · max 3.64 s · 26 of 2,798 over 3 s, all in the ramp minute · 0 rides never offered | ✅ steady state · ⚠ cold-start ramp minute |
| NFR-P2: API reads p95 ≤ 500 ms | every read endpoint p95 **≤ 41 ms** (worst: `GET /rides/{id}` 40.4 ms) | ✅ |
| NFR-P2: location ingestion keeps the 5 s cadence, no backlog | `POST /driver/locations` p95 28.9 ms; time spent receiving a sample (`received_at − recorded_at`) p95 **19.6 ms**, max 40 ms; **299 of 299** drivers had a sample in the last 15 s before the stop | ✅ |
| NFR-P3: live positions ≤ one update cycle (5 s) + network | ≤ 40 ms server time on top of the 5 s cadence | ✅ |

## Setup (honest scope)

- **Machine:** one laptop — Intel i7-13620H (16 threads), 30 GB RAM — running the backend, the
  database AND the load generator at the same time (worse than a dedicated server for the backend;
  the generator competes for CPU).
- **Backend:** the packaged jar (`java -Xms1g -Xmx2g -jar backend-0.1.0.jar`, built from
  `4620c81`, the M15 backend), started with no Spring profile:
  - no dev seeders; the real dispatcher (1 s tick), monitor, surge and outbox;
  - not the `prod` profile file (`application-prod.yml` only adds production logging and config);
  - external services pointed at dead addresses so the test sent nothing outside: SMS gateway,
    Firebase (push), and **OSRM**. Routing therefore fell back to straight-line estimates per
    NFR-A3, so routing cost is NOT measured here (see the caveats).
- **Database:** PostgreSQL 16.4 + PostGIS 3.4 in Docker (`labby-postgres`), the local dev data
  plus the test accounts and rides of the earlier runs (≈ 5,900 rides before run 3).
- **Load generator:** [`LoadScenario`](../backend/src/test/java/com/labby/backend/load/LoadScenario.java)
  (JDK HttpClient on virtual threads; excluded from the build, run explicitly). It seeds the
  accounts, approved drivers, vehicles and documents straight into the database, logs everyone in
  through the API, then drives only the real API. Everyone starts within the 60 s ramp, and the
  run lasts 600 s from the first start.
  - **Drivers (300):** go online, then:
    - a GPS sample every 5 s on a fixed schedule (random walk around the region centre);
    - poll `GET /driver/offers/open` every 2 s (the apps use the realtime socket; polling is the
      heavier case);
    - on an accepted offer: jump to the pickup → arrive → start → 4 GPS steps → complete →
      cash-confirm → back to polling.
  - **Riders (700):** every 15–45 s, 25 % book a cash ride (≈ 2 km pickups around the centre)
    and poll `GET /rides/{id}` every 3 s until it ends. The rest read active ride, ride history,
    wallet and region resolve.
- First-offer and ingestion numbers come from the database (`ride_offers.offered_at −
  rides.requested_at`; `driver_locations.received_at − recorded_at`) for the run's rides only.
  Rides with no offer are counted separately (0 in run 3). The ingestion figure is the server's
  receive time: `received_at` is stamped synchronously when the sample is stored.
- The dev region's driver balance floor was lowered for the run and restored afterwards (see run 1).

## Run 3 — per endpoint (ms)

| Endpoint | Count | p50 | p95 | p99 | Max |
|---|---|---|---|---|---|
| `GET /driver/offers/open` | 49,494 | 10.1 | 23.1 | 47.6 | 479.0 |
| `GET /regions/resolve` | 8,046 | 7.6 | 17.1 | 35.9 | 304.0 |
| `GET /rides` (history) | 8,046 | 19.7 | 32.9 | 59.5 | 255.3 |
| `GET /rides/active` | 8,046 | 11.3 | 25.6 | 53.3 | 469.7 |
| `GET /rides/{id}` | 28,960 | 25.0 | 40.4 | 66.6 | 414.8 |
| `GET /wallet` | 8,046 | 8.7 | 21.1 | 44.4 | 348.0 |
| `POST /driver/locations` | 33,976 | 14.6 | 28.9 | 54.2 | 486.4 |
| `POST /rides` (booking) | 2,798 | 62.9 | 95.3 | 153.1 | 749.8 |
| `POST /driver/offers/{id}/accept` | 2,787 | 53.3 | 82.5 | 132.5 | 354.4 |
| `POST /driver/rides/{id}/arrive` | 2,787 | 45.7 | 69.1 | 105.3 | 491.6 |
| `POST /driver/rides/{id}/start` | 2,787 | 44.7 | 68.4 | 110.6 | 466.5 |
| `POST /driver/rides/{id}/complete` | 2,787 | 91.8 | 131.8 | 189.0 | 544.6 |
| `POST /driver/rides/{id}/cash-confirm` | 2,787 | 48.6 | 71.4 | 105.1 | 308.2 |
| `PUT /driver/availability` | 299 | 30.5 | 98.1 | 311.9 | 482.5 |

Rides: 2,798 booked, **2,787 completed**, 7 still being offered when the run stopped, and 4
ended "no driver found" (at the stop). There were no 5xx responses, no HTTP errors and no backend
ERROR log line.

**First offer by minute** (from the database):

| Minute (UTC) | Rides | Over 3 s | p95 (s) | Max (s) |
|---|---|---|---|---|
| 01:17 (ramp) | 28 | 0 | 1.59 | 1.65 |
| **01:18 (ramp ends; backend up 2 min)** | 248 | **26** | 3.16 | 3.64 |
| 01:19 | 271 | 0 | 1.31 | 1.99 |
| 01:20 | 306 | 0 | 1.87 | 2.17 |
| 01:21 – 01:27 (each minute) | 248–293 | 0 | 0.99–1.05 | ≤ 1.18 |

**Why the 01:18 slowdown is not a capacity problem:**
- All 26 slow offers came while the last riders of the ramp joined. The backend JVM had started
  two minutes earlier and was still compiling hot paths: the first sample shows the backend
  process at ~10 cores during logins, then 2–4.5 cores in steady state.
- In the slow minute, 110–120 drivers were busy, fewer than the 130 average over the run, so free
  drivers existed.
- Run 2, on a backend that had already served run 1, had no ride over 3 s.
- **Launch note:** warm the backend (or keep it running) before opening traffic. The
  production-size re-run on the launch checklist (row 10) repeats this measurement on the real
  server.

**Resources** (sampled every 30 s, [`run3-resources.txt`](load-test-2026-10-20/run3-resources.txt);
"java" adds the backend and the generator, "postgres" all PostgreSQL processes on the laptop): java
~2–4.5 cores and ~1.2 GB; postgres ~1.5–3.6 cores, growing to ~1.1 GB.

## Run 2 — kept for comparison

Run 2 ([`run2.json`](load-test-2026-10-20/run2.json),
[`run2-resources.txt`](load-test-2026-10-20/run2-resources.txt)) was the record before the review:
- **Traffic:** 1,000 users, 156,134 requests, 0 errors, reads p95 ≤ 30 ms.
- **First offer:** p95 1.02 s, max 1.24 s, 0 over 3 s, every one of its 2,671 rides offered.
- **Rides:** 2,662 completed.

Its harness checked for a due GPS sample only inside the 2 s poll loop, so a sample effectively
went out about every 6 s. 30,594 samples means ~11 % less GPS load than the stated 5 s. Run 3
fixes this.

## Run 1 — what it showed (kept for the record)

The first full run ([`run1-floor-blocked.json`](load-test-2026-10-20/run1-floor-blocked.json))
completed only **300 rides — one per driver** — and ended 2,879 bookings as "no driver found":
- **Latency:** reads p95 ≤ 28 ms, 0 errors in 159,969 requests. The run-1 harness counted
  first-offer time only for the 300 rides that got an offer, so its first-offer numbers say
  nothing about the 2,879 that did not.
- **Cause:** correct behaviour, not a defect.
  - Every ride was cash, so each driver's commission went onto their balance: −3,750 SYP after
    one ride.
  - That is below the dev region's balance floor (unset → the SRS default −50).
  - COM-03 blocks a driver at the floor from new offers until they settle.
- **Runs 2 and 3:** lowered the dev region's floor for the duration of the test (restored
  afterwards) to measure realistic repeat dispatch.
- **Launch note:** the SRS default floor of −50 is in currency units, so in SYP it blocks a driver
  after their first cash ride. Each region's floor must be set in its own currency scale (see the
  launch checklist, region configuration row).

## Caveats

1. **Routing not exercised:** OSRM was unreachable by design (no traffic to the public demo
   server — ES-04 forbids production-scale use). Estimates and pickup ETAs used the straight-line
   fallback, so the cost of routing calls is not in these numbers. Re-run against the self-hosted
   OSRM once launch-checklist row 1 is done.
2. **Same machine for everything:** the backend shared 16 threads with the database and the
   generator. A production server should do at least as well, but the launch checklist asks for a
   re-run on the production server size.
3. **Push not exercised:** Firebase pointed at a dead address; the outbox still drained (the
   dispatch job ran every 5 s) — FCM delivery cost is not measured.
4. **Polling instead of the realtime socket** for offers: heavier than the apps' real behaviour.
5. **The pickup approach is one GPS jump**, not a stream of samples; the in-ride leg sends 4 steps.

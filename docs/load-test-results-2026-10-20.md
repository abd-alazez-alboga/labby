# Load test results — 2026-10-20 (M15-T5)

**Result: all NFR-P1/P2/P3 targets met** at 1,000 concurrent active users (300 drivers streaming
GPS every 5 s + 700 riders booking and reading), 10 minutes after a 60 s ramp, **zero errors in
156,134 requests**. No code change was needed. Raw data: [`load-test-2026-10-20/`](load-test-2026-10-20/).

| Target (SRS) | Measured (run 2) | Verdict |
|---|---|---|
| NFR-P1: 1,000 concurrent active users incl. ~300 drivers @ 5 s GPS | 1,000 users (300 drivers + 700 riders) for 647 s, ~241 req/s sustained | ✅ |
| NFR-P2: request → first offer ≤ 3 s | p50 **0.71 s** · p95 **1.02 s** · max **1.24 s** · 0 of 2,671 over 3 s | ✅ |
| NFR-P2: API reads p95 ≤ 500 ms | every read endpoint p95 **≤ 30 ms** (worst: `GET /rides/{id}` 29.9 ms) | ✅ |
| NFR-P2: location ingestion keeps the 5 s cadence, no backlog | `POST /driver/locations` p95 19.9 ms (30,594 samples); server receive lag of the last sample p95 **8.6 ms**, max 19.9 ms; all 300 drivers fresh | ✅ |
| NFR-P3: live positions ≤ one update cycle (5 s) + network | receive lag ≤ 20 ms + the 5 s cadence | ✅ |

## Setup (honest scope)

- **Machine:** one laptop — Intel i7-13620H (16 threads), 30 GB RAM — running the backend, the
  database AND the load generator at the same time (worse than a dedicated server for the backend;
  the generator competes for CPU).
- **Backend:** the packaged jar (`java -Xms1g -Xmx2g -jar backend-0.1.0.jar`), **default
  (production) profile** — no dev seeders, the real dispatcher (1 s tick), monitor, surge, outbox.
  External services pointed at dead addresses so the test sent nothing outside: SMS gateway,
  Firebase (push), and **OSRM** (routing falls back to straight-line estimates per NFR-A3 — so
  routing cost is NOT measured here; see the caveat below).
- **Database:** PostgreSQL 16.4 + PostGIS 3.4 in Docker (`labby-postgres`), the local dev data
  plus the test accounts.
- **Load generator:** [`LoadScenario`](../backend/src/test/java/com/labby/backend/load/LoadScenario.java)
  (JDK 22 HttpClient on virtual threads; excluded from the build, run explicitly). It seeds the
  accounts, approved drivers, vehicles and documents straight into the database, logs everyone in
  through the API, then drives only the real API:
  - **Drivers (300):** go online; GPS sample every 5 s (random walk around the region centre);
    poll `GET /driver/offers/open` every 2 s (the apps use the realtime socket; polling is the
    heavier case); accept → stream toward pickup → arrive → start → 4 GPS steps → complete →
    cash-confirm → back to polling.
  - **Riders (700):** every 15–45 s, 25 % book a cash ride (≈ 2 km pickups around the centre) and
    poll `GET /rides/{id}` every 3 s until it ends; the rest read active ride, ride history,
    wallet and region resolve.
- First-offer and ingestion numbers come from the database (`ride_offers.offered_at −
  rides.requested_at`; `driver_locations.received_at − recorded_at`) for the run's rides only.

## Run 2 — per endpoint (ms)

| Endpoint | Count | p50 | p95 | p99 | Max |
|---|---|---|---|---|---|
| `GET /driver/offers/open` | 48,508 | 9.7 | 15.8 | 23.9 | 106.7 |
| `GET /regions/resolve` | 8,310 | 7.3 | 10.8 | 17.5 | 79.4 |
| `GET /rides` (history) | 8,310 | 17.5 | 24.1 | 33.3 | 93.7 |
| `GET /rides/active` | 8,310 | 11.0 | 16.3 | 26.4 | 94.0 |
| `GET /rides/{id}` | 27,511 | 22.3 | 29.9 | 40.1 | 128.2 |
| `GET /wallet` | 8,310 | 8.4 | 13.0 | 21.8 | 93.2 |
| `POST /driver/locations` | 30,594 | 13.7 | 19.9 | 29.8 | 108.9 |
| `POST /rides` (booking) | 2,671 | 55.7 | 69.3 | 84.0 | 139.3 |
| `POST /driver/offers/{id}/accept` | 2,662 | 48.7 | 60.0 | 75.4 | 127.2 |
| `POST /driver/rides/{id}/arrive` | 2,662 | 42.3 | 53.1 | 73.0 | 136.3 |
| `POST /driver/rides/{id}/start` | 2,662 | 41.0 | 51.7 | 68.2 | 120.2 |
| `POST /driver/rides/{id}/complete` | 2,662 | 86.9 | 106.0 | 125.7 | 209.6 |
| `POST /driver/rides/{id}/cash-confirm` | 2,662 | 45.3 | 56.9 | 72.1 | 118.5 |
| `PUT /driver/availability` | 300 | 21.9 | 29.6 | 42.3 | 78.7 |

Rides: 2,671 booked, **2,662 completed**, 9 still being offered when the run stopped; no "no driver
found". No 5xx, no I/O errors, no backend ERROR log line.

**Resources** (sampled every 30 s, [`run2-resources.log`](load-test-2026-10-20/run2-resources.log)):
backend ~2–3.5 cores, RSS ~2.0 GB (heap capped at 2 GB); PostgreSQL ~1.7–3 cores, ~180 MB.

## Run 1 — what it showed (kept for the record)

The first full run ([`run1-floor-blocked.json`](load-test-2026-10-20/run1-floor-blocked.json))
met every latency target too (reads p95 ≤ 28 ms, first offer p95 1.41 s / max 2.01 s, 0 errors in
159,969 requests) but completed only **300 rides — one per driver** and ended 2,879 bookings as
"no driver found". Cause: correct behaviour, not a defect — every ride was cash, so each driver's
commission went onto their balance (−3,750 SYP after one ride), below the dev region's balance floor
(unset → the SRS default −50), and COM-03 blocks a driver at the floor from new offers until they
settle. Run 2 lowered the dev region's floor for the duration of the test (restored afterwards) to
measure realistic repeat dispatch. **Launch note:** the SRS default floor of −50 is in currency
units; in SYP that blocks a driver after their first cash ride. Each region's floor must be set in
its own currency scale (see the launch checklist, region configuration row).

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

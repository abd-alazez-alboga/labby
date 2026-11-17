# Dev Seeding (M2 design, implemented in M2-T2)

Per AUTH-07: dev/test environments may contain **seeded pre-verified accounts** — data only,
never a code-path bypass. All environments send real SMS (ES-01); seeded accounts exist so
routine development never needs an OTP.

## Mechanism

`runner/DevDataSeeder.java` — an `ApplicationRunner` gated to the `dev` profile (and reused by
integration tests where useful). Idempotent: looks up each seed account by phone and inserts
only what's missing; never updates existing rows (a dev's local changes survive restarts).
Passwords are bcrypt-hashed at seed time.

## Seed accounts

| Phone | Password | Roles | Purpose |
|---|---|---|---|
| `+963900000001` | `Password1!` | rider | Rider-app flows |
| `+963900000002` | `Password1!` | rider + driver | Driver-app flows (gate open) |
| `+963900000003` | `Password1!` | rider | Driver-app gate closed (no driver role) |
| `+963900000004` | `Password1!` | admin | Admin-dashboard login (M2-T5); **Super Admin** RBAC role since M3 |

These phone numbers are reserved dev fixtures (not real). On the public demo deployment the same
accounts carry different, unpublished passwords (rotated 2026-11-17; kept in the gitignored
`backend/.env.demo`) — `Password1!` is for local dev only. The list grows in later milestones
(vehicles, regions, rides) — each milestone's seeder additions are documented here.

## Demo region (M4-T5)

`runner/DevRegionSeeder.java` — dev profile, idempotent (skipped once a region named
**Damascus** exists, so admin edits survive restarts). The launch market is Syria, so the demo
region is a realistic Syrian city:

- **Damascus** — ACTIVE, full ADM-01 bundle: ~10-vertex city boundary (SRID 4326), currency
  `SYP`, emergency number `112`, cancellation 5 min / 5,000, wait 5 min / 500 per min, pickup
  fee beyond 10 km at 1,000 per km, surge cap 2.0×, commission tiers 25%/20%>100/15%>200,
  DRV-08 incentives and USR-05 suspension thresholds at SRS defaults (amounts in SYP scale).
- **Service types** (AR-first): اقتصادي/Economy (base 10,000 · 2,000/km · 300/min · min
  15,000), مريح/Comfort (~1.5×), عائلي/Family (~2×). Demo-realistic SYP figures — tune in the
  admin UI; the seeder never overwrites edits.
- **Surcharge window**: Morning rush 07:00–09:30, Sun–Thu (Syrian work week), +25%.
- **Surge zones**: City Center, Mazzeh, Old City — default threshold steps (≥2→1.2×, ≥3→1.5×,
  ≥5→2.0×), zone cap 2.0×.

## Approved demo drivers (M5-T5)

`runner/DevDriverSeeder.java` — dev profile, runs after the account and region seeders,
idempotent per driver (skipped once the account has a driver profile, so admin edits survive
restarts; skipped entirely while **Damascus** is missing). Each demo driver is fully onboarded:
approved application with its stage history, approved personal item, active `driver` role,
exactly one ACTIVE approved vehicle (2 photos) serving Damascus service types, and four approved
current documents (ID, licence, registration, insurance). Files are plain coloured PNG
placeholders written through the `StorageProvider` (dev `STORAGE_DIR`, gitignored
`backend/data/`).

| Phone | Name | Vehicle | Plate | Seats | Service types | Note |
|---|---|---|---|---|---|---|
| `+963900000002` | Dev Driver | Kia Rio 2019, White | دمشق501234 | 4 | Economy | M2 fixture, backfilled |
| `+963900000005` | سامر الخطيب | Hyundai Accent 2018, Silver | دمشق502345 | 4 | Economy, Comfort | |
| `+963900000006` | ليلى حداد | Toyota Corolla 2021, White | دمشق503456 | 4 | Comfort | insurance expires in 20 days (expiry dashboard demo) |
| `+963900000007` | عمر النوري | Kia Carnival 2017, Grey | دمشق504567 | 7 | Economy, Family | |

All use password `Password1!`; the new ones default to Arabic. Documents are valid 365 days
from the seed date (except the insurance noted above). `+963900000003` stays a plain rider: it
is the applicant for onboarding walkthroughs.

## Dev ride simulator (M7-T5)

`runner/DevRideSimulator.java` — dev profile only, **off unless `RIDE_SIM_ENABLED=true`**. Every
`RIDE_SIM_TICK_MS` it steps the seeded drivers in `RIDE_SIM_DRIVERS` (default
`+963900000006,+963900000007`) through the REAL ride loop, only via the same services the REST
controllers call: go online, stream a GPS sample every tick (so dispatch's online+fresh gates
hold honestly), accept an open offer after `RIDE_SIM_ACCEPT_DELAY_TICKS`, drive the
`RoutingProvider` route to the pickup at `RIDE_SIM_SPEED_KMH`, geofenced **arrive** on the
streamed position, **start** after `RIDE_SIM_DWELL_TICKS`, drive pickup → stops → destination,
**complete**, then **cash-confirm**. Idle sim drivers wait near
`RIDE_SIM_CENTER_LAT/LNG` (defaults inside demo Damascus). It never touches ride state directly
and never drives an account outside its list — `+963900000005` stays free for the real driver
app on the emulator. Typical demo: start the backend with `RIDE_SIM_ENABLED=true`, book from the
rider app inside Damascus, and watch a sim driver accept, approach, ride and collect cash.

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

These phone numbers are reserved dev fixtures (not real). The list grows in later milestones
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

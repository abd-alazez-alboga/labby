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
| `+963900000004` | `Password1!` | admin | Admin-dashboard login (M2-T5) |

These phone numbers are reserved dev fixtures (not real). The list grows in later milestones
(vehicles, regions, rides) — each milestone's seeder additions are documented here.

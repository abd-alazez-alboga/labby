# Restore drill — 2026-10-20 (M15-T6)

**Result: PASS.** A real backup of the Labby database was restored into a clean PostgreSQL 16 +
PostGIS instance, verified row-for-row against the source, and the backend booted on the restored
copy (Flyway validated all 31 migrations, an admin signed in). Wall time from an empty instance to
verified data: **23 s** (RTO target ≤ 4 h). The backup is a nightly full dump, so the worst-case
data loss is one day (RPO target ≤ 24 h — met by the schedule in [backups.md](backups.md)).

## Setup (honest scope)

- **Source:** the local dev database (`labby-postgres` container, PostgreSQL 16.4 + PostGIS 3.4,
  schema V31, seeded dev data — 7 users, 7 rides, 3 tickets, 29 audit rows). Production does not
  exist yet; the drill proves the procedure and the scripts, and the launch checklist requires the
  same drill on the production host before launch.
- **Backup:** `ops/backup/labby-backup.sh` with `PG_DUMP="docker exec … pg_dump"` (the server's own
  16.4 client, so the archive matches the server). Custom-format dump, 348 KB, SHA-256 written.
  No off-server target in the drill (the script warned, as designed).
- **Clean target:** a NEW container `postgis/postgis:16-3.4-alpine` on another port, with an empty
  database created `TEMPLATE template0`.

## Steps and output

```
$ ops/backup/labby-backup.sh                      # BACKUP_DIR=…, PG_DUMP="docker exec -i … pg_dump"
labby-backup: wrote 348K (22f595c0795b…)
labby-backup: WARNING: BACKUP_OFFSITE_TARGET is empty — this dump exists on this server only
labby-backup: retention 30d: removed 0 old file(s)

$ docker run -d --name labby-restore-drill … postgis/postgis:16-3.4-alpine
$ psql … -c "CREATE DATABASE labby TEMPLATE template0"
$ ops/backup/labby-restore.sh labby-20261020T000414Z.dump   # PG_RESTORE="docker exec -i … pg_restore"
labby-restore: checksum ok
labby-restore: verifying
flyway latest: 31 incentive awards
flyway failed rows: 0
rows users: 7          rows regions: 1        rows rides: 7
rows fares: 5          rows ride_offers: 10   rows driver_ledger: 1
rows wallet_transactions: 0   rows ratings: 0  rows support_tickets: 3
rows audit_log: 29     rows incentive_awards: 0
labby-restore: restore + verification took 8s
total wall time (empty instance → verified data): 23s
```

Source vs restored row counts: all 11 tables **match**.

Application check on the restored copy (backend on port 8090, default profile):

```
Flyway: Successfully validated 31 migrations · Current version of schema "public": 31
GET  /api/v1/meta        → {"name":"labby-backend","version":"0.1.0"}
POST /api/v1/auth/login  → 200 (seeded Super Admin)
```

## Backup script behaviours exercised

- Off-server copy: dump + `.sha256` landed in the target (`BACKUP_OFFSITE_TARGET`, a local
  directory standing in for the backup host).
- Private files: `BACKUP_FILES_DIR` mirrored to `<target>/files/` (rsync).
- Retention: a dump dated 40 days back was deleted ("retention 30d: removed 1 old file(s)").

## Findings fixed during the drill

1. `labby-restore.sh` carried on after a failed connection (the empty-database check ran inside an
   `if`). It now stops with "cannot connect" before touching anything.
2. The `postgis/postgis` image pre-installs PostGIS (and the `tiger` schema) into its
   `POSTGRES_DB`, which collides with the dump. The restore target must be created
   `TEMPLATE template0`; the script header and [backups.md](backups.md) say so.
3. The image restarts once after initialising; wait for the second "ready to accept connections"
   before restoring (documented in backups.md).

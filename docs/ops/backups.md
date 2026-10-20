# Backups and restore (SRS NFR-A2, M15-T6)

Targets: **nightly full backup, 30-day retention, RPO ≤ 24 h, RTO ≤ 4 h.**
Scripts: [`ops/backup/labby-backup.sh`](../../ops/backup/labby-backup.sh) and
[`ops/backup/labby-restore.sh`](../../ops/backup/labby-restore.sh). Last drill:
[restore-drill-2026-10-20.md](restore-drill-2026-10-20.md) (pass; run B restored the off-server copy
on a clean host in 18 s).

## What is backed up

The whole Labby PostgreSQL database (every table, sequence, function, the PostGIS extension and
the Flyway history) as one compressed custom-format `pg_dump`. Uploaded private files (driver
documents, photos, ticket attachments) live under `labby.storage.dir` on disk, not in the
database: set `BACKUP_FILES_DIR` and the script mirrors that directory to
`<BACKUP_OFFSITE_TARGET>/files/` with rsync on every run.

## Nightly schedule (production)

1. Install PostgreSQL 16 client tools on the database host (the dump must come from a client at
   least as new as the server; 16 matches V1).
2. Put the scripts on the host (e.g. `/opt/labby/ops/backup/`) and create the backup directory.
3. Configure the environment in the cron entry (or an env file sourced by it):

   | Variable | Production value |
   |---|---|
   | `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` | the Labby database (a read-capable role is enough) |
   | `BACKUP_DIR` | `/var/backups/labby` (local copy) |
   | `BACKUP_RETENTION_DAYS` | `30` |
   | `BACKUP_OFFSITE_TARGET` | **required** — an rsync/scp target on ANOTHER machine or provider, e.g. `backup@backup-host:/srv/labby-backups/` (SSH key auth) |
   | `BACKUP_FILES_DIR` | the backend's `labby.storage.dir` (`STORAGE_DIR`) |

4. Cron (server time):
   ```
   30 2 * * *  /opt/labby/ops/backup/labby-backup.sh >> /var/log/labby-backup.log 2>&1
   ```
5. **Off-server retention:** keep 30 days on the target too (e.g. on the backup host:
   `find /srv/labby-backups -name 'labby-*.dump*' -mtime +30 -delete` daily).
6. **Monitoring:** alert when no new `labby-*.dump` appeared in 26 h, or when the log contains
   `WARNING` or a non-zero exit.

Each run writes `labby-<UTC stamp>.dump` + `.sha256` (the checksum names the bare file, so the
copy verifies wherever it is fetched to), verifies the archive is readable (`pg_restore --list`;
an unreadable archive fails the run and is deleted), copies both off-server, and deletes local
dumps older than the retention. Files are created mode `600` (`umask 077`): a dump holds phone
numbers and password hashes.

**Protect the off-server copy like the database:** the target must be reachable only by the
backup key, and its disk encrypted at rest (an encrypted volume, or the provider's server-side
encryption) — the dumps themselves are not encrypted by the script.

## Restore (RTO ≤ 4 h)

1. Provision PostgreSQL 16 + PostGIS 3.4 (same as production; `postgis/postgis:16-3.4-alpine` or
   the distro packages). With the Docker image, wait for the SECOND "database system is ready to
   accept connections" log line (it restarts once after initialising).
2. Create an EMPTY database from `template0` (the PostGIS image pre-installs extensions into its
   default database, which collides with the dump):
   ```
   psql -c "CREATE DATABASE labby TEMPLATE template0"
   ```
3. Fetch the latest dump + `.sha256` from the off-server target.
4. Restore and verify:
   ```
   PGHOST=… PGDATABASE=labby PGUSER=… PGPASSWORD=… ops/backup/labby-restore.sh labby-<stamp>.dump
   ```
   The script refuses a missing or mismatching checksum, refuses a non-empty database, restores with
   `--exit-on-error`, then prints the latest Flyway migration (no failed rows) and the core table
   row counts.
5. Point the backend at the restored database (`DB_URL`) and start it: Flyway must report
   "Successfully validated" with the current version; sign in as an admin.
6. Restore the private-files directory from `<BACKUP_OFFSITE_TARGET>/files/` into `labby.storage.dir`.

## Drill cadence

Run the restore drill into a clean instance **before launch on the production host**, then at
least quarterly and after any PostgreSQL/PostGIS upgrade. Record each drill like
[restore-drill-2026-10-20.md](restore-drill-2026-10-20.md).

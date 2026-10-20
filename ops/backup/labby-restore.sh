#!/usr/bin/env bash
# Labby restore (M15-T6; SRS NFR-A2: RTO <= 4 h). Restores a labby-backup.sh dump into a CLEAN
# database and verifies it: the checksum, the Flyway history (latest migration applied, no failed
# row) and row counts of the core tables, printed for comparison with the source.
#
# Usage: labby-restore.sh <dump-file>
# Target (environment): PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD — the database must be
# EMPTY, created from template0 on a PostgreSQL 16 + PostGIS server:
#   CREATE DATABASE labby TEMPLATE template0;
# (the postgis/postgis image pre-installs PostGIS into its POSTGRES_DB, which would collide with the
# dump's own CREATE EXTENSION / tiger schema). The script refuses a database that already holds
# Labby tables. PG_RESTORE / PSQL override the commands (e.g. "docker exec -i <container> …").
set -euo pipefail

dump="${1:?usage: labby-restore.sh <dump-file>}"
: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PGDATABASE:=labby}" "${PGUSER:=labby}"
export PGHOST PGPORT PGDATABASE PGUSER
PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL="${PSQL:-psql}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) labby-restore: $*"; }
sql() {
  # shellcheck disable=SC2086
  $PSQL --no-psqlrc --quiet --tuples-only --no-align --username="$PGUSER" --dbname="$PGDATABASE" -c "$1"
}

started="$(date +%s)"
if ! sql "SELECT 1" > /dev/null; then
  log "cannot connect to $PGDATABASE@$PGHOST:$PGPORT"
  exit 1
fi
if [ ! -f "$dump.sha256" ]; then
  log "refusing: $dump.sha256 not found (fetch it with the dump; it was written next to it)"
  exit 1
fi
if ! (cd "$(dirname "$dump")" && sha256sum --check --status "$(basename "$dump").sha256"); then
  log "refusing: checksum mismatch for $dump (corrupt or incomplete copy)"
  exit 1
fi
log "checksum ok"
if [ "$(sql "SELECT to_regclass('public.flyway_schema_history') IS NOT NULL")" = "t" ]; then
  log "refusing: $PGDATABASE already holds a Labby schema (restore into an empty database)"
  exit 1
fi

log "restoring $dump into $PGDATABASE@$PGHOST:$PGPORT"
# shellcheck disable=SC2086
$PG_RESTORE --no-owner --exit-on-error --username="$PGUSER" --dbname="$PGDATABASE" < "$dump"

log "verifying"
echo "flyway latest: $(sql "SELECT version || ' ' || description FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1")"
echo "flyway failed rows: $(sql "SELECT count(*) FROM flyway_schema_history WHERE NOT success")"
for table in users regions rides fares ride_offers driver_ledger wallet_transactions ratings \
  support_tickets audit_log incentive_awards; do
  echo "rows $table: $(sql "SELECT count(*) FROM $table")"
done
log "restore + verification took $(( $(date +%s) - started ))s"

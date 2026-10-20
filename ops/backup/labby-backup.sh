#!/usr/bin/env bash
# Labby nightly database backup (M15-T6; SRS NFR-A2: nightly, 30-day retention, RPO <= 24 h).
#
# Takes a full logical dump of the Labby PostgreSQL database (custom format: compressed, every
# schema object, restorable with pg_restore), keeps BACKUP_RETENTION_DAYS days locally, and copies
# each dump OFF the server when BACKUP_OFFSITE_TARGET is set. Meant for cron, e.g.:
#   30 2 * * *  /opt/labby/ops/backup/labby-backup.sh >> /var/log/labby-backup.log 2>&1
#
# Configuration (environment; defaults match backend/.env.example):
#   PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD   the database (libpq variables)
#   BACKUP_DIR                local backup directory            (default /var/backups/labby)
#   BACKUP_RETENTION_DAYS     days of local dumps to keep       (default 30)
#   BACKUP_OFFSITE_TARGET     rsync/scp target on another host, e.g.
#                             backup@backup-host:/srv/labby-backups/   (empty = local only; the
#                             launch checklist requires it set in production)
#   BACKUP_OFFSITE_RETENTION  handled on the target host (documented in docs/ops/backups.md)
#   BACKUP_FILES_DIR          the backend's private-files directory (labby.storage.dir: driver
#                             documents, photos, ticket attachments) — mirrored off-server with
#                             rsync next to the dumps when BACKUP_OFFSITE_TARGET is set
#   PG_DUMP                   pg_dump command (default "pg_dump"; e.g.
#                             "docker exec -i labby-postgres pg_dump" for the local container)
#   PG_RESTORE_CHECK          pg_restore command used to verify the archive when pg_restore is not
#                             on PATH (e.g. "docker exec -i labby-postgres pg_restore")
set -euo pipefail
# The dump holds personal data (phones, password hashes): readable by the backup user only.
umask 077

: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PGDATABASE:=labby}" "${PGUSER:=labby}"
export PGHOST PGPORT PGDATABASE PGUSER
BACKUP_DIR="${BACKUP_DIR:-/var/backups/labby}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_OFFSITE_TARGET="${BACKUP_OFFSITE_TARGET:-}"
BACKUP_FILES_DIR="${BACKUP_FILES_DIR:-}"
PG_DUMP="${PG_DUMP:-pg_dump}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
dump="$BACKUP_DIR/labby-$stamp.dump"
partial="$dump.partial"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) labby-backup: $*"; }
trap 'rm -f "$partial"' EXIT

log "dumping $PGDATABASE@$PGHOST:$PGPORT to $dump"
# shellcheck disable=SC2086  # PG_DUMP may be a multi-word command (docker exec …)
$PG_DUMP --format=custom --no-owner --dbname="$PGDATABASE" --username="$PGUSER" > "$partial"
# A dump is only kept once pg_restore can read its table of contents; an unreadable archive fails
# the run (set -e) and the trap deletes it.
if [ -n "${PG_RESTORE_CHECK:-}" ]; then
  # shellcheck disable=SC2086
  $PG_RESTORE_CHECK --list < "$partial" > /dev/null
elif command -v pg_restore > /dev/null; then
  pg_restore --list "$partial" > /dev/null
else
  log "WARNING: pg_restore not on PATH, archive not verified (set PG_RESTORE_CHECK)"
fi
mv "$partial" "$dump"
# Bare file name in the checksum, so the copy fetched from the off-server target verifies anywhere.
(cd "$BACKUP_DIR" && sha256sum "labby-$stamp.dump" > "labby-$stamp.dump.sha256")
log "wrote $(du -h "$dump" | cut -f1) ($(cut -c1-12 "$dump.sha256")…)"

if [ -n "$BACKUP_OFFSITE_TARGET" ]; then
  log "copying off-server to $BACKUP_OFFSITE_TARGET"
  rsync -a "$dump" "$dump.sha256" "$BACKUP_OFFSITE_TARGET"
  if [ -n "$BACKUP_FILES_DIR" ]; then
    log "mirroring private files $BACKUP_FILES_DIR off-server"
    rsync -a "$BACKUP_FILES_DIR/" "${BACKUP_OFFSITE_TARGET%/}/files/"
  fi
else
  log "WARNING: BACKUP_OFFSITE_TARGET is empty — this dump exists on this server only"
fi

deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name 'labby-*.dump*' -mtime "+$BACKUP_RETENTION_DAYS" -print -delete | wc -l)"
log "retention ${BACKUP_RETENTION_DAYS}d: removed $deleted old file(s)"
log "done"

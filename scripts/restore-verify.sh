#!/usr/bin/env bash
# Restore-verify: restores a backup into a THROWAWAY database and compares
# row counts on key tables against the source. Never restores over the
# source database itself.
# Usage: DATABASE_URL=... ./scripts/restore-verify.sh backups/school-saas-YYYYMMDD-HHMMSS.dump
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
# pg tools reject Prisma's ?schema= query parameter — strip it.
DATABASE_URL="${DATABASE_URL%%\?*}"
DUMP="${1:?dump file path required}"
[ -f "$DUMP" ] || { echo "dump not found: $DUMP"; exit 1; }

# Derive a scratch DB name on the same server from DATABASE_URL.
BASE_URL="${DATABASE_URL%%\?*}"
SCRATCH_URL="${BASE_URL%/*}/school_saas_restore_check"
ADMIN_URL="${BASE_URL%/*}/postgres"

psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS school_saas_restore_check" -c "CREATE DATABASE school_saas_restore_check"
pg_restore --no-owner --dbname="$SCRATCH_URL" "$DUMP"

TABLES=(School SchoolMembership Student Guardian StudentAttendance StaffAttendance Notice NotificationOutbox NotificationDelivery)
FAIL=0
for t in "${TABLES[@]}"; do
  SRC=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM \"$t\"")
  RST=$(psql "$SCRATCH_URL" -Atc "SELECT count(*) FROM \"$t\"")
  if [ "$SRC" = "$RST" ]; then
    echo "OK   $t: $SRC rows"
  else
    echo "FAIL $t: source=$SRC restored=$RST"
    FAIL=1
  fi
done
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS school_saas_restore_check"
[ "$FAIL" = "0" ] && echo "RESTORE VERIFIED: all key table counts match" || { echo "RESTORE MISMATCH"; exit 1; }

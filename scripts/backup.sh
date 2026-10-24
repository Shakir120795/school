#!/usr/bin/env bash
# Database backup: pg_dump in custom format (compressed, restorable).
# Usage: DATABASE_URL=postgresql://user:pass@host:5432/db ./scripts/backup.sh [output-dir]
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
# pg tools reject Prisma's ?schema= query parameter — strip it.
DATABASE_URL="${DATABASE_URL%%\?*}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/school-saas-$STAMP.dump"
pg_dump --format=custom --no-owner --file="$FILE" "$DATABASE_URL"
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

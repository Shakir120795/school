#!/usr/bin/env bash
# Re-run Phase 1 validation checks on Linux/macOS (no changes to data).
set -euo pipefail
cd "$(dirname "$0")/.."
npx prisma format --check
npx prisma validate
npx prisma generate
npx prisma migrate status
echo "All Phase 1 checks passed."

#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/ubuntu/workspace/OCP-Catalog
MIGRATION="$ROOT/packages/catalog-db/migrations/002_job_catalog_performance.sql"
WORKDIR=/tmp/ocp-job-catalog-performance-migration

cd "$ROOT"
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env.jobs" | head -n 1 | cut -d= -f2-)"
CATALOG_ID="$(grep -E '^CATALOG_ID=' "$ROOT/.env.jobs" | head -n 1 | cut -d= -f2-)"
: "${DATABASE_URL:?DATABASE_URL is required in .env.jobs}"
: "${CATALOG_ID:?CATALOG_ID is required in .env.jobs}"
export DATABASE_URL

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"

awk -v dir="$WORKDIR" '
  BEGIN { part = 0; file = sprintf("%s/%03d.sql", dir, part) }
  /^-->/ { part += 1; file = sprintf("%s/%03d.sql", dir, part); next }
  { print >> file }
' "$MIGRATION"

for file in "$WORKDIR"/*.sql; do
  echo "[job-catalog-migration] applying $(basename "$file")"
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v statement_timeout=0 -v catalog_id="$CATALOG_ID" -f "$file"
done

rm -rf "$WORKDIR"
echo '[job-catalog-migration] completed'

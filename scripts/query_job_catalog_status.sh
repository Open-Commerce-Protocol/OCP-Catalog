#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/workspace/OCP-Catalog
DATABASE_URL="$(grep -E '^DATABASE_URL=' ./.env.jobs | head -n 1 | cut -d= -f2-)"
if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL is missing in .env.jobs" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
select 'catalog_entries_columns=' || string_agg(column_name, ',' order by ordinal_position)
from information_schema.columns
where table_schema = 'public'
  and table_name = 'catalog_entries';

select 'catalog_entries_count=' || count(*)
from catalog_entries
where catalog_id = 'cat_ocp_jobs_prod';
SQL

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <sync-chunk-batch-id>" >&2
  exit 2
fi

DATABASE_URL="$(grep '^DATABASE_URL=' /home/ubuntu/workspace/OCP-Catalog/.env.jobs | sed 's/^DATABASE_URL=//')"
if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL not found in .env.jobs" >&2
  exit 1
fi

batch_id_sql="${1//\'/\'\'}"

psql "$DATABASE_URL" -Atc "
select
  i.item_ordinal,
  i.object_id,
  i.status,
  coalesce(i.errors::text, '')
from object_sync_item_results i
join object_sync_chunks c on c.id = i.sync_chunk_id
where c.batch_id = '$batch_id_sql'
order by i.item_ordinal;
"
